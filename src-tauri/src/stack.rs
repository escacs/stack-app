//! Stack operations by shelling out to the stack CLI:
//! `node <stack>/tools/stack/cli.mjs <subcommand> ... --project <dir> [-- ...]`.
//!
//! The subcommand and flag allowlist is strict: anything not listed here is
//! rejected before any subprocess starts. Arguments are passed as argv (never
//! a shell string), `--to` targets are confined to the project, and the CLI
//! script itself must be the real `tools/stack/cli.mjs` inside the stack dir.
//! No project code is ever executed, and no git command is ever run.
//!
//! Argv order is always flags first, then `--project <dir>`, then `--`
//! followed by user-supplied positionals, so a search query starting with
//! `-` can never be mistaken for a flag. Callers may pass `--` themselves
//! (everything after it is positional) and `--json` where the CLI supports
//! it; Rust normalizes both.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::paths::{canonical_dir, confine_existing, join_inside};

pub const MIN_NODE_MAJOR: u32 = 22;
/// Per-stream capture cap (stdout and stderr each). Hit the cap and the
/// output is marked truncated instead of growing unbounded.
pub const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
/// Reads must answer quickly; they never write.
pub const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// Writes (import/update/remove/sync/gitignore) may move many files.
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(180);

/// Subcommands the frontend may invoke. `init` creates `stack.toml` plus the
/// managed gitignore block (migrating a legacy `stack.lock.json`); `sync`
/// restores ignored imports from the lock; `gitignore` rewrites the managed
/// escacs block. All three take no positional args and no flags (`--project`
/// is always set by Rust). `preset` takes an action positional (`list`,
/// `show <name>` or `apply <name>`); only `apply` accepts `--dry-run`.
const ALLOW_SUBCOMMANDS: &[&str] = &[
    "list",
    "search",
    "show",
    "import",
    "status",
    "update",
    "remove",
    "sync",
    "gitignore",
    "init",
    "preset",
];

/// Flags that take a value. `--json` and `--dry-run` (booleans) and `--`
/// (separator) are handled separately in [`build_argv`].
const ALLOW_FLAGS: &[&str] = &["--kind", "--to", "--ref", "--file"];
const KINDS: &[&str] = &[
    "skill",
    "style",
    "system",
    "component",
    "library",
    "asset",
    "template",
    "worker",
];
/// Folder names the CLI also accepts wherever a kind goes
/// (see `normalizeKind` in `tools/stack/cli.mjs`).
const KIND_PLURALS: &[&str] = &[
    "skills",
    "styles",
    "systems",
    "components",
    "libraries",
    "assets",
    "templates",
    "workers",
];

/// Accept a singular or plural kind, normalizing to singular for the CLI.
fn normalize_kind(v: &str) -> Option<&'static str> {
    if let Some(k) = KINDS.iter().find(|k| **k == v) {
        return Some(k);
    }
    KIND_PLURALS
        .iter()
        .position(|p| *p == v)
        .map(|i| KINDS[i])
}

fn is_read(sub: &str) -> bool {
    matches!(sub, "list" | "search" | "show" | "status")
}

fn timeout_for(sub: &str) -> Duration {
    if is_read(sub) {
        READ_TIMEOUT
    } else {
        WRITE_TIMEOUT
    }
}

fn is_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.'))
        && !s
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..")
}

fn is_ref(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/'))
        && !s.contains("..")
}

/// Validated argv split into CLI flags and user-supplied positionals.
/// [`run_stack`] emits flags, then `--project <dir>`, then `--` plus the
/// positionals, so user terms can never parse as flags.
struct BuiltArgv {
    flags: Vec<String>,
    positionals: Vec<String>,
}

impl BuiltArgv {
    fn new(flags: Vec<String>, positionals: Vec<String>) -> Self {
        BuiltArgv { flags, positionals }
    }
}

