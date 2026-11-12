//! First-run provisioning from inside the app: fetch the escacs/stack
//! checkout and link the global `stack` command.
//!
//! Mirrors `scripts/provision-stack.sh` (same order, same paths) and the link
//! step of `scripts/install-appimage.sh`: a fixed repo (`escacs/stack`), a
//! fixed destination (`~/escacs/stack`), and a fixed link
//! (`~/.local/bin/stack` → `<stack>/bin/stack`). The repo is private, so
//! cloning uses the user's existing auth (`gh` or ssh); provisioning never
//! prompts, never handles credentials, and never overwrites an existing
//! directory, file or link.

use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::paths::canonical_dir;
use crate::stack::{
    find_binary_in, is_executable_file, is_usable_checkout, resolve_stack_dir, run_with_timeout_hint,
    unpoison_env, STACK_ENV_VAR,
};

/// The private stack repo. Fixed: no frontend input reaches the clone URL.
const STACK_REPO: &str = "escacs/stack";
const SSH_URL: &str = "git@github.com:escacs/stack.git";
/// A shallow clone of a small repo; past this the network is wedged.
/// `core.sshCommand` carries its own shorter connect timeout (see below).
const CLONE_TIMEOUT: Duration = Duration::from_secs(120);
/// `gh auth status` is local; past this something is wedged.
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);
/// ssh never prompts, fails fast on connect, and accepts a new host key the
/// way an interactive first clone would ask to. Same flags as
/// scripts/provision-stack.sh.
pub(crate) const SSH_COMMAND: &str =
    "ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new";

/// Outcome of [`provision_stack`]. `status` is one of `kept` (an existing
/// checkout was kept and pinned), `cloned-gh`, `cloned-ssh`, or `manual`
/// (nothing worked; `message` is the one actionable error). `path` is the
/// checkout on success, null on `manual`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionReport {
    pub status: String,
    pub path: Option<String>,
    pub message: String,
}

impl ProvisionReport {
    fn manual(message: String) -> Self {
        ProvisionReport {
            status: "manual".to_string(),
            path: None,
            message,
        }
    }
}

/// State of the `stack` command link. `status` is one of `linked-ok`, `missing`,
/// `points-elsewhere`, `foreign-file`, or `bin-not-on-PATH` (linked, but
/// `~/.local/bin` is not on `PATH`). `actual` is where the link points when
/// it is a symlink to something else.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub status: String,
    pub link: String,
    pub expected: String,
    pub actual: Option<String>,
    pub on_path: bool,
    pub message: String,
}

/// Inputs to provisioning, explicit so tests pin the matrix without touching
/// the process env or the real home dir.
pub(crate) struct ProvisionInputs {
    pub home: PathBuf,
    /// The already-pinned settings override (`config.stackPath`).
    pub configured: Option<String>,
    /// `$ESCACS_STACK`.
    pub env_stack: Option<String>,
}

/// The side effects provisioning needs, so the decision flow is testable
/// without network or config writes. [`ShellExec`] is the real one.
pub(crate) trait ProvisionExec {
    /// Resolve a helper binary the way node is resolved (absolute `PATH`
    /// entries, bundle entries stripped).
    fn tool(&self, name: &str) -> Option<PathBuf>;
    fn gh_authenticated(&self, gh: &Path) -> bool;
    /// Clone via `gh` into `dest`, which does not exist yet.
    fn clone_with_gh(&self, gh: &Path, dest: &Path) -> Result<(), String>;
    /// Clone via batch-mode ssh into `dest`, which does not exist yet.
    fn clone_with_ssh(&self, git: &Path, dest: &Path) -> Result<(), String>;
    /// Remove a half clone after a failed ssh attempt (mirrors the script,
    /// which only cleans up after ssh, not after `gh`).
    fn remove_dir(&self, dest: &Path);
    /// Pin the checkout in the app settings.
    fn pin_stack_path(&self, path: &str) -> Result<(), String>;
}

/// A path for an `export PATH="…"` hint: `$HOME`-relative when under home
/// (a quoted `~` would not expand), absolute otherwise.
fn export_path(home: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(home) {
        return format!("$HOME/{}", rel.display());
    }
    path.display().to_string()
}

/// Shorten a path under the home dir for messages (`~/escacs/stack`).
fn tilde(home: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(home) {
        if rel.as_os_str().is_empty() {
            return "~".to_string();
        }
        return format!("~/{}", rel.display());
    }
    path.display().to_string()
}

/// Anything on disk at `dest` (even a dangling symlink: never overwrite).
fn dest_taken(dest: &Path) -> bool {
    std::fs::symlink_metadata(dest).is_ok()
}

fn pin_note(home: &Path, resolved: &Path, exec: &dyn ProvisionExec, verb: &str) -> ProvisionReport {
    let path = resolved.display().to_string();
    let mut message = format!("{verb} {}", tilde(home, resolved));
    if is_usable_checkout(resolved) {
        if let Err(e) = exec.pin_stack_path(&path) {
            message.push_str(&format!(" (could not pin it in the app settings: {e})"));
        }
    }
    let status = match verb {
        "cloned with gh to" => "cloned-gh",
        "cloned over ssh to" => "cloned-ssh",
        _ => "kept",
    };
    ProvisionReport {
        status: status.to_string(),
        path: Some(path),
        message,
    }
}

