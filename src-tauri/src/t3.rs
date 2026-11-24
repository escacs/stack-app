//! T3 Code integration: discover git/T3 worktrees and threads for the open
//! project, target any branch worktree, and inject prompts/context into T3
//! threads via the local `t3` CLI.
//!
//! Security contract: never runs shell strings or binaries inside the project;
//! resolves `t3` and `git` from absolute `PATH` entries only (with AppImage
//! env unpoisoning), strictly validates thread ids, git refs, and message
//! bodies, and passes messages over stdin (`-`) rather than argv.

use serde::Serialize;
use serde_json::Value;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::paths::canonical_dir;
use crate::stack::{find_binary_in, is_ref, run_with_timeout_hint, run_with_timeout_input, unpoison_env};

const T3_READ_TIMEOUT: Duration = Duration::from_secs(15);
const T3_WRITE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_ENRICH_THREADS: usize = 16;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct T3Status {
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub detached: bool,
    pub is_main: bool,
    pub is_t3: bool,
    pub has_lock: bool,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct T3ThreadInfo {
    pub thread_id: String,
    pub title: String,
    pub status: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub link: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct T3WorkspaceReport {
    pub t3_available: bool,
    pub t3_version: Option<String>,
    pub t3_error: Option<String>,
    pub registered: bool,
    pub main_root: String,
    pub worktrees: Vec<WorktreeInfo>,
    pub threads: Vec<T3ThreadInfo>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct T3ThreadActionResult {
    pub thread_id: String,
    pub title: Option<String>,
    pub link: Option<String>,
    pub status: Option<String>,
}

pub fn is_thread_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && !s.starts_with('-')
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'-' | b'_' | b'.'))
}

pub fn validate_message(s: &str) -> Result<(), String> {
    if s.trim().is_empty() {
        return Err("message cannot be empty".to_string());
    }
    if s.len() > MAX_MESSAGE_BYTES {
        return Err(format!(
            "message is too large ({} bytes; max {MAX_MESSAGE_BYTES})",
            s.len()
        ));
    }
    if s.contains('\0') {
        return Err("message contains a NUL byte".to_string());
    }
    Ok(())
}

pub fn validate_title(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("title cannot be empty".to_string());
    }
    if trimmed.len() > 200 || trimmed.contains('\0') || trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("invalid thread title".to_string());
    }
    Ok(trimmed.to_string())
}

fn resolve_bin(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let appdir = std::env::var_os("APPDIR").unwrap_or_default();
    find_binary_in(name, &path, &appdir)
}

fn is_t3_worktree_path(path: &str) -> bool {
    let norm = path.replace('\\', "/");
    if norm.contains("/.t3/worktrees/") {
        return true;
    }
    Path::new(path)
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|n| n.starts_with("t3-"))
}

#[derive(Debug, Clone)]
struct ParsedWorktree {
    path: String,
    branch: Option<String>,
    detached: bool,
    bare: bool,
}

fn parse_porcelain_blocks(raw: &str) -> Vec<ParsedWorktree> {
    let mut out = Vec::new();
    let mut cur_path: Option<String> = None;
    let mut cur_branch: Option<String> = None;
    let mut cur_detached = false;
    let mut cur_bare = false;

    let flush = |out: &mut Vec<ParsedWorktree>,
                 p: &mut Option<String>,
                 b: &mut Option<String>,
                 d: &mut bool,
                 bare: &mut bool| {
        if let Some(path) = p.take() {
            out.push(ParsedWorktree {
                path,
                branch: b.take(),
                detached: *d,
                bare: *bare,
            });
        }
        *b = None;
        *d = false;
        *bare = false;
    };

    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            flush(&mut out, &mut cur_path, &mut cur_branch, &mut cur_detached, &mut cur_bare);
            continue;
        }
        if let Some(p) = line.strip_prefix("worktree ") {
            if cur_path.is_some() {
                flush(&mut out, &mut cur_path, &mut cur_branch, &mut cur_detached, &mut cur_bare);
            }
            cur_path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            let short = b.strip_prefix("refs/heads/").unwrap_or(b);
            cur_branch = Some(short.to_string());
        } else if line == "detached" {
            cur_detached = true;
        } else if line == "bare" {
            cur_bare = true;
        }
    }
    flush(&mut out, &mut cur_path, &mut cur_branch, &mut cur_detached, &mut cur_bare);
    out
}