/// Validate `args` for `sub`. `project` must already be canonical.
/// Accepts `--json` (boolean, passed through to the CLI), `--dry-run`
/// (boolean, `preset apply` only) and `--` (separator: everything after it
/// is positional, never a flag).
fn build_argv(sub: &str, args: &[String], project: &Path) -> Result<BuiltArgv, String> {
    let mut positionals: Vec<&str> = Vec::new();
    let mut kind: Option<&str> = None;
    let mut to: Option<&str> = None;
    let mut git_ref: Option<&str> = None;
    let mut file: Option<&str> = None;
    let mut json = false;
    let mut dryrun = false;
    let mut dashdash = false;
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if dashdash {
            positionals.push(a);
        } else if a == "--" {
            dashdash = true;
        } else if a == "--json" {
            json = true;
        } else if a == "--dry-run" {
            dryrun = true;
        } else if a.starts_with('-') {
            if !ALLOW_FLAGS.contains(&a) {
                return Err(format!("flag '{a}' is not allowed"));
            }
            i += 1;
            let v = args.get(i).map(String::as_str).unwrap_or("");
            if v.is_empty() || v.starts_with('-') {
                return Err(format!("flag '{a}' needs a value"));
            }
            match a {
                "--kind" => {
                    kind = Some(
                        normalize_kind(v)
                            .ok_or_else(|| format!("unknown kind '{v}'"))?,
                    );
                }
                "--to" => to = Some(v),
                "--ref" => {
                    if !is_ref(v) {
                        return Err(format!("invalid --ref value"));
                    }
                    git_ref = Some(v);
                }
                "--file" => {
                    // Entry-relative file path: same segment rules as ids
                    // (relative, no `..`, no absolute, no backslash/NUL).
                    if !is_id(v) {
                        return Err(format!("invalid --file value"));
                    }
                    file = Some(v);
                }
                _ => unreachable!("allowlist checked above"),
            }
        } else {
            positionals.push(a);
        }
        i += 1;
    }
    if dryrun && sub != "preset" {
        return Err("--dry-run is only supported by preset apply".to_string());
    }
    // Emit flags in one deterministic order: --kind, --to, --ref, --file,
    // --dry-run, --json.
    let flag_vec = |with_kind: bool,
                    with_to: bool,
                    with_ref: bool,
                    with_file: bool,
                    with_dryrun: bool|
     -> Result<Vec<String>, String> {
        let mut flags: Vec<String> = Vec::new();
        if with_kind {
            if let Some(k) = kind {
                flags.extend(["--kind".to_string(), k.to_string()]);
            }
        }
        if with_to {
            if let Some(t) = to {
                let dest = join_inside(project, t)?;
                flags.extend(["--to".to_string(), dest.display().to_string()]);
            }
        }
        if with_ref {
            if let Some(r) = git_ref {
                flags.extend(["--ref".to_string(), r.to_string()]);
            }
        }
        if with_file {
            if let Some(f) = file {
                flags.extend(["--file".to_string(), f.to_string()]);
            }
        }
        if with_dryrun && dryrun {
            flags.push("--dry-run".to_string());
        }
        if json {
            flags.push("--json".to_string());
        }
        Ok(flags)
    };
    let pos = || positionals.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    match sub {
        "list" => {
            if positionals.len() > 1 {
                return Err("list takes at most one kind".to_string());
            }
            let list_pos: Vec<String> = match positionals.first() {
                None => vec![],
                Some(k) => vec![
                    normalize_kind(k)
                        .ok_or_else(|| format!("unknown kind '{k}'"))?
                        .to_string(),
                ],
            };
            if kind.is_some() || to.is_some() || git_ref.is_some() || file.is_some() {
                return Err("list takes no flags".to_string());
            }
            Ok(BuiltArgv::new(
                flag_vec(false, false, false, false, false)?,
                list_pos,
            ))
        }
        "search" => {
            if positionals.len() != 1 || positionals[0].is_empty() {
                return Err("search takes exactly one query".to_string());
            }
            let q = positionals[0];
            if q.len() > 500 || q.contains('\0') {
                return Err("invalid search query".to_string());
            }
            if to.is_some() || git_ref.is_some() || file.is_some() {
                return Err("search allows only --kind".to_string());
            }
            Ok(BuiltArgv::new(
                flag_vec(true, false, false, false, false)?,
                pos(),
            ))
        }
        "show" => {
            if positionals.len() != 1 || !is_id(positionals[0]) {
                return Err("show takes exactly one entry id".to_string());
            }
            if kind.is_some() || to.is_some() || git_ref.is_some() {
                return Err("show allows only --file".to_string());
            }
            Ok(BuiltArgv::new(
                flag_vec(false, false, false, true, false)?,
                pos(),
            ))
        }
        "import" => {
            if positionals.is_empty() || !positionals.iter().all(|p| is_id(p)) {
                return Err("import takes one or more entry ids".to_string());
            }
            if kind.is_some() || file.is_some() {
                return Err("import takes no --kind/--file".to_string());
            }
            if to.is_some() && positionals.len() > 1 {
                return Err("--to works with a single entry only".to_string());
            }
            Ok(BuiltArgv::new(
                flag_vec(false, true, true, false, false)?,
                pos(),
            ))
        }
        "status" => {
            if !positionals.is_empty() {
                return Err("status takes no entry ids".to_string());
            }
            if kind.is_some() || to.is_some() || file.is_some() {
                return Err("status allows only --ref".to_string());
            }
            Ok(BuiltArgv::new(
                flag_vec(false, false, true, false, false)?,
                pos(),
            ))
        }
        "update" => {
            if !positionals.iter().all(|p| is_id(p)) {
                return Err("invalid entry id".to_string());
            }
            if kind.is_some() || to.is_some() || file.is_some() {
                return Err("update allows only --ref".to_string());
            }
            Ok(BuiltArgv::new(
                flag_vec(false, false, true, false, false)?,
                pos(),
            ))
        }
        "remove" => {
            if positionals.len() != 1 || !is_id(positionals[0]) {
                return Err("remove takes exactly one entry id".to_string());
            }
            if kind.is_some() || to.is_some() || git_ref.is_some() || file.is_some() {
                return Err("remove takes no flags".to_string());
            }
            Ok(BuiltArgv::new(
                flag_vec(false, false, false, false, false)?,
                pos(),
            ))
        }
        "sync" | "gitignore" | "init" => {
            if !positionals.is_empty() {
                return Err(format!("{sub} takes no entry ids"));
            }
            if kind.is_some() || to.is_some() || git_ref.is_some() || file.is_some() {
                return Err(format!("{sub} takes no flags"));
            }
            Ok(BuiltArgv::new(
                flag_vec(false, false, false, false, false)?,
                pos(),
            ))
        }
        "preset" => {
            if kind.is_some() || to.is_some() || git_ref.is_some() || file.is_some() {
                return Err("preset takes no --kind/--to/--ref/--file".to_string());
            }
            match positionals.first().copied() {
                Some("list") => {
                    if positionals.len() != 1 {
                        return Err("preset list takes no preset name".to_string());
                    }
                    if dryrun {
                        return Err("preset list takes no --dry-run".to_string());
                    }
                    Ok(BuiltArgv::new(
                        flag_vec(false, false, false, false, false)?,
                        pos(),
                    ))
                }
                Some("show") => {
                    if positionals.len() != 2 || !is_id(positionals[1]) {
                        return Err("preset show takes exactly one preset name".to_string());
                    }
                    if dryrun {
                        return Err("preset show takes no --dry-run".to_string());
                    }
                    Ok(BuiltArgv::new(
                        flag_vec(false, false, false, false, false)?,
                        pos(),
                    ))
                }
                Some("apply") => {
                    if positionals.len() != 2 || !is_id(positionals[1]) {
                        return Err("preset apply takes exactly one preset name".to_string());
                    }
                    Ok(BuiltArgv::new(
                        flag_vec(false, false, false, false, true)?,
                        pos(),
                    ))
                }
                _ => Err("preset takes an action: list, show or apply".to_string()),
            }
        }
        _ => Err(format!("subcommand '{sub}' is not allowed")),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    pub ok: bool,
    pub version: Option<String>,
    pub major: Option<u32>,
    pub error: Option<String>,
}