/// Provision the stack checkout: keep an existing usable one (settings, then
/// `$ESCACS_STACK`, then `~/escacs/stack`), else `gh` clone, else batch-mode
/// ssh clone, else the one actionable error. Never overwrites `dest`.
pub(crate) fn provision_with(inputs: &ProvisionInputs, exec: &dyn ProvisionExec) -> ProvisionReport {
    let home = &inputs.home;
    let dest = home.join("escacs/stack");

    // 1. Already resolvable? Keep it and make sure it is pinned.
    let mut candidates: Vec<&str> = Vec::new();
    if let Some(c) = inputs.configured.as_deref() {
        if !c.trim().is_empty() {
            candidates.push(c);
        }
    }
    if let Some(e) = inputs.env_stack.as_deref() {
        if !e.trim().is_empty() {
            candidates.push(e);
        }
    }
    let default = dest.display().to_string();
    candidates.push(&default);
    for candidate in candidates {
        let dir = Path::new(candidate);
        if !is_usable_checkout(dir) {
            continue;
        }
        let resolved = canonical_dir(dir, "resolve stack dir").unwrap_or_else(|_| dir.to_path_buf());
        return pin_note(home, &resolved, exec, "already at");
    }

    // 2. Clone via gh when authenticated.
    if !dest_taken(&dest) {
        if let Some(gh) = exec.tool("gh") {
            if exec.gh_authenticated(&gh) {
                match exec.clone_with_gh(&gh, &dest) {
                    Ok(()) => {
                        let resolved =
                            canonical_dir(&dest, "resolve stack dir").unwrap_or_else(|_| dest.clone());
                        return pin_note(home, &resolved, exec, "cloned with gh to");
                    }
                    Err(e) => eprintln!("stack: gh clone failed ({e}); trying ssh."),
                }
            }
        }
        // 3. Batch-mode ssh clone, unless gh left a partial dir behind (the
        // script re-checks here and cleans up only after ssh).
        if !dest_taken(&dest) {
            if let Some(git) = exec.tool("git") {
                match exec.clone_with_ssh(&git, &dest) {
                    Ok(()) => {
                        let resolved =
                            canonical_dir(&dest, "resolve stack dir").unwrap_or_else(|_| dest.clone());
                        return pin_note(home, &resolved, exec, "cloned over ssh to");
                    }
                    Err(e) => {
                        eprintln!("stack: ssh clone failed ({e}).");
                        exec.remove_dir(&dest);
                    }
                }
            }
        }
    }

    // 4. Fallback: the app's first-run folder picker.
    if dest_taken(&dest) {
        ProvisionReport::manual(format!(
            "{} exists but is not a usable stack checkout (needs .git/HEAD and tools/stack/cli.mjs); leaving it alone.",
            tilde(home, &dest)
        ))
    } else {
        ProvisionReport::manual(
            "could not fetch the stack: escacs/stack is private and no GitHub auth was found. run gh auth login, then retry."
                .to_string(),
        )
    }
}

/// `gh repo clone escacs/stack <dest> -- --depth 1`: fixed repo, fixed
/// destination, shallow. Built, not parsed, so no input can reshape it.
pub(crate) fn gh_clone_cmd(gh: &Path, dest: &Path) -> Command {
    let mut cmd = Command::new(gh);
    cmd.arg("repo")
        .arg("clone")
        .arg(STACK_REPO)
        .arg(dest)
        .arg("--")
        .arg("--depth")
        .arg("1");
    cmd
}

/// Batch-mode ssh clone: fails fast, never prompts (stdin is null,
/// `GIT_TERMINAL_PROMPT=0`, `BatchMode=yes`).
pub(crate) fn ssh_clone_cmd(git: &Path, dest: &Path) -> Command {
    let mut cmd = Command::new(git);
    cmd.arg("-c")
        .arg(format!("core.sshCommand={SSH_COMMAND}"))
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg(SSH_URL)
        .arg(dest);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd
}

/// First stderr line of a failed clone, capped, for the debug log.
fn clone_failure(label: &str, code: i32, stderr: &[u8]) -> String {
    let line: String = String::from_utf8_lossy(stderr)
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(200)
        .collect();
    if line.is_empty() {
        format!("{label} failed (exit {code})")
    } else {
        format!("{label} failed (exit {code}): {line}")
    }
}

/// The real side effects: subprocesses plus the config write. The pin is a
/// closure so tests can run the real `gh`/`git` flow against stub binaries
/// without touching the real config.
pub(crate) struct ShellExec<F> {
    pub pin: F,
    pub path_var: OsString,
    pub appdir: OsString,
}

impl<F: Fn(&str) -> Result<(), String>> ProvisionExec for ShellExec<F> {
    fn tool(&self, name: &str) -> Option<PathBuf> {
        find_binary_in(name, &self.path_var, &self.appdir)
    }

    fn gh_authenticated(&self, gh: &Path) -> bool {
        let mut cmd = Command::new(gh);
        cmd.args(["auth", "status"]);
        unpoison_env(&mut cmd);
        matches!(
            run_with_timeout_hint(
                &mut cmd,
                AUTH_TIMEOUT,
                "gh auth status",
                "the GitHub auth check hung; retry.",
            ),
            Ok((0, _, _))
        )
    }

