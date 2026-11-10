//! End-to-end: real `stack_run` against a temp stack git repo plus a temp
//! project, both under the OS temp dir (no fixtures in the repo).
//!
//! Flow: init (fresh) -> import (with `requires`) -> init refuses (tracking)
//! -> status -> edit a file -> upstream commit -> update (merge) -> delete an
//! ignored file -> sync (restore) -> remove, then a second project where init
//! migrates a legacy `stack.lock.json` to `stack.toml`. Requires `git` and
//! `node` on PATH; the test fails fast with a clear message when either is
//! missing.
//!
//! The fixture stack repo embeds copies of the REAL `tools/stack/*.mjs` from
//! the `STACK_E2E_REPO` checkout, so the test exercises the shipped CLI, not
//! a stub. Unset `STACK_E2E_REPO` skips the test; run it locally against
//! your stack clone (CI cannot reach the private stack repo).

use serde_json::Value;
use stack_app_lib::stack::run_stack;
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(args: &[&str], cwd: &Path) {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("run git (is git installed and on PATH?)");
    assert!(
        out.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&out.stderr)
    );
}

fn require_prereqs() {
    for tool in ["git", "node"] {
        let ok = Command::new(tool)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        assert!(
            ok,
            "stack_e2e needs `{tool}` on PATH (this environment must provide git plus node)"
        );
    }
}

/// A real escacs/stack checkout, via `STACK_E2E_REPO`. `None` when the var
/// is unset or unusable, in which case the test skips itself.
fn real_stack_root() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var("STACK_E2E_REPO").ok()?);
    let canon = p.canonicalize().ok()?;
    canon.join("tools/stack/cli.mjs").is_file().then_some(canon)
}

fn write(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, text).unwrap();
}