pub fn probe_node() -> NodeStatus {
    let out = match Command::new("node").arg("--version").output() {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return NodeStatus {
                ok: false,
                version: None,
                major: None,
                error: Some(
                    "node was not found on PATH. Install Node.js 22 or newer (https://nodejs.org), then relaunch the app."
                        .to_string(),
                ),
            };
        }
        Err(e) => {
            return NodeStatus {
                ok: false,
                version: None,
                major: None,
                error: Some(format!("could not run node: {e}")),
            };
        }
    };
    let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let major = raw
        .strip_prefix('v')
        .unwrap_or(&raw)
        .split('.')
        .next()
        .unwrap_or("")
        .parse::<u32>()
        .ok();
    match major {
        Some(m) if m >= MIN_NODE_MAJOR && out.status.success() => NodeStatus {
            ok: true,
            version: Some(raw),
            major: Some(m),
            error: None,
        },
        Some(m) => NodeStatus {
            ok: false,
            version: Some(raw.clone()),
            major: Some(m),
            error: Some(format!(
                "node 22+ is required, found {raw}. Install a newer Node.js (https://nodejs.org), then relaunch the app."
            )),
        },
        None => NodeStatus {
            ok: false,
            version: Some(raw),
            major: None,
            error: Some("could not parse the node version; need node 22+".to_string()),
        },
    }
}

#[tauri::command]
pub fn node_status() -> NodeStatus {
    probe_node()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackRunOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    /// True when stdout or stderr hit the capture cap and was cut.
    pub truncated: bool,
}

/// Where the stack dir came from: the settings override (`"settings"`), the
/// `ESCACS_STACK` env var (`"env"`), the automatic clone lookup (`"auto"`),
/// or unresolvable (`"missing"`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackLocation {
    pub path: Option<String>,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackReport {
    pub path: String,
    pub valid: bool,
    pub source: String,
    pub git: bool,
    pub cli: bool,
    pub node: NodeStatus,
    /// Exactly one actionable message when `valid` is false, else null.
    pub error: Option<String>,
}