    fn clone_with_gh(&self, gh: &Path, dest: &Path) -> Result<(), String> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let mut cmd = gh_clone_cmd(gh, dest);
        unpoison_env(&mut cmd);
        let (code, _out, err) = run_with_timeout_hint(
            &mut cmd,
            CLONE_TIMEOUT,
            "gh clone of escacs/stack",
            "the clone timed out; check the network and retry.",
        )?;
        if code == 0 {
            Ok(())
        } else {
            Err(clone_failure("gh clone", code, &err.bytes))
        }
    }

    fn clone_with_ssh(&self, git: &Path, dest: &Path) -> Result<(), String> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let mut cmd = ssh_clone_cmd(git, dest);
        unpoison_env(&mut cmd);
        let (code, _out, err) = run_with_timeout_hint(
            &mut cmd,
            CLONE_TIMEOUT,
            "ssh clone of escacs/stack",
            "the clone timed out; check the network and retry.",
        )?;
        if code == 0 {
            Ok(())
        } else {
            Err(clone_failure("ssh clone", code, &err.bytes))
        }
    }

    fn remove_dir(&self, dest: &Path) {
        let _ = std::fs::remove_dir_all(dest);
    }

    fn pin_stack_path(&self, path: &str) -> Result<(), String> {
        (self.pin)(path)
    }
}

/// True when `bin_dir` is on `PATH`. Entries that exist compare canonical
/// (a symlinked `~/.local/bin` still matches); missing ones compare
/// lexically so a not-yet-created dir still counts.
pub(crate) fn bin_on_path(path_var: &std::ffi::OsStr, bin_dir: &Path) -> bool {
    let canon_bin = bin_dir.canonicalize().ok();
    for dir in std::env::split_paths(path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        if let (Some(want), Ok(got)) = (canon_bin.as_ref(), dir.canonicalize()) {
            if got == *want {
                return true;
            }
        } else if dir == *bin_dir {
            return true;
        }
    }
    false
}

/// True when `link` is a symlink resolving to `expected`. Dangling targets
/// compare lexically, so a link to the right place still reads as the
/// stack's link even when the checkout is mid-move.
fn link_points_at(link: &Path, expected: &Path) -> bool {
    let target = match std::fs::read_link(link) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let abs = if target.is_absolute() {
        target
    } else if let Some(parent) = link.parent() {
        parent.join(target)
    } else {
        return false;
    };
    match (abs.canonicalize(), expected.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => abs.as_path() == expected,
    }
}

fn cli_report(
    home: &Path,
    link: &Path,
    expected: &Path,
    actual: Option<String>,
    on_path: bool,
    status: &str,
    message: String,
) -> CliStatus {
    CliStatus {
        status: status.to_string(),
        link: tilde(home, link),
        expected: tilde(home, expected),
        actual,
        on_path,
        message,
    }
}

/// Classify the `stack` command link without changing anything. The bin dir
/// is the link's own parent (`~/.local/bin`).
pub(crate) fn cli_status_for(
    home: &Path,
    link: &Path,
    expected: &Path,
    path_var: &std::ffi::OsStr,
) -> CliStatus {
    let bin = link.parent().unwrap_or(home);
    let on_path = bin_on_path(path_var, bin);
    match std::fs::symlink_metadata(link) {
        Ok(md) if !md.file_type().is_symlink() => cli_report(
            home,
            link,
            expected,
            None,
            on_path,
            "foreign-file",
            format!(
                "{} exists and is not a symlink; leaving it alone.",
                tilde(home, link)
            ),
        ),
        Ok(_) => {
            let actual = std::fs::read_link(link)
                .ok()
                .map(|t| tilde(home, &t));
            if link_points_at(link, expected) {
                if on_path {
                    cli_report(
                        home,
                        link,
                        expected,
                        actual,
                        true,
                        "linked-ok",
                        "the stack command is linked.".to_string(),
                    )
                } else {
                    cli_report(
                        home,
                        link,
                        expected,
                        actual,
                        false,
                        "bin-not-on-PATH",
                        format!(
                            "{} is linked, but {} is not on PATH; add: export PATH=\"{}:$PATH\", then open a new shell.",
                            tilde(home, link),
                            tilde(home, bin),
                            export_path(home, bin),
                        ),
                    )
                }
            } else {
                cli_report(
                    home,
                    link,
                    expected,
                    actual.clone(),
                    on_path,
                    "points-elsewhere",
                    format!(
                        "{} points at {}, not at the stack shim; leaving it alone.",
                        tilde(home, link),
                        actual.as_deref().unwrap_or("an unreadable target"),
                    ),
                )
            }
        }
        Err(_) => {
            let message = if on_path {
                format!("{} is not linked yet.", tilde(home, link))
            } else {
                format!(
                    "{} is not linked yet, and {} is not on PATH.",
                    tilde(home, link),
                    tilde(home, bin),
                )
            };
            cli_report(home, link, expected, None, on_path, "missing", message)
        }
    }
}