pub fn build_worktrees(raw: &str, current_canon: &Path, check_fs: bool) -> (String, Vec<WorktreeInfo>) {
    let parsed = parse_porcelain_blocks(raw);
    let main_root = parsed
        .first()
        .map(|w| w.path.clone())
        .unwrap_or_else(|| current_canon.display().to_string());
    let current_str = current_canon.display().to_string();
    let mut worktrees = Vec::new();
    for (idx, w) in parsed.into_iter().enumerate() {
        if w.bare {
            continue;
        }
        let wp = Path::new(&w.path);
        if check_fs && !wp.is_dir() {
            continue;
        }
        let canon_w = if check_fs {
            wp.canonicalize().unwrap_or_else(|_| wp.to_path_buf())
        } else {
            wp.to_path_buf()
        };
        let path_str = canon_w.display().to_string();
        let has_lock = if check_fs {
            canon_w.join("stack.toml").is_file() || canon_w.join("stack.lock.json").is_file()
        } else {
            false
        };
        worktrees.push(WorktreeInfo {
            is_main: idx == 0,
            is_t3: is_t3_worktree_path(&path_str),
            has_lock,
            is_current: path_str == current_str,
            path: path_str,
            branch: w.branch,
            detached: w.detached,
        });
    }
    (main_root, worktrees)
}

fn discover_worktrees(current_canon: &Path) -> (String, Vec<WorktreeInfo>) {
    let fallback = (
        current_canon.display().to_string(),
        vec![WorktreeInfo {
            path: current_canon.display().to_string(),
            branch: None,
            detached: false,
            is_main: true,
            is_t3: is_t3_worktree_path(&current_canon.display().to_string()),
            has_lock: current_canon.join("stack.toml").is_file()
                || current_canon.join("stack.lock.json").is_file(),
            is_current: true,
        }],
    );
    let Some(git) = resolve_bin("git") else {
        return fallback;
    };
    let mut cmd = Command::new(git);
    unpoison_env(&mut cmd);
    cmd.arg("-C")
        .arg(current_canon)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain");
    let Ok((code, out, _)) = run_with_timeout_hint(
        &mut cmd,
        T3_READ_TIMEOUT,
        "git worktree list",
        "Git could not list worktrees for this project.",
    ) else {
        return fallback;
    };
    if code != 0 {
        return fallback;
    }
    let raw = String::from_utf8_lossy(&out.bytes);
    let (main_root, worktrees) = build_worktrees(&raw, current_canon, true);
    if worktrees.is_empty() {
        fallback
    } else {
        (main_root, worktrees)
    }
}

fn probe_t3_bin() -> T3Status {
    let Some(t3) = resolve_bin("t3") else {
        return T3Status {
            available: false,
            version: None,
            error: Some("t3 CLI was not found on PATH".to_string()),
        };
    };
    let mut cmd = Command::new(t3);
    unpoison_env(&mut cmd);
    cmd.arg("--version");
    match run_with_timeout_hint(
        &mut cmd,
        Duration::from_secs(5),
        "t3 --version",
        "t3 CLI did not answer in time.",
    ) {
        Ok((0, out, _)) => {
            let raw = String::from_utf8_lossy(&out.bytes).trim().to_string();
            T3Status {
                available: true,
                version: if raw.is_empty() { None } else { Some(raw) },
                error: None,
            }
        }
        Ok((code, out, err)) => {
            let msg = String::from_utf8_lossy(&err.bytes).trim().to_string();
            let out_s = String::from_utf8_lossy(&out.bytes).trim().to_string();
            let detail = if !msg.is_empty() { msg } else if !out_s.is_empty() { out_s } else { format!("t3 exited {code}") };
            T3Status {
                available: false,
                version: None,
                error: Some(detail),
            }
        }
        Err(e) => T3Status {
            available: false,
            version: None,
            error: Some(e),
        },
    }
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(|s| s.to_string())
}