/// Env var pointing at the stack checkout. Same convention as the stack
/// repo's own setup docs (`export ESCACS_STACK=~/escacs/stack`).
pub const STACK_ENV_VAR: &str = "ESCACS_STACK";

/// Resolve the stack checkout: the explicit dir (the settings override)
/// wins, then the `ESCACS_STACK` env var, then a walk up from the running
/// executable, the app's own source dir (dev), and the working dir, looking
/// for `tools/stack/cli.mjs`. Returns the canonical path plus `"settings"`,
/// `"env"` or `"auto"`.
pub fn resolve_stack_dir(explicit: Option<&str>) -> Result<(PathBuf, &'static str), String> {
    resolve_stack_dir_inner(explicit, std::env::var(STACK_ENV_VAR).ok())
}

fn resolve_stack_dir_inner(
    explicit: Option<&str>,
    env_dir: Option<String>,
) -> Result<(PathBuf, &'static str), String> {
    if let Some(dir) = explicit {
        if !dir.trim().is_empty() {
            return canonical_dir(Path::new(dir), "resolve stack dir").map(|p| (p, "settings"));
        }
    }
    if let Some(dir) = env_dir.as_deref() {
        if !dir.trim().is_empty() {
            return canonical_dir(Path::new(dir), "resolve stack dir").map(|p| (p, "env"));
        }
    }
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            starts.push(dir.to_path_buf());
        }
    }
    starts.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    for start in &starts {
        let mut cur: Option<&Path> = Some(start);
        while let Some(dir) = cur {
            if dir.join("tools/stack/cli.mjs").is_file() {
                return canonical_dir(dir, "resolve stack dir").map(|p| (p, "auto"));
            }
            cur = dir.parent();
        }
    }
    Err("no escacs/stack checkout found: looked upward from the app, its install folder and the working folder for tools/stack/cli.mjs. Pick your stack clone in settings (the folder containing tools/stack/cli.mjs), or set ESCACS_STACK to it."
        .to_string())
}

fn has_git_head(dir: &Path) -> bool {
    let dotgit = dir.join(".git");
    if dotgit.join("HEAD").is_file() {
        return true;
    }
    // Linked worktree: .git is a small file with "gitdir: <path>".
    if dotgit.is_file() {
        if let Ok(text) = std::fs::read_to_string(&dotgit) {
            if let Some(gitdir) = text.strip_prefix("gitdir:") {
                let p = gitdir.trim();
                let abs = if Path::new(p).is_absolute() {
                    PathBuf::from(p)
                } else {
                    dir.join(p)
                };
                return abs.join("HEAD").is_file();
            }
        }
    }
    false
}

fn validation_error(path: &Path, git: bool, cli: bool, node: &NodeStatus) -> Option<String> {
    if git && cli && node.ok {
        return None;
    }
    let mut problems = Vec::new();
    if !cli {
        problems.push("tools/stack/cli.mjs is missing".to_string());
    }
    if !git {
        problems.push("it is not a git checkout with a HEAD commit".to_string());
    }
    let mut msg = format!(
        "'{}' is not a usable stack checkout: {}. Pick the escacs/stack clone (the folder containing tools/stack/cli.mjs) in settings.",
        path.display(),
        problems.join("; ")
    );
    if !node.ok {
        msg.push(' ');
        msg.push_str(
            node.error
                .as_deref()
                .unwrap_or("Install Node.js 22 or newer (https://nodejs.org), then relaunch the app."),
        );
    }
    Some(msg)
}

/// Report where the stack checkout resolves from (never throws: unresolvable
/// comes back as `{ path: null, source: "missing" }`).
#[tauri::command]
pub fn stack_location(stack_dir: Option<String>) -> StackLocation {
    match resolve_stack_dir(stack_dir.as_deref()) {
        Ok((path, source)) => StackLocation {
            path: Some(path.display().to_string()),
            source: source.to_string(),
        },
        Err(_) => StackLocation {
            path: None,
            source: "missing".to_string(),
        },
    }
}

/// First-run validation: the dir must be a git checkout with HEAD, contain
/// `tools/stack/cli.mjs`, and node 22+ must be present. Anything missing
/// yields `valid: false` with exactly one actionable `error`.
#[tauri::command]
pub fn validate_stack(stack_dir: Option<String>) -> StackReport {
    let node = probe_node();
    let (path, source) = match resolve_stack_dir(stack_dir.as_deref()) {
        Ok((p, s)) => (p, s.to_string()),
        Err(e) => {
            return StackReport {
                path: stack_dir.unwrap_or_default(),
                valid: false,
                source: "missing".to_string(),
                git: false,
                cli: false,
                node,
                error: Some(e),
            };
        }
    };
    let cli = path.join("tools/stack/cli.mjs").is_file();
    let git = has_git_head(&path);
    let error = validation_error(&path, git, cli, &node);
    StackReport {
        path: path.display().to_string(),
        valid: error.is_none(),
        source,
        git,
        cli,
        node,
        error,
    }
}