/// Link `~/.local/bin/stack` at the stack shim, creating the bin dir. Never
/// replaces a non-symlink or a link to something else (reports instead);
/// linking an already-correct link is a no-op.
pub(crate) fn link_cli_for(
    home: &Path,
    link: &Path,
    expected: &Path,
    path_var: &std::ffi::OsStr,
) -> Result<CliStatus, String> {
    if !(expected.is_file() && is_executable_file(expected)) {
        let stack = expected.parent().and_then(|b| b.parent()).unwrap_or(home);
        return Err(format!(
            "no executable bin/stack in {}; the stack command was left off PATH.",
            tilde(home, stack)
        ));
    }
    let bin = link.parent().unwrap_or(home);
    std::fs::create_dir_all(bin).map_err(|e| format!("create {}: {e}", tilde(home, bin)))?;
    match std::fs::symlink_metadata(link) {
        Ok(md) if !md.file_type().is_symlink() => Ok(cli_status_for(home, link, expected, path_var)),
        Ok(_) if link_points_at(link, expected) => {
            Ok(cli_status_for(home, link, expected, path_var))
        }
        Ok(_) => Ok(cli_status_for(home, link, expected, path_var)),
        Err(_) => {
            #[cfg(unix)]
            std::os::unix::fs::symlink(expected, link)
                .map_err(|e| format!("link {}: {e}", tilde(home, link)))?;
            #[cfg(windows)]
            std::os::windows::fs::symlink_file(expected, link)
                .map_err(|e| format!("link {}: {e}", tilde(home, link)))?;
            let mut status = cli_status_for(home, link, expected, path_var);
            status.message = if status.on_path {
                format!(
                    "linked {} -> {}.",
                    tilde(home, link),
                    tilde(home, expected)
                )
            } else {
                format!(
                    "linked {} -> {}; but {} is not on PATH — add: export PATH=\"{}:$PATH\", then open a new shell.",
                    tilde(home, link),
                    tilde(home, expected),
                    tilde(home, bin),
                    export_path(home, bin),
                )
            };
            Ok(status)
        }
    }
}

fn home_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(home) = app.path().home_dir() {
        return Ok(home);
    }
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "could not determine your home folder".to_string())
}

/// Provision the stack checkout from the app (see [`provision_with`]).
/// Never throws: failure is `status: "manual"` with the one actionable
/// error.
#[tauri::command(async)]
pub fn provision_stack(app: AppHandle) -> ProvisionReport {
    let home = match home_dir(&app) {
        Ok(h) => h,
        Err(e) => return ProvisionReport::manual(format!("{e}; pick the stack folder instead.")),
    };
    let configured = crate::config::get_config(app.clone())
        .ok()
        .and_then(|c| c.stack_path);
    let exec = ShellExec {
        pin: move |p: &str| crate::config::pin_stack_path(&app, p),
        path_var: std::env::var_os("PATH").unwrap_or_default(),
        appdir: std::env::var_os("APPDIR").unwrap_or_default(),
    };
    provision_with(
        &ProvisionInputs {
            home,
            configured,
            env_stack: std::env::var(STACK_ENV_VAR).ok(),
        },
        &exec,
    )
}

/// Where the `stack` command link stands (never changes anything).
#[tauri::command(async)]
pub fn stack_cli_status(
    app: AppHandle,
    stack_dir: Option<String>,
) -> Result<CliStatus, String> {
    let (stack, _) = resolve_stack_dir(stack_dir.as_deref())?;
    let home = home_dir(&app)?;
    let link = home.join(".local/bin/stack");
    let expected = stack.join("bin/stack");
    Ok(cli_status_for(
        &home,
        &link,
        &expected,
        &std::env::var_os("PATH").unwrap_or_default(),
    ))
}