pub fn parse_thread_list_json(raw: &str) -> Result<Vec<T3ThreadInfo>, String> {
    let val: Value = serde_json::from_str(raw).map_err(|e| format!("parse t3 thread list: {e}"))?;
    let arr = val
        .as_array()
        .ok_or_else(|| "expected JSON array from t3 thread list".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let Some(thread_id) = str_field(item, "threadId") else {
            continue;
        };
        out.push(T3ThreadInfo {
            thread_id,
            title: str_field(item, "title").unwrap_or_else(|| "(untitled)".to_string()),
            status: str_field(item, "status").unwrap_or_else(|| "unknown".to_string()),
            provider: str_field(item, "providerInstanceId"),
            model: str_field(item, "model"),
            branch: str_field(item, "branch"),
            worktree_path: str_field(item, "worktreePath"),
            link: str_field(item, "link"),
            updated_at: str_field(item, "updatedAt"),
        });
    }
    Ok(out)
}

pub fn apply_thread_show_json(thread: &mut T3ThreadInfo, raw: &str) {
    let Ok(val) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    let obj = val.get("thread").unwrap_or(&val);
    if let Some(b) = str_field(obj, "branch") {
        thread.branch = Some(b);
    }
    if let Some(w) = str_field(obj, "worktreePath") {
        thread.worktree_path = Some(w);
    }
    if let Some(s) = str_field(obj, "status") {
        thread.status = s;
    }
    if let Some(l) = str_field(obj, "link") {
        thread.link = Some(l);
    }
}

fn enrich_threads(t3_bin: &Path, threads: &mut [T3ThreadInfo]) {
    let count = threads.len().min(MAX_ENRICH_THREADS);
    if count == 0 {
        return;
    }
    // Enrich up to 4 threads concurrently so opening a project stays fast.
    let mut start = 0;
    while start < count {
        let end = (start + 4).min(count);
        std::thread::scope(|s| {
            let mut handles = Vec::new();
            for item in &mut threads[start..end] {
                let id = item.thread_id.clone();
                let bin = t3_bin.to_path_buf();
                let h = s.spawn(move || {
                    let mut cmd = Command::new(bin);
                    unpoison_env(&mut cmd);
                    cmd.args(["thread", "show", "--messages", "0", "--json", &id]);
                    match run_with_timeout_hint(
                        &mut cmd,
                        T3_READ_TIMEOUT,
                        "t3 thread show",
                        "T3 Code server may be busy.",
                    ) {
                        Ok((0, out, _)) => Some(String::from_utf8_lossy(&out.bytes).into_owned()),
                        _ => None,
                    }
                });
                handles.push((item, h));
            }
            for (item, h) in handles {
                if let Ok(Some(raw)) = h.join() {
                    apply_thread_show_json(item, &raw);
                }
            }
        });
        start = end;
    }
}

pub fn build_send_argv(thread_id: &str) -> Result<Vec<String>, String> {
    if !is_thread_id(thread_id) {
        return Err("invalid T3 thread id".to_string());
    }
    Ok(vec![
        "thread".to_string(),
        "send".to_string(),
        "--json".to_string(),
        thread_id.to_string(),
        "-".to_string(),
    ])
}