/// Flat args (Tauri maps camelCase JS keys to these): invoke as
/// `{ subcommand, args, projectDir, stackDir? }`.
#[tauri::command]
pub fn stack_run(
    subcommand: String,
    args: Option<Vec<String>>,
    project_dir: String,
    stack_dir: Option<String>,
) -> Result<StackRunOutput, String> {
    run_stack(
        &subcommand,
        args.as_deref().unwrap_or(&[]),
        &project_dir,
        stack_dir.as_deref(),
    )
}

pub fn run_stack(
    subcommand: &str,
    args: &[String],
    project_dir: &str,
    stack_dir: Option<&str>,
) -> Result<StackRunOutput, String> {
    if !ALLOW_SUBCOMMANDS.contains(&subcommand) {
        return Err(format!("subcommand '{subcommand}' is not allowed"));
    }
    let node = probe_node();
    if !node.ok {
        return Err(node.error.unwrap_or_else(|| "node 22+ is required".to_string()));
    }
    let project = canonical_dir(Path::new(project_dir), "resolve project dir")?;
    let argv = build_argv(subcommand, args, &project)?;
    let (stack, _) = resolve_stack_dir(stack_dir)?;
    let cli = confine_existing(&stack, &stack.join("tools/stack/cli.mjs"))?;
    if !cli.is_file() {
        return Err("tools/stack/cli.mjs is missing in the stack directory".to_string());
    }
    let mut cmd = Command::new("node");
    cmd.arg(&cli)
        .arg(subcommand)
        .args(&argv.flags)
        .arg("--project")
        .arg(&project);
    if !argv.positionals.is_empty() {
        cmd.arg("--").args(&argv.positionals);
    }
    cmd.current_dir(&project);
    let (code, out, err) = run_with_timeout(&mut cmd, timeout_for(subcommand), subcommand)?;
    let (stdout, t1) = truncate(&String::from_utf8_lossy(&out.bytes));
    let (stderr, t2) = truncate(&String::from_utf8_lossy(&err.bytes));
    Ok(StackRunOutput {
        stdout,
        stderr,
        code,
        truncated: out.truncated || err.truncated || t1 || t2,
    })
}

#[derive(Debug)]
struct Captured {
    bytes: Vec<u8>,
    truncated: bool,
}