/// Build a minimal stack git repo: real CLI files plus two skill entries,
/// `skills/app` requiring `skills/base`. Returns the repo dir.
fn fixture_stack(base: &Path) -> PathBuf {
    let real = real_stack_root()
        .expect("STACK_E2E_REPO must point at an escacs/stack checkout");
    let repo = base.join("stack");
    std::fs::create_dir_all(repo.join("tools").join("stack")).unwrap();
    // Every runtime module, not a fixed list: the CLI grows new siblings
    // (agentsmd, presets, ...) and a stale list breaks the fixture with
    // ERR_MODULE_NOT_FOUND. Test files stay out.
    let mut names: Vec<_> = std::fs::read_dir(real.join("tools").join("stack"))
        .expect("read real CLI dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".mjs") && !n.ends_with(".test.mjs"))
        .collect();
    names.sort();
    assert!(
        names.contains(&"cli.mjs".to_string()),
        "fixture needs the real cli.mjs"
    );
    for name in names {
        let bytes = std::fs::read(real.join("tools").join("stack").join(&name))
            .expect("read real CLI file");
        std::fs::write(repo.join("tools").join("stack").join(name), bytes).unwrap();
    }
    write(
        &repo.join("package.json"),
        r#"{"name":"e2e-stack","version":"0.0.0"}"#,
    );
    write(
        &repo.join("skills/base/stack.json"),
        r#"{"name":"base","kind":"skill","summary":"base skill","status":"stable","origin":"custom"}"#,
    );
    write(
        &repo.join("skills/base/SKILL.md"),
        "# base skill\nalpha\nbeta\ngamma\ndelta\n",
    );
    write(
        &repo.join("skills/app/stack.json"),
        r#"{"name":"app","kind":"skill","summary":"app skill","status":"stable","origin":"custom","requires":["skills/base"]}"#,
    );
    write(&repo.join("skills/app/SKILL.md"), "# app skill\nuses base\n");
    git(&["init"], &repo);
    git(&["add", "-A"], &repo);
    git(
        &[
            "-c", "user.email=e2e@test",
            "-c", "user.name=e2e",
            "-c", "commit.gpgsign=false",
            "commit", "-m", "initial",
        ],
        &repo,
    );
    repo
}

fn run(sub: &str, args: &[&str], project: &Path, stack: &Path) -> Value {
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let out = run_stack(
        sub,
        &owned,
        &project.display().to_string(),
        Some(&stack.display().to_string()),
    )
    .unwrap_or_else(|e| panic!("stack_run {sub} failed: {e}"));
    assert_eq!(out.code, 0, "stack {sub} stderr: {}", out.stderr);
    assert!(!out.truncated);
    serde_json::from_str(&out.stdout)
        .unwrap_or_else(|e| panic!("stack {sub} printed invalid JSON: {e}\n{}", out.stdout))
}

#[test]
fn import_status_update_sync_remove_end_to_end() {
    if real_stack_root().is_none() {
        eprintln!("skipping stack_e2e: set STACK_E2E_REPO to an escacs/stack checkout to run it");
        return;
    }
    require_prereqs();
    let base = std::env::temp_dir().join(format!("stack-app-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    let result = std::panic::catch_unwind(|| {
        let stack = fixture_stack(&base);
        let project = base.join("project");
        std::fs::create_dir_all(&project).unwrap();

        // 0. Init a fresh project: creates stack.toml plus the managed
        // gitignore block, no legacy file involved.
        let v = run("init", &["--json"], &project, &stack);
        assert_eq!(v["command"], "init");
        assert_eq!(v["migrated"], false);
        assert_eq!(v["entries"], 0);
        assert!(project.join("stack.toml").is_file());
        assert!(!project.join("stack.lock.json").exists());
        assert!(project.join(".gitignore").is_file());

        // 1. Import with requires: skills/app pulls in skills/base.
        let v = run("import", &["skills/app", "--json"], &project, &stack);
        assert_eq!(v["command"], "import");
        let imported: Vec<&str> = v["imported"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect();
        assert!(imported.contains(&"skills/app"), "imported: {imported:?}");
        assert!(imported.contains(&"skills/base"), "imported: {imported:?}");
        let base_entry = v["imported"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "skills/base")
            .unwrap();
        assert_eq!(base_entry["requiredBy"], "skills/app");
        assert!(project.join(".agents/skills/app/SKILL.md").is_file());
        assert!(project.join(".agents/skills/base/SKILL.md").is_file());
        assert!(project.join("stack.toml").is_file());
        assert!(project.join(".gitignore").is_file());

        // 1b. Init now refuses: the record already tracks imports.
        let owned: Vec<String> = ["--json".to_string()].to_vec();
        let out = run_stack(
            "init",
            &owned,
            &project.display().to_string(),
            Some(&stack.display().to_string()),
        )
        .expect("stack_run init runs");
        assert_ne!(out.code, 0);
        assert!(
            out.stderr.contains("already tracks"),
            "stderr: {}",
            out.stderr
        );

        // 2. Status: clean right after import.
        let v = run("status", &["--json"], &project, &stack);
        assert_eq!(v["command"], "status");
        assert_eq!(v["rows"].as_array().unwrap().len(), 2);
        for row in v["rows"].as_array().unwrap() {
            assert!(row["local"].as_array().unwrap().is_empty());
            assert!(row["upstream"].as_array().unwrap().is_empty());
            assert_eq!(row["gone"], false);
        }

        // 3. Edit one line here; change a different line upstream.
        let base_skill = project.join(".agents/skills/base/SKILL.md");
        let text = std::fs::read_to_string(&base_skill).unwrap();
        std::fs::write(
            &base_skill,
            text.replace("alpha\n", "alpha (edited here)\n"),
        )
        .unwrap();
        let v = run("status", &["--json"], &project, &stack);
        let row = v["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == "skills/base")
            .unwrap();
        assert_eq!(row["local"], serde_json::json!(["SKILL.md"]));
        let stack_skill = stack.join("skills/base/SKILL.md");
        let text = std::fs::read_to_string(&stack_skill).unwrap();
        std::fs::write(&stack_skill, text.replace("delta\n", "delta (upstream)\n")).unwrap();
        git(&["add", "-A"], &stack);
        git(
            &[
                "-c", "user.email=e2e@test",
                "-c", "user.name=e2e",
                "-c", "commit.gpgsign=false",
                "commit", "-m", "upstream change",
            ],
            &stack,
        );

        // 4. Update: three-way merge keeps both edits.
        let v = run("update", &["--json"], &project, &stack);
        assert_eq!(v["command"], "update");
        assert!(v["conflicts"].as_array().unwrap().is_empty());
        let merged: Vec<&str> = v["merged"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap())
            .collect();
        assert!(
            merged.iter().any(|m| m.contains("base/SKILL.md")),
            "merged: {merged:?}"
        );
        let text = std::fs::read_to_string(&base_skill).unwrap();
        assert!(text.contains("alpha (edited here)"), "lost local edit:\n{text}");
        assert!(text.contains("delta (upstream)"), "lost upstream:\n{text}");

        // 5. Delete an (ignored, unedited) import file; sync restores it.
        let app_skill = project.join(".agents/skills/app/SKILL.md");
        std::fs::remove_file(&app_skill).unwrap();
        let v = run("sync", &["--json"], &project, &stack);
        assert_eq!(v["command"], "sync");
        let restored: Vec<&str> = v["restored"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap())
            .collect();
        assert!(
            restored.iter().any(|r| r.contains("app/SKILL.md")),
            "restored: {restored:?}"
        );
        assert!(app_skill.is_file());

        // 6a. Remove skills/base first: still depended on, edited file kept.
        let v = run("remove", &["skills/base", "--json"], &project, &stack);
        assert_eq!(v["removed"], "skills/base");
        assert_eq!(v["requiredBy"], serde_json::json!(["skills/app"]));
        assert!(base_skill.is_file(), "edited file must be kept");
        let lock = std::fs::read_to_string(project.join("stack.toml")).unwrap();
        assert!(
            !lock.contains("[entries.\"skills/base\"]"),
            "removed entry must leave stack.toml:\n{lock}"
        );
        assert!(
            lock.contains("[entries.\"skills/app\"]"),
            "kept entry stays:\n{lock}"
        );

        // 6b. Remove skills/app: clean removal.
        let v = run("remove", &["skills/app", "--json"], &project, &stack);
        assert_eq!(v["removed"], "skills/app");
        assert!(!app_skill.exists());
        assert!(!project.join(".agents/skills/app").exists());

        // 7. Legacy migration: a project with only stack.lock.json gets it
        // rewritten as stack.toml (and the JSON deleted) by init.
        let legacy = base.join("legacy");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("stack.lock.json"), r#"{"entries":{}}"#).unwrap();
        let v = run("init", &["--json"], &legacy, &stack);
        assert_eq!(v["command"], "init");
        assert_eq!(v["migrated"], true);
        assert_eq!(v["entries"], 0);
        assert!(legacy.join("stack.toml").is_file());
        assert!(!legacy.join("stack.lock.json").exists());
        let v = run("status", &["--json"], &legacy, &stack);
        assert_eq!(v["command"], "status");
        assert!(v["rows"].as_array().unwrap().is_empty());
    });
    let _ = std::fs::remove_dir_all(&base);
    result.unwrap();
}