pub fn build_start_argv(
    project_root: &str,
    title: Option<&str>,
    worktree: Option<&str>,
    branch: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut args = vec!["thread".to_string(), "start".to_string(), "--json".to_string()];
    if let Some(t) = title {
        let clean = validate_title(t)?;
        args.push("--title".to_string());
        args.push(clean);
    }
    if let Some(w) = worktree {
        let trimmed = w.trim();
        if !trimmed.is_empty() {
            if !is_ref(trimmed) {
                return Err("invalid worktree base ref".to_string());
            }
            args.push("--worktree".to_string());
            args.push(trimmed.to_string());
        }
    }
    if let Some(b) = branch {
        let trimmed = b.trim();
        if !trimmed.is_empty() {
            if !is_ref(trimmed) {
                return Err("invalid branch name".to_string());
            }
            args.push("--branch".to_string());
            args.push(trimmed.to_string());
        }
    }
    args.push(project_root.to_string());
    args.push("-".to_string());
    Ok(args)
}

pub fn parse_action_result(raw: &str, fallback_thread_id: Option<&str>) -> T3ThreadActionResult {
    if let Ok(val) = serde_json::from_str::<Value>(raw) {
        let obj = val.get("thread").unwrap_or(&val);
        let thread_id = str_field(obj, "threadId")
            .or_else(|| str_field(&val, "threadId"))
            .or_else(|| str_field(&val, "id"))
            .or_else(|| fallback_thread_id.map(|s| s.to_string()))
            .unwrap_or_default();
        return T3ThreadActionResult {
            thread_id,
            title: str_field(obj, "title").or_else(|| str_field(&val, "title")),
            link: str_field(obj, "link").or_else(|| str_field(&val, "link")),
            status: str_field(obj, "status").or_else(|| str_field(&val, "status")),
        };
    }
    T3ThreadActionResult {
        thread_id: fallback_thread_id
            .map(|s| s.to_string())
            .unwrap_or_else(|| raw.trim().to_string()),
        title: None,
        link: None,
        status: None,
    }
}

#[tauri::command(async)]
pub fn t3_status() -> T3Status {
    probe_t3_bin()
}

#[tauri::command(async)]
pub fn t3_workspace(project_dir: String) -> Result<T3WorkspaceReport, String> {
    let canon = canonical_dir(Path::new(&project_dir), "resolve project dir")?;
    let (main_root, worktrees) = discover_worktrees(&canon);
    let status = probe_t3_bin();
    if !status.available {
        return Ok(T3WorkspaceReport {
            t3_available: false,
            t3_version: None,
            t3_error: status.error,
            registered: false,
            main_root,
            worktrees,
            threads: Vec::new(),
        });
    }
    let Some(t3_bin) = resolve_bin("t3") else {
        return Ok(T3WorkspaceReport {
            t3_available: false,
            t3_version: None,
            t3_error: Some("t3 CLI was not found on PATH".to_string()),
            registered: false,
            main_root,
            worktrees,
            threads: Vec::new(),
        });
    };

    let mut cmd = Command::new(&t3_bin);
    unpoison_env(&mut cmd);
    cmd.args(["thread", "list", "--project", &main_root, "--json"]);
    let (code, out, err) = run_with_timeout_hint(
        &mut cmd,
        T3_READ_TIMEOUT,
        "t3 thread list",
        "Make sure the T3 Code server is running.",
    )?;
    let stdout_s = String::from_utf8_lossy(&out.bytes).into_owned();
    let stderr_s = String::from_utf8_lossy(&err.bytes).into_owned();
    if code != 0 {
        let combined = format!("{stderr_s}\n{stdout_s}");
        if combined.contains("No T3 Code project matches") {
            return Ok(T3WorkspaceReport {
                t3_available: true,
                t3_version: status.version,
                t3_error: None,
                registered: false,
                main_root,
                worktrees,
                threads: Vec::new(),
            });
        }
        let msg = stderr_s.trim();
        let fallback = stdout_s.trim();
        return Err(if !msg.is_empty() {
            msg.to_string()
        } else if !fallback.is_empty() {
            fallback.to_string()
        } else {
            format!("t3 thread list exited {code}")
        });
    }

    let mut threads = parse_thread_list_json(&stdout_s)?;
    enrich_threads(&t3_bin, &mut threads);
    Ok(T3WorkspaceReport {
        t3_available: true,
        t3_version: status.version,
        t3_error: None,
        registered: true,
        main_root,
        worktrees,
        threads,
    })
}