/// Drain a pipe to EOF, keeping the first [`MAX_OUTPUT_BYTES`] bytes. Keeps
/// reading after the cap so the child never blocks on a full pipe.
fn drain_capped<R: Read>(mut r: R) -> Captured {
    let mut kept = Vec::new();
    let mut buf = [0u8; 16384];
    let mut truncated = false;
    loop {
        match r.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if truncated {
                    continue;
                }
                if kept.len() + n <= MAX_OUTPUT_BYTES {
                    kept.extend_from_slice(&buf[..n]);
                } else {
                    kept.extend_from_slice(&buf[..MAX_OUTPUT_BYTES - kept.len()]);
                    truncated = true;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    Captured {
        bytes: kept,
        truncated,
    }
}

fn empty_capture() -> Captured {
    Captured {
        bytes: Vec::new(),
        truncated: false,
    }
}

/// Run `cmd` with piped output, killing the child past `timeout`. Pipes drain
/// on threads so a chatty child can never deadlock against a full buffer.
fn run_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
    label: &str,
) -> Result<(i32, Captured, Captured), String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("run stack {label}: {e}"))?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let out_h = std::thread::spawn(move || drain_capped(stdout));
    let err_h = std::thread::spawn(move || drain_capped(stderr));
    let start = Instant::now();
    let code = loop {
        match child
            .try_wait()
            .map_err(|e| format!("wait for stack {label}: {e}"))?
        {
            Some(status) => break status.code().unwrap_or(-1),
            None => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = out_h.join();
                    let _ = err_h.join();
                    return Err(format!(
                        "stack {label} timed out after {}s and was killed. The stack clone or node may be busy — retry, or narrow the command.",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    };
    let out = out_h.join().unwrap_or_else(|_| empty_capture());
    let err = err_h.join().unwrap_or_else(|_| empty_capture());
    Ok((code, out, err))
}

/// Cut `s` to [`MAX_OUTPUT_BYTES`], backing off to a char boundary so the
/// result is always valid (returns the string plus whether it was cut).
fn truncate(s: &str) -> (String, bool) {
    if s.len() <= MAX_OUTPUT_BYTES {
        return (s.to_string(), false);
    }
    let mut cut = MAX_OUTPUT_BYTES;
    while cut > 0 && !s.is_char_boundary(cut) {
        cut -= 1;
    }
    (
        format!(
            "{}…[truncated {} bytes]",
            &s[..cut],
            s.len() - cut
        ),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("stack-app-argv-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn rejects_unknown_subcommands_and_flags() {
        let p = proj("rej");
        assert!(build_argv("serve", &[], &p).is_err());
        assert!(build_argv("catalog", &[], &p).is_err());
        assert!(build_argv("status", &args(&["--port", "1"]), &p).is_err());
        assert!(build_argv("status", &args(&["--project", "/tmp"]), &p).is_err());
        assert!(build_argv("status", &args(&["--kind"]), &p).is_err());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn show_file_passes_through_and_others_reject_it() {
        let p = proj("file");
        let argv = build_argv(
            "show",
            &args(&["skills/file-pr", "--file", "SKILL.md"]),
            &p,
        )
        .unwrap();
        assert_eq!(argv.flags, vec!["--file", "SKILL.md"]);
        assert_eq!(argv.positionals, vec!["skills/file-pr"]);
        // Traversal, absolute, empty and missing values are refused.
        for bad in ["../x", "/etc/hostname", "a\\b", "", ".", "x/../y"] {
            assert!(
                build_argv("show", &args(&["skills/file-pr", "--file", bad]), &p).is_err(),
                "rejects {bad:?}"
            );
        }
        assert!(build_argv("show", &args(&["skills/file-pr", "--file"]), &p).is_err());
        // No other subcommand accepts --file.
        assert!(build_argv("list", &args(&["--file", "x"]), &p).is_err());
        assert!(build_argv("import", &args(&["skills/a", "--file", "x"]), &p).is_err());
        assert!(build_argv("status", &args(&["--file", "x"]), &p).is_err());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn import_allows_ids_to_and_ref() {
        let p = proj("imp");
        let argv = build_argv("import", &args(&["skills/file-pr", "--ref", "HEAD"]), &p).unwrap();
        assert_eq!(argv.positionals, vec!["skills/file-pr"]);
        assert_eq!(argv.flags, vec!["--ref", "HEAD"]);
        assert!(build_argv("import", &[], &p).is_err());
        assert!(build_argv("import", &args(&["../evil"]), &p).is_err());
        assert!(build_argv("import", &args(&["a", "b", "--to", "x"]), &p).is_err());
        assert!(build_argv("import", &args(&["a", "--to", "../out"]), &p).is_err());
        let argv = build_argv("import", &args(&["a", "--to", "vendored/a"]), &p).unwrap();
        assert_eq!(argv.positionals, vec!["a"]);
        assert_eq!(argv.flags.len(), 2);
        assert_eq!(argv.flags[0], "--to");
        assert!(argv.flags[1].ends_with("vendored/a"));
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn sync_gitignore_and_init_take_no_args() {
        let p = proj("res");
        for sub in ["sync", "gitignore", "init"] {
            let argv = build_argv(sub, &[], &p).unwrap();
            assert!(argv.flags.is_empty() && argv.positionals.is_empty());
            assert!(build_argv(sub, &args(&["x"]), &p).is_err());
            assert!(build_argv(sub, &args(&["--ref", "v1"]), &p).is_err());
        }
        let argv = build_argv("init", &args(&["--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--json"]);
        assert!(argv.positionals.is_empty());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn plural_kinds_normalize_to_singular() {
        let p = proj("plur");
        let argv = build_argv("list", &args(&["components"]), &p).unwrap();
        assert_eq!(argv.positionals, vec!["component"]);
        let argv = build_argv("search", &args(&["button", "--kind", "skills"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--kind", "skill"]);
        let argv = build_argv("list", &args(&["libraries"]), &p).unwrap();
        assert_eq!(argv.positionals, vec!["library"]);
        assert!(build_argv("list", &args(&["nope"]), &p).is_err());
        assert!(build_argv("search", &args(&["q", "--kind", "nopes"]), &p).is_err());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn search_validates_shape() {
        let p = proj("sea");
        assert!(build_argv("search", &[], &p).is_err());
        assert!(build_argv("search", &args(&["a", "b"]), &p).is_err());
        let argv = build_argv("search", &args(&["button solid", "--kind", "component"]), &p).unwrap();
        assert_eq!(argv.positionals, vec!["button solid"]);
        assert_eq!(argv.flags, vec!["--kind", "component"]);
        assert!(build_argv("search", &args(&["q", "--kind", "nope"]), &p).is_err());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn show_remove_update_shapes() {
        let p = proj("sru");
        assert!(build_argv("show", &args(&["skills/file-pr"]), &p).is_ok());
        assert!(build_argv("show", &args(&["a", "b"]), &p).is_err());
        assert!(build_argv("remove", &args(&["skills/file-pr"]), &p).is_ok());
        assert!(build_argv("update", &[], &p).is_ok());
        assert!(build_argv("update", &args(&["--ref", "v1"]), &p).is_ok());
        assert!(build_argv("status", &args(&["x"]), &p).is_err());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn preset_routing_validates_actions_names_and_dry_run() {
        let p = proj("pre");
        let argv = build_argv("preset", &args(&["list", "--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--json"]);
        assert_eq!(argv.positionals, vec!["list"]);
        let argv = build_argv("preset", &args(&["show", "web", "--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--json"]);
        assert_eq!(argv.positionals, vec!["show", "web"]);
        let argv = build_argv("preset", &args(&["apply", "web"]), &p).unwrap();
        assert!(argv.flags.is_empty());
        assert_eq!(argv.positionals, vec!["apply", "web"]);
        // Actions take exactly their shape; anything else is rejected.
        assert!(build_argv("preset", &[], &p).is_err());
        assert!(build_argv("preset", &args(&["destroy", "x"]), &p).is_err());
        assert!(build_argv("preset", &args(&["list", "extra"]), &p).is_err());
        assert!(build_argv("preset", &args(&["show"]), &p).is_err());
        assert!(build_argv("preset", &args(&["apply"]), &p).is_err());
        assert!(build_argv("preset", &args(&["show", "a", "b"]), &p).is_err());
        assert!(build_argv("preset", &args(&["apply", "../evil"]), &p).is_err());
        assert!(build_argv("preset", &args(&["apply", ""]), &p).is_err());
        // --dry-run passes through for apply only.
        let argv = build_argv("preset", &args(&["apply", "web", "--dry-run", "--json"]), &p)
            .unwrap();
        assert_eq!(argv.flags, vec!["--dry-run", "--json"]);
        assert_eq!(argv.positionals, vec!["apply", "web"]);
        assert!(build_argv("preset", &args(&["list", "--dry-run"]), &p).is_err());
        assert!(build_argv("preset", &args(&["show", "web", "--dry-run"]), &p).is_err());
        // No other subcommand accepts --dry-run; preset takes no valued flags.
        assert!(build_argv("list", &args(&["--dry-run"]), &p).is_err());
        assert!(build_argv("import", &args(&["a", "--dry-run"]), &p).is_err());
        assert!(build_argv("preset", &args(&["list", "--kind", "skill"]), &p).is_err());
        assert!(build_argv("preset", &args(&["apply", "web", "--to", "x"]), &p).is_err());
        assert!(build_argv("preset", &args(&["apply", "web", "--ref", "v1"]), &p).is_err());
        assert!(build_argv("preset", &args(&["show", "web", "--file", "x"]), &p).is_err());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn json_flag_passes_through() {
        let p = proj("json");
        let argv = build_argv("list", &args(&["--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--json"]);
        assert!(argv.positionals.is_empty());
        let argv = build_argv("status", &args(&["--ref", "v1", "--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--ref", "v1", "--json"]);
        let argv = build_argv("sync", &args(&["--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--json"]);
        // --json takes no value: a following token stays positional.
        let argv = build_argv("show", &args(&["--json", "skills/a"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--json"]);
        assert_eq!(argv.positionals, vec!["skills/a"]);
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn dashdash_marks_user_terms_positional() {
        let p = proj("dd");
        // A dash-led search query survives via an explicit separator.
        let argv = build_argv("search", &args(&["--", "--kind"]), &p).unwrap();
        assert_eq!(argv.positionals, vec!["--kind"]);
        assert!(argv.flags.is_empty());
        // Flags after -- are terms too, so per-command validation still applies.
        assert!(build_argv("search", &args(&["--", "a", "--kind", "component"]), &p).is_err());
        // Bare -- with no terms is accepted and normalized away.
        let argv = build_argv("sync", &args(&["--"]), &p).unwrap();
        assert!(argv.flags.is_empty() && argv.positionals.is_empty());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn truncate_keeps_short_output_whole() {
        let (s, t) = truncate("hello");
        assert_eq!(s, "hello");
        assert!(!t);
    }

    #[test]
    fn truncate_cuts_multibyte_output_on_char_boundaries() {
        // 2-byte chars: the 4 MiB cap lands mid-char without backoff.
        let s = "é".repeat(3 * 1024 * 1024); // 6 MiB
        let (out, truncated) = truncate(&s);
        assert!(truncated);
        assert!(out.is_char_boundary(out.len()));
        assert!(out.ends_with("bytes]"));
        assert!(out.contains("…[truncated "));
        // Everything before the marker is the original prefix, cut on a char.
        let prefix = out.split('…').next().unwrap();
        assert!(s.starts_with(prefix));
        assert!(prefix.len() <= MAX_OUTPUT_BYTES);
        assert!(MAX_OUTPUT_BYTES - prefix.len() < "é".len());
    }

    #[test]
    fn timeouts_split_reads_and_writes() {
        for sub in ["list", "search", "show", "status"] {
            assert_eq!(timeout_for(sub), Duration::from_secs(30));
        }
        // `preset` applies under the write budget (list/show just get the
        // longer leash; the timeout only sees the subcommand).
        for sub in [
            "import", "update", "remove", "sync", "gitignore", "init", "preset",
        ] {
            assert_eq!(timeout_for(sub), Duration::from_secs(180));
        }
    }

    #[cfg(unix)]
    #[test]
    fn timeout_kills_a_hung_child() {
        let mut cmd = Command::new("sleep");
        cmd.arg("30");
        let err = run_with_timeout(&mut cmd, Duration::from_millis(200), "list")
            .expect_err("sleep should have timed out");
        assert!(err.contains("timed out"), "unexpected error: {err}");
        assert!(err.contains("killed"), "unexpected error: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn run_captures_output_of_a_fast_child() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "echo out; echo err >&2"]);
        let (code, out, err) = run_with_timeout(&mut cmd, Duration::from_secs(10), "list").unwrap();
        assert_eq!(code, 0);
        assert_eq!(String::from_utf8_lossy(&out.bytes).trim(), "out");
        assert_eq!(String::from_utf8_lossy(&err.bytes).trim(), "err");
        assert!(!out.truncated && !err.truncated);
    }

    #[test]
    fn env_override_beats_auto_and_explicit_beats_env() {
        let p = proj("envdir");
        // Env alone resolves (no auto lookup involved).
        let (path, source) =
            resolve_stack_dir_inner(None, Some(p.display().to_string())).unwrap();
        assert_eq!(source, "env");
        assert_eq!(path, p.canonicalize().unwrap());
        // Explicit wins over env.
        let q = proj("explicitdir");
        let (path, source) = resolve_stack_dir_inner(
            Some(&q.display().to_string()),
            Some(p.display().to_string()),
        )
        .unwrap();
        assert_eq!(source, "settings");
        assert_eq!(path, q.canonicalize().unwrap());
        // A blank explicit value falls through to env.
        let (path, source) =
            resolve_stack_dir_inner(Some("  "), Some(p.display().to_string())).unwrap();
        assert_eq!(source, "env");
        assert_eq!(path, p.canonicalize().unwrap());
        // A bad env dir is a hard error: fail loud instead of silently
        // resolving some other checkout the user did not mean.
        assert!(resolve_stack_dir_inner(None, Some("/nonexistent-stack-dir-xyz".to_string()))
            .is_err());
        let _ = std::fs::remove_dir_all(&p);
        let _ = std::fs::remove_dir_all(&q);
    }

    #[test]
    fn explicit_stack_dir_wins_and_is_checked() {
        let p = proj("stackdir");
        let (path, source) =
            resolve_stack_dir_inner(Some(&p.display().to_string()), None).unwrap();
        assert_eq!(source, "settings");
        assert_eq!(path, p.canonicalize().unwrap());
        assert!(resolve_stack_dir_inner(Some("/nonexistent-stack-dir-xyz"), None).is_err());
        // An empty override behaves exactly like no override.
        assert_eq!(
            resolve_stack_dir_inner(Some("  "), None),
            resolve_stack_dir_inner(None, None)
        );
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn validate_stack_accepts_a_valid_checkout() {
        // A fake checkout: cli.mjs plus a git HEAD. Node comes from PATH
        // (this test needs node 22+ installed, like the e2e test).
        let p = proj("validstack");
        let cli = p.join("tools/stack/cli.mjs");
        std::fs::create_dir_all(cli.parent().unwrap()).unwrap();
        std::fs::write(&cli, "console.log(1);\n").unwrap();
        let head = p.join(".git/HEAD");
        std::fs::create_dir_all(head.parent().unwrap()).unwrap();
        std::fs::write(&head, "ref: refs/heads/main\n").unwrap();
        let report = validate_stack(Some(p.display().to_string()));
        assert!(report.valid, "expected valid, got: {:?}", report.error);
        assert!(report.git && report.cli);
        assert_eq!(report.source, "settings");
        assert!(report.node.ok);
        assert!(report.error.is_none());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn validate_stack_reports_one_actionable_error() {
        let p = proj("nostack");
        let report = validate_stack(Some(p.display().to_string()));
        assert!(!report.valid);
        assert!(!report.git && !report.cli);
        let err = report.error.expect("one error message");
        assert!(err.contains(&p.display().to_string()));
        assert!(err.contains("settings"));
        let _ = std::fs::remove_dir_all(&p);
    }
}