/// Link the `stack` command (see [`link_cli_for`]).
#[tauri::command(async)]
pub fn link_stack_cli(app: AppHandle, stack_dir: Option<String>) -> Result<CliStatus, String> {
    let (stack, _) = resolve_stack_dir(stack_dir.as_deref())?;
    let home = home_dir(&app)?;
    let link = home.join(".local/bin/stack");
    let expected = stack.join("bin/stack");
    link_cli_for(
        &home,
        &link,
        &expected,
        &std::env::var_os("PATH").unwrap_or_default(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::OsStr;

    fn tmp_home(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("stack-app-prov-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn make_usable(dir: &Path) {
        let cli = dir.join("tools/stack/cli.mjs");
        std::fs::create_dir_all(cli.parent().unwrap()).unwrap();
        std::fs::write(&cli, "console.log(1);\n").unwrap();
        let head = dir.join(".git/HEAD");
        std::fs::create_dir_all(head.parent().unwrap()).unwrap();
        std::fs::write(&head, "ref: refs/heads/main\n").unwrap();
    }

    fn make_shim(stack: &Path) -> PathBuf {
        let shim = stack.join("bin/stack");
        std::fs::create_dir_all(shim.parent().unwrap()).unwrap();
        std::fs::write(&shim, "#!/bin/sh\necho shim\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        shim
    }

    /// Scripted side effects: which tools exist, whether `gh` is authed,
    /// whether each clone works (and what it leaves behind), whether the pin
    /// sticks. Every call is recorded.
    struct FakeExec {
        tools: HashMap<String, PathBuf>,
        gh_auth: bool,
        gh_clone_ok: bool,
        gh_partial: bool,
        ssh_clone_ok: bool,
        ssh_partial: bool,
        pin_ok: bool,
        calls: RefCell<Vec<String>>,
        pinned: RefCell<Vec<String>>,
    }

    impl FakeExec {
        fn bare() -> Self {
            FakeExec {
                tools: HashMap::new(),
                gh_auth: false,
                gh_clone_ok: true,
                gh_partial: false,
                ssh_clone_ok: true,
                ssh_partial: false,
                pin_ok: true,
                calls: RefCell::new(Vec::new()),
                pinned: RefCell::new(Vec::new()),
            }
        }

        fn with_tools(home: &Path, names: &[&str]) -> Self {
            let mut fx = FakeExec::bare();
            let bin = home.join("bin");
            std::fs::create_dir_all(&bin).unwrap();
            for n in names {
                fx.tools.insert(n.to_string(), bin.join(n));
            }
            fx
        }

        fn cloned(&self) -> Vec<String> {
            self.calls
                .borrow()
                .iter()
                .filter(|c| c.starts_with("clone-"))
                .cloned()
                .collect()
        }
    }

    impl ProvisionExec for FakeExec {
        fn tool(&self, name: &str) -> Option<PathBuf> {
            self.tools.get(name).cloned()
        }

        fn gh_authenticated(&self, _gh: &Path) -> bool {
            self.gh_auth
        }

        fn clone_with_gh(&self, _gh: &Path, dest: &Path) -> Result<(), String> {
            self.calls.borrow_mut().push("clone-gh".to_string());
            if self.gh_clone_ok {
                make_usable(dest);
                Ok(())
            } else {
                if self.gh_partial {
                    std::fs::create_dir_all(dest).unwrap();
                }
                Err("gh clone failed (exit 1): not found".to_string())
            }
        }

        fn clone_with_ssh(&self, _git: &Path, dest: &Path) -> Result<(), String> {
            self.calls.borrow_mut().push("clone-ssh".to_string());
            if self.ssh_clone_ok {
                make_usable(dest);
                Ok(())
            } else {
                if self.ssh_partial {
                    std::fs::create_dir_all(dest).unwrap();
                }
                Err("ssh clone failed (exit 128): permission denied".to_string())
            }
        }

        fn remove_dir(&self, dest: &Path) {
            self.calls.borrow_mut().push("remove".to_string());
            let _ = std::fs::remove_dir_all(dest);
        }

        fn pin_stack_path(&self, path: &str) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("pin:{path}"));
            self.pinned.borrow_mut().push(path.to_string());
            if self.pin_ok {
                Ok(())
            } else {
                Err("disk full".to_string())
            }
        }
    }

    fn inputs(home: &Path, configured: Option<String>, env_stack: Option<String>) -> ProvisionInputs {
        ProvisionInputs {
            home: home.to_path_buf(),
            configured,
            env_stack,
        }
    }

    #[test]
    fn keeps_an_existing_checkout_in_order_and_pins_it() {
        let home = tmp_home("keep");
        let cfg = home.join("cfg-stack");
        let env = home.join("env-stack");
        let def = home.join("escacs/stack");
        make_usable(&cfg);
        make_usable(&env);
        make_usable(&def);
        let fx = FakeExec::bare();

        // Settings wins over env and the default dir.
        let r = provision_with(
            &inputs(&home, Some(cfg.display().to_string()), Some(env.display().to_string())),
            &fx,
        );
        assert_eq!(r.status, "kept");
        assert_eq!(r.path.as_deref(), Some(cfg.canonicalize().unwrap().to_str().unwrap()));
        assert!(r.message.starts_with("already at "));
        assert!(fx.cloned().is_empty(), "no clone for a kept checkout");
        assert_eq!(fx.pinned.borrow().len(), 1);

        // Env wins when the configured dir is not usable.
        let fx = FakeExec::bare();
        let r = provision_with(
            &inputs(&home, Some(home.display().to_string()), Some(env.display().to_string())),
            &fx,
        );
        assert_eq!(r.status, "kept");
        assert_eq!(
            r.path.as_deref(),
            Some(env.canonicalize().unwrap().to_str().unwrap())
        );

        // The default dir is last, reported with a tilde.
        let fx = FakeExec::bare();
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "kept");
        assert_eq!(r.message, "already at ~/escacs/stack");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn blank_overrides_fall_through_to_a_clone() {
        let home = tmp_home("blank");
        let mut fx = FakeExec::with_tools(&home, &["gh", "git"]);
        fx.gh_auth = true;
        let r = provision_with(&inputs(&home, Some("  ".to_string()), Some(String::new())), &fx);
        assert_eq!(r.status, "cloned-gh");
        assert_eq!(r.message, "cloned with gh to ~/escacs/stack");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn existing_but_unusable_dest_is_left_alone_without_cloning() {
        let home = tmp_home("taken");
        let dest = home.join("escacs/stack");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("notes.txt"), "mine\n").unwrap();
        let mut fx = FakeExec::with_tools(&home, &["gh", "git"]);
        fx.gh_auth = true;
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "manual");
        assert!(r.path.is_none());
        assert!(r.message.contains("leaving it alone"), "message: {}", r.message);
        assert!(r.message.contains("needs .git/HEAD and tools/stack/cli.mjs"));
        assert!(fx.cloned().is_empty(), "never clones over an existing dir");
        assert!(dest.join("notes.txt").is_file(), "untouched");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn gh_clone_skips_ssh_and_pins() {
        let home = tmp_home("gh");
        let mut fx = FakeExec::with_tools(&home, &["gh", "git"]);
        fx.gh_auth = true;
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "cloned-gh");
        assert_eq!(r.message, "cloned with gh to ~/escacs/stack");
        assert!(is_usable_checkout(&home.join("escacs/stack")));
        assert_eq!(fx.cloned(), vec!["clone-gh".to_string()]);
        assert_eq!(fx.pinned.borrow().len(), 1);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn unauthenticated_gh_falls_back_to_ssh() {
        let home = tmp_home("ssh");
        let fx = FakeExec::with_tools(&home, &["gh", "git"]);
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "cloned-ssh");
        assert_eq!(r.message, "cloned over ssh to ~/escacs/stack");
        assert_eq!(fx.cloned(), vec!["clone-ssh".to_string()]);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn missing_gh_still_tries_ssh() {
        let home = tmp_home("nogh");
        let fx = FakeExec::with_tools(&home, &["git"]);
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "cloned-ssh");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn failed_gh_clone_falls_back_to_ssh() {
        let home = tmp_home("ghfail");
        let mut fx = FakeExec::with_tools(&home, &["gh", "git"]);
        fx.gh_auth = true;
        fx.gh_clone_ok = false;
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "cloned-ssh");
        assert_eq!(fx.cloned(), vec!["clone-gh".to_string(), "clone-ssh".to_string()]);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn partial_gh_clone_blocks_ssh_like_the_script() {
        // The script re-checks `[ ! -e ]` before ssh and never cleans up
        // after gh: a partial gh dir ends in the manual branch, kept.
        let home = tmp_home("partial");
        let mut fx = FakeExec::with_tools(&home, &["gh", "git"]);
        fx.gh_auth = true;
        fx.gh_clone_ok = false;
        fx.gh_partial = true;
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "manual");
        assert!(r.message.contains("leaving it alone"), "message: {}", r.message);
        assert_eq!(fx.cloned(), vec!["clone-gh".to_string()]);
        assert!(home.join("escacs/stack").is_dir(), "partial dir kept");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn failed_ssh_clone_cleans_up_and_points_at_gh_auth() {
        let home = tmp_home("sshfail");
        let mut fx = FakeExec::with_tools(&home, &["git"]);
        fx.ssh_clone_ok = false;
        fx.ssh_partial = true;
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "manual");
        assert!(r.path.is_none());
        assert!(
            r.message.contains("run gh auth login, then retry"),
            "message: {}",
            r.message
        );
        assert!(fx.calls.borrow().contains(&"remove".to_string()));
        assert!(!home.join("escacs/stack").exists(), "no half clone left");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn no_tools_means_the_one_actionable_error() {
        let home = tmp_home("notools");
        let fx = FakeExec::bare();
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "manual");
        assert_eq!(
            r.message,
            "could not fetch the stack: escacs/stack is private and no GitHub auth was found. run gh auth login, then retry."
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn pin_failure_is_noted_not_fatal() {
        let home = tmp_home("pinfail");
        make_usable(&home.join("escacs/stack"));
        let mut fx = FakeExec::bare();
        fx.pin_ok = false;
        let r = provision_with(&inputs(&home, None, None), &fx);
        assert_eq!(r.status, "kept");
        assert!(r.path.is_some());
        assert!(r.message.contains("could not pin it in the app settings"), "message: {}", r.message);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn clone_argv_is_fixed_and_never_prompts() {
        let gh = Path::new("/usr/bin/gh");
        let dest = Path::new("/home/u/escacs/stack");
        let cmd = gh_clone_cmd(gh, dest);
        assert_eq!(cmd.get_program(), gh.as_os_str());
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(
            args,
            vec!["repo", "clone", "escacs/stack", "/home/u/escacs/stack", "--", "--depth", "1"]
        );

        let git = Path::new("/usr/bin/git");
        let cmd = ssh_clone_cmd(git, dest);
        assert_eq!(cmd.get_program(), git.as_os_str());
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(
            args,
            vec![
                "-c",
                "core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new",
                "clone",
                "--depth",
                "1",
                "git@github.com:escacs/stack.git",
                "/home/u/escacs/stack",
            ]
        );
        assert!(SSH_COMMAND.contains("BatchMode=yes"));
        let envs: std::collections::HashMap<_, _> = cmd.get_envs().collect();
        assert_eq!(
            envs.get(OsStr::new("GIT_TERMINAL_PROMPT")).and_then(|v| *v),
            Some(OsStr::new("0"))
        );
    }

    #[test]
    fn bin_on_path_matches_existing_and_missing_dirs() {
        let home = tmp_home("onpath");
        let bin = home.join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();

        let with = OsString::from(format!("/usr/bin:{}:/bin", bin.display()));
        assert!(bin_on_path(&with, &bin));
        assert!(!bin_on_path(OsStr::new("/usr/bin:/bin"), &bin));
        // Empty entries (cwd) never match an absolute bin dir.
        assert!(!bin_on_path(OsStr::new(":/usr/bin"), &bin));
        // A trailing slash still matches.
        let slash = OsString::from(format!("{}/", bin.display()));
        assert!(bin_on_path(&slash, &bin));

        // A not-yet-created bin dir matches lexically.
        let fresh = home.join("fresh/bin");
        let lex = OsString::from(format!("/usr/bin:{}", fresh.display()));
        assert!(bin_on_path(&lex, &fresh));
        assert!(!bin_on_path(OsStr::new("/usr/bin"), &fresh));
        let _ = std::fs::remove_dir_all(&home);
    }

    fn cli_paths(home: &Path) -> (PathBuf, PathBuf, PathBuf) {
        let stack = home.join("escacs/stack");
        let shim = make_shim(&stack);
        let bin = home.join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        (bin.join("stack"), shim, bin)
    }

    #[test]
    fn cli_missing_reports_and_notes_path() {
        let home = tmp_home("climiss");
        let (link, shim, bin) = cli_paths(&home);
        let on = OsString::from(format!("{}:/usr/bin", bin.display()));
        let st = cli_status_for(&home, &link, &shim, &on);
        assert_eq!(st.status, "missing");
        assert!(st.on_path);
        assert!(st.actual.is_none());
        assert_eq!(st.message, "~/.local/bin/stack is not linked yet.");

        let st = cli_status_for(&home, &link, &shim, OsStr::new("/usr/bin"));
        assert_eq!(st.status, "missing");
        assert!(!st.on_path);
        assert!(st.message.contains("not on PATH"), "message: {}", st.message);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn cli_foreign_file_is_reported() {
        let home = tmp_home("cliforeign");
        let (link, shim, bin) = cli_paths(&home);
        std::fs::write(&link, "mine\n").unwrap();
        let on = OsString::from(format!("{}", bin.display()));
        let st = cli_status_for(&home, &link, &shim, &on);
        assert_eq!(st.status, "foreign-file");
        assert!(st.message.contains("is not a symlink; leaving it alone"), "message: {}", st.message);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn cli_linked_ok_and_off_path() {
        use std::os::unix::fs::symlink;
        let home = tmp_home("clilink");
        let (link, shim, bin) = cli_paths(&home);
        symlink(&shim, &link).unwrap();

        let on = OsString::from(format!("{}:/usr/bin", bin.display()));
        let st = cli_status_for(&home, &link, &shim, &on);
        assert_eq!(st.status, "linked-ok");
        assert!(st.on_path);

        let st = cli_status_for(&home, &link, &shim, OsStr::new("/usr/bin:/bin"));
        assert_eq!(st.status, "bin-not-on-PATH");
        assert!(!st.on_path);
        assert!(st.message.contains("is not on PATH"), "message: {}", st.message);
        // The export hint must expand inside quotes: $HOME, never a quoted ~.
        assert!(
            st.message.contains("export PATH=\"$HOME/.local/bin:$PATH\""),
            "message: {}",
            st.message
        );

        // A relative link to the same shim still counts.
        std::fs::remove_file(&link).unwrap();
        symlink("../../escacs/stack/bin/stack", &link).unwrap();
        let st = cli_status_for(&home, &link, &shim, &on);
        assert_eq!(st.status, "linked-ok");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn cli_points_elsewhere_names_the_target() {
        use std::os::unix::fs::symlink;
        let home = tmp_home("clielse");
        let (link, shim, bin) = cli_paths(&home);
        let other = home.join("other-stack/bin/stack");
        std::fs::create_dir_all(other.parent().unwrap()).unwrap();
        std::fs::write(&other, "x\n").unwrap();
        symlink(&other, &link).unwrap();
        let on = OsString::from(format!("{}", bin.display()));
        let st = cli_status_for(&home, &link, &shim, &on);
        assert_eq!(st.status, "points-elsewhere");
        assert_eq!(st.actual.as_deref(), Some("~/other-stack/bin/stack"));
        assert!(st.message.contains("leaving it alone"), "message: {}", st.message);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn link_requires_an_executable_shim() {
        let home = tmp_home("clinoshim");
        let stack = home.join("escacs/stack");
        std::fs::create_dir_all(&stack).unwrap();
        let link = home.join(".local/bin/stack");
        let err = link_cli_for(&home, &link, &stack.join("bin/stack"), OsStr::new("/usr/bin"))
            .expect_err("no shim means no link");
        assert!(err.contains("no executable bin/stack"), "error: {err}");
        assert!(!link.exists(), "nothing created");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn link_never_replaces_a_foreign_file() {
        let home = tmp_home("clirefuse");
        let (link, shim, bin) = cli_paths(&home);
        std::fs::write(&link, "mine\n").unwrap();
        let on = OsString::from(format!("{}", bin.display()));
        let st = link_cli_for(&home, &link, &shim, &on).expect("reports, not errors");
        assert_eq!(st.status, "foreign-file");
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "mine\n");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn link_creates_is_idempotent_and_refuses_elsewhere() {
        use std::os::unix::fs::symlink;
        let home = tmp_home("climake");
        let (link, shim, bin) = cli_paths(&home);
        let on = OsString::from(format!("{}:/usr/bin", bin.display()));

        // Fresh link, on PATH.
        let st = link_cli_for(&home, &link, &shim, &on).expect("links");
        assert_eq!(st.status, "linked-ok");
        assert!(st.message.starts_with("linked ~/.local/bin/stack -> "), "message: {}", st.message);
        assert_eq!(std::fs::read_link(&link).unwrap(), shim);

        // Already correct: a no-op that still reports ok.
        let st = link_cli_for(&home, &link, &shim, &on).expect("idempotent");
        assert_eq!(st.status, "linked-ok");
        assert_eq!(std::fs::read_link(&link).unwrap(), shim);

        // A link to something else is reported, never replaced.
        std::fs::remove_file(&link).unwrap();
        let other = home.join("elsewhere");
        std::fs::write(&other, "x\n").unwrap();
        symlink(&other, &link).unwrap();
        let st = link_cli_for(&home, &link, &shim, &on).expect("reports, not errors");
        assert_eq!(st.status, "points-elsewhere");
        assert_eq!(std::fs::read_link(&link).unwrap(), other);

        // Fresh link while the bin dir is off PATH says both.
        std::fs::remove_file(&link).unwrap();
        let st = link_cli_for(&home, &link, &shim, OsStr::new("/usr/bin")).expect("links");
        assert_eq!(st.status, "bin-not-on-PATH");
        assert!(st.message.contains("linked ~/.local/bin/stack -> "), "message: {}", st.message);
        assert!(st.message.contains("is not on PATH"), "message: {}", st.message);
        let _ = std::fs::remove_dir_all(&home);
    }

    // The real subprocess flow against stub gh/git binaries: proves the
    // lookup, auth check and clone argv end to end without network.
    #[cfg(unix)]
    mod shell {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        use std::rc::Rc;

        fn write_stub(dir: &Path, name: &str, body: &str) {
            let p = dir.join(name);
            std::fs::write(&p, body).unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        /// A `gh` stub: `auth status` exits `auth_exit`; `repo clone`
        /// fakes a usable checkout at the destination (`$4`).
        fn gh_stub(dir: &Path, auth_exit: i32) {
            write_stub(
                dir,
                "gh",
                &format!(
                    "#!/bin/sh\nif [ \"$1\" = \"auth\" ]; then exit {auth_exit}; fi\n\
                     if [ \"$1\" = \"repo\" ] && [ \"$2\" = \"clone\" ] && [ \"$3\" = \"escacs/stack\" ]; then\n  \
                     mkdir -p \"$4/tools/stack\" \"$4/.git\"\n  echo stub > \"$4/tools/stack/cli.mjs\"\n  \
                     echo ref: refs/heads/main > \"$4/.git/HEAD\"\n  exit 0\nfi\nexit 9\n"
                ),
            );
        }

        /// A `git` stub: clones (last argv) into a usable checkout, or fails.
        fn git_stub(dir: &Path, clone_exit: i32) {
            write_stub(
                dir,
                "git",
                &format!(
                    "#!/bin/sh\nfor a in \"$@\"; do dest=\"$a\"; done\n\
                     if [ \"$1\" = \"-c\" ] && [ \"{clone_exit}\" -eq 0 ]; then\n  \
                     mkdir -p \"$dest/tools/stack\" \"$dest/.git\"\n  echo stub > \"$dest/tools/stack/cli.mjs\"\n  \
                     echo ref: refs/heads/main > \"$dest/.git/HEAD\"\nfi\n\
                     [ \"$GIT_TERMINAL_PROMPT\" = \"0\" ] || exit 7\nexit {clone_exit}\n"
                ),
            );
        }

        fn shell_exec(
            stub: &Path,
            pinned: Rc<RefCell<Vec<String>>>,
        ) -> ShellExec<impl Fn(&str) -> Result<(), String>> {
            ShellExec {
                pin: move |p: &str| {
                    pinned.borrow_mut().push(p.to_string());
                    Ok(())
                },
                path_var: stub.as_os_str().to_os_string(),
                appdir: OsString::new(),
            }
        }

        #[test]
        fn shell_gh_clone_end_to_end() {
            let home = tmp_home("sh-gh");
            let stub = home.join("stub");
            std::fs::create_dir_all(&stub).unwrap();
            gh_stub(&stub, 0);
            git_stub(&stub, 0);
            let pinned = Rc::new(RefCell::new(Vec::new()));
            let exec = shell_exec(&stub, pinned.clone());
            let r = provision_with(&inputs(&home, None, None), &exec);
            assert_eq!(r.status, "cloned-gh");
            assert_eq!(r.message, "cloned with gh to ~/escacs/stack");
            assert!(is_usable_checkout(&home.join("escacs/stack")));
            assert_eq!(pinned.borrow().len(), 1);
            let _ = std::fs::remove_dir_all(&home);
        }

        #[test]
        fn shell_ssh_fallback_end_to_end() {
            let home = tmp_home("sh-ssh");
            let stub = home.join("stub");
            std::fs::create_dir_all(&stub).unwrap();
            gh_stub(&stub, 1);
            git_stub(&stub, 0);
            let pinned = Rc::new(RefCell::new(Vec::new()));
            let exec = shell_exec(&stub, pinned.clone());
            let r = provision_with(&inputs(&home, None, None), &exec);
            assert_eq!(r.status, "cloned-ssh");
            assert!(is_usable_checkout(&home.join("escacs/stack")));
            let _ = std::fs::remove_dir_all(&home);
        }

        #[test]
        fn shell_all_failed_end_to_end() {
            let home = tmp_home("sh-fail");
            let stub = home.join("stub");
            std::fs::create_dir_all(&stub).unwrap();
            gh_stub(&stub, 1);
            git_stub(&stub, 3);
            let pinned = Rc::new(RefCell::new(Vec::new()));
            let exec = shell_exec(&stub, pinned.clone());
            let r = provision_with(&inputs(&home, None, None), &exec);
            assert_eq!(r.status, "manual");
            assert!(r.message.contains("run gh auth login, then retry"));
            assert!(!home.join("escacs/stack").exists(), "half clone removed");
            assert!(pinned.borrow().is_empty());
            let _ = std::fs::remove_dir_all(&home);
        }
    }
}