#[tauri::command(async)]
pub fn t3_send_thread(thread_id: String, message: String) -> Result<T3ThreadActionResult, String> {
    validate_message(&message)?;
    let args = build_send_argv(&thread_id)?;
    let Some(t3_bin) = resolve_bin("t3") else {
        return Err("t3 CLI was not found on PATH".to_string());
    };
    let mut cmd = Command::new(t3_bin);
    unpoison_env(&mut cmd);
    cmd.args(&args);
    let (code, out, err) = run_with_timeout_input(
        &mut cmd,
        Some(message.into_bytes()),
        T3_WRITE_TIMEOUT,
        "t3 thread send",
        "T3 Code server may be busy.",
    )?;
    let stdout_s = String::from_utf8_lossy(&out.bytes).into_owned();
    let stderr_s = String::from_utf8_lossy(&err.bytes).into_owned();
    if code != 0 {
        let msg = stderr_s.trim();
        let fallback = stdout_s.trim();
        return Err(if !msg.is_empty() {
            msg.to_string()
        } else if !fallback.is_empty() {
            fallback.to_string()
        } else {
            format!("t3 thread send exited {code}")
        });
    }
    Ok(parse_action_result(&stdout_s, Some(&thread_id)))
}

#[tauri::command(async)]
pub fn t3_start_thread(
    project_dir: String,
    message: String,
    title: Option<String>,
    worktree: Option<String>,
    branch: Option<String>,
) -> Result<T3ThreadActionResult, String> {
    validate_message(&message)?;
    let canon = canonical_dir(Path::new(&project_dir), "resolve project dir")?;
    let (main_root, _) = discover_worktrees(&canon);
    let args = build_start_argv(
        &main_root,
        title.as_deref(),
        worktree.as_deref(),
        branch.as_deref(),
    )?;
    let Some(t3_bin) = resolve_bin("t3") else {
        return Err("t3 CLI was not found on PATH".to_string());
    };
    let mut cmd = Command::new(t3_bin);
    unpoison_env(&mut cmd);
    cmd.args(&args);
    let (code, out, err) = run_with_timeout_input(
        &mut cmd,
        Some(message.into_bytes()),
        T3_WRITE_TIMEOUT,
        "t3 thread start",
        "T3 Code server may be busy.",
    )?;
    let stdout_s = String::from_utf8_lossy(&out.bytes).into_owned();
    let stderr_s = String::from_utf8_lossy(&err.bytes).into_owned();
    if code != 0 {
        let msg = stderr_s.trim();
        let fallback = stdout_s.trim();
        return Err(if !msg.is_empty() {
            msg.to_string()
        } else if !fallback.is_empty() {
            fallback.to_string()
        } else {
            format!("t3 thread start exited {code}")
        });
    }
    Ok(parse_action_result(&stdout_s, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_id_validation_accepts_uuids_and_mcp_ids() {
        assert!(is_thread_id("825ab651-d1ce-4d21-923c-2649bee25a18"));
        assert!(is_thread_id("mcp:7ca19e2b-2633-4c1a-8356-e7b5c2fcf0da"));
        assert!(!is_thread_id(""));
        assert!(!is_thread_id("-bad"));
        assert!(!is_thread_id("has space"));
        assert!(!is_thread_id("has/slash"));
        assert!(!is_thread_id(&"a".repeat(129)));
    }

    #[test]
    fn message_validation_guards_empty_nul_and_size() {
        assert!(validate_message("hello").is_ok());
        assert!(validate_message("   \n\t ").is_err());
        assert!(validate_message("bad\0msg").is_err());
        assert!(validate_message(&"x".repeat(MAX_MESSAGE_BYTES + 1)).is_err());
    }

    #[test]
    fn parse_worktrees_identifies_main_branches_detached_and_t3() {
        let porcelain = "\
worktree /home/mel/stack-app
HEAD aaaaaaa
branch refs/heads/main

worktree /home/mel/.t3/worktrees/stack-app/t3-1234abcd
HEAD bbbbbbb
branch refs/heads/feat/t3-compat

worktree /home/mel/.t3/worktrees/stack-app/t3-deadbeef
HEAD ccccccc
detached

worktree /home/mel/bare.git
bare
";
        let cur = Path::new("/home/mel/.t3/worktrees/stack-app/t3-1234abcd");
        let (main_root, wts) = build_worktrees(porcelain, cur, false);
        assert_eq!(main_root, "/home/mel/stack-app");
        assert_eq!(wts.len(), 3);
        assert!(wts[0].is_main && !wts[0].is_t3 && !wts[0].is_current);
        assert_eq!(wts[0].branch.as_deref(), Some("main"));

        assert!(!wts[1].is_main && wts[1].is_t3 && wts[1].is_current);
        assert_eq!(wts[1].branch.as_deref(), Some("feat/t3-compat"));

        assert!(!wts[2].is_main && wts[2].is_t3 && wts[2].detached);
        assert_eq!(wts[2].branch, None);
    }

    #[test]
    fn parse_thread_list_and_apply_show_details() {
        let list = r#"[
          {
            "threadId": "t-1",
            "title": "Fix bug",
            "status": "completed",
            "providerInstanceId": "claudeAgent",
            "model": "claude-sonnet-5-5",
            "link": "https://app.t3.codes/threads/p/t-1",
            "updatedAt": "2026-11-18T00:00:00Z"
          }
        ]"#;
        let mut threads = parse_thread_list_json(list).unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].thread_id, "t-1");
        assert_eq!(threads[0].worktree_path, None);

        let show = r#"{
          "thread": {
            "threadId": "t-1",
            "status": "running",
            "branch": "feat/x",
            "worktreePath": "/home/mel/.t3/worktrees/repo/t3-abc",
            "link": "https://app.t3.codes/threads/p/t-1"
          },
          "messages": []
        }"#;
        apply_thread_show_json(&mut threads[0], show);
        assert_eq!(threads[0].status, "running");
        assert_eq!(threads[0].branch.as_deref(), Some("feat/x"));
        assert_eq!(
            threads[0].worktree_path.as_deref(),
            Some("/home/mel/.t3/worktrees/repo/t3-abc")
        );
    }

    #[test]
    fn build_send_and_start_argv_pass_stdin_marker_and_reject_bad_refs() {
        assert_eq!(
            build_send_argv("t-1").unwrap(),
            vec!["thread", "send", "--json", "t-1", "-"]
        );
        assert!(build_send_argv("-flag").is_err());

        assert_eq!(
            build_start_argv("/repo", Some("My Title"), Some("main"), Some("feat/t3")).unwrap(),
            vec![
                "thread",
                "start",
                "--json",
                "--title",
                "My Title",
                "--worktree",
                "main",
                "--branch",
                "feat/t3",
                "/repo",
                "-"
            ]
        );
        assert!(build_start_argv("/repo", Some("line1\nline2"), None, None).is_err());
        assert!(build_start_argv("/repo", None, Some("bad..ref"), None).is_err());
        assert!(build_start_argv("/repo", None, None, Some("bad ref")).is_err());
    }

    #[test]
    fn parse_action_result_handles_nested_or_flat_json() {
        let nested = r#"{"thread":{"threadId":"t-9","title":"Hello","link":"https://app.t3.codes/x","status":"running"}}"#;
        let r = parse_action_result(nested, None);
        assert_eq!(r.thread_id, "t-9");
        assert_eq!(r.title.as_deref(), Some("Hello"));
        assert_eq!(r.link.as_deref(), Some("https://app.t3.codes/x"));

        let flat = r#"{"threadId":"t-2"}"#;
        let r2 = parse_action_result(flat, Some("t-fallback"));
        assert_eq!(r2.thread_id, "t-2");
    }
}
