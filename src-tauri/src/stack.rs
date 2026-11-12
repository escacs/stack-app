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
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
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
/// `import` also accepts `--dry-run`: the project page dry-runs each
/// adoptable folder to learn whether its files are identical or differ.
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

/// Flags that take a value. `--json`, `--offline` and `--dry-run` (booleans) and `--`
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
/// Accepts `--json` (boolean, passed through to the CLI), `--offline`
/// (boolean, read-only list/search/show/status: skips the remote-cache
/// network sync, ~1s on status), `--dry-run`
/// (boolean, `import` and `preset apply` only: both write nothing) and `--`
/// (separator: everything after it is positional, never a flag).
fn build_argv(sub: &str, args: &[String], project: &Path) -> Result<BuiltArgv, String> {
    let mut positionals: Vec<&str> = Vec::new();
    let mut kind: Option<&str> = None;
    let mut to: Option<&str> = None;
    let mut git_ref: Option<&str> = None;
    let mut file: Option<&str> = None;
    let mut json = false;
    let mut dryrun = false;
    let mut offline = false;
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
        } else if a == "--offline" {
            offline = true;
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
    if dryrun && !matches!(sub, "preset" | "import") {
        return Err("--dry-run is only supported by import and preset apply".to_string());
    }
    if offline && !matches!(sub, "list" | "search" | "show" | "status") {
        return Err("--offline is only supported by list, search, show and status".to_string());
    }
    // Emit flags in one deterministic order: --kind, --to, --ref, --file,
    // --dry-run, --offline, --json.
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
        if offline {
            flags.push("--offline".to_string());
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
                flag_vec(false, true, true, false, true)?,
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

/// A directory the AppImage runtime may mount under.
fn is_tmp_dir(d: &Path) -> bool {
    d == Path::new("/tmp")
        || d == Path::new("/var/tmp")
        || d == std::env::temp_dir()
        || d.starts_with("/run/user")
}

/// True for a path inside an AppImage mount. The runtime mounts a bundle at
/// `<tmp>/.mount_<name><random>`, and a relaunch (the updater, or starting the
/// app from another instance) inherits the PREVIOUS instance's mount in
/// `PATH` and `LD_LIBRARY_PATH` as well, so this recognises any such mount,
/// not only this run's `APPDIR`. A `.mount_*` directory elsewhere (say under
/// the home folder) is the user's and is left alone.
fn is_bundle_path(p: &Path, appdir: &OsStr) -> bool {
    (!appdir.is_empty() && p.starts_with(appdir))
        || p.ancestors().any(|a| {
            a.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(".mount_"))
                && a.parent().is_some_and(is_tmp_dir)
        })
}

/// A path list with bundle entries removed (and, for library lists, empty
/// entries: an empty library-path entry means the current directory), or
/// `None` when nothing remains. Pure so tests can pin it without touching the
/// process env.
fn strip_entries(list: &OsStr, appdir: &OsStr, drop_empty: bool) -> Option<OsString> {
    let kept: Vec<_> = std::env::split_paths(list)
        .filter(|p| !(drop_empty && p.as_os_str().is_empty()) && !is_bundle_path(p, appdir))
        .collect();
    if kept.is_empty() {
        None
    } else {
        std::env::join_paths(kept).ok()
    }
}

/// Whether any entry of a path list lives in an AppImage mount.
fn has_bundle_entry(list: &OsStr, appdir: &OsStr) -> bool {
    std::env::split_paths(list).any(|p| is_bundle_path(&p, appdir))
}

/// Set once the plain probe printed nothing but a scrubbed environment worked:
/// every later child (`stack_run`) then starts node the same way. Each probe
/// that finishes with a working node replaces it (plain success clears it).
static SCRUB_ENV: AtomicBool = AtomicBool::new(false);
/// A successful probe, kept so each stack call does not pay a second node
/// start. Failures are never cached (installing node while the app is open
/// must work); user actions (boot, pick, re-check) re-probe with
/// [`probe_node_fresh`].
static NODE_OK: Mutex<Option<NodeStatus>> = Mutex::new(None);

/// Variables that make a system `node` die in the loader when the app was
/// started from a bundle (AppImage) or a launcher. Their bundle entries are
/// stripped; the user's own entries stay (Nix, Guix and custom toolchains
/// set these on purpose).
const LOADER_VARS: &[&str] = &["LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT"];
/// Variables the AppImage runtime adds; meaningless to a child node.
const BUNDLE_VARS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

/// Rewrite one path-list variable of the child without its bundle entries.
/// Untouched when it has none (a plain run keeps its env as it is). When
/// nothing else remains the variable is dropped, except `PATH`, which is
/// never deleted. `PATH` keeps its empty entries (they mean the current
/// directory there); library lists lose them.
fn strip_var(cmd: &mut Command, name: &str, value: Option<OsString>, appdir: &OsStr) {
    let Some(val) = value else {
        return;
    };
    if !has_bundle_entry(&val, appdir) {
        return;
    }
    let is_path = name == "PATH";
    match strip_entries(&val, appdir, !is_path) {
        Some(joined) => {
            cmd.env(name, joined);
        }
        None if !is_path => {
            cmd.env_remove(name);
        }
        None => {}
    }
}

/// One cleaning routine for every node child. `deep` is the retry level: it
/// also cleans `LD_PRELOAD` and `LD_AUDIT` and removes the AppImage's own
/// variables. The default level cleans `LD_LIBRARY_PATH` and `PATH`, the
/// two a relaunched AppImage poisons. User entries always stay (Nix, Guix
/// and custom toolchains set these on purpose), and a run with no bundle
/// entries is left untouched. `get` reads the parent environment so tests
/// can feed a fake one.
fn clean_env_with(
    cmd: &mut Command,
    appdir: &OsStr,
    get: impl Fn(&str) -> Option<OsString>,
    deep: bool,
) {
    let loader: &[&str] = if deep { LOADER_VARS } else { &["LD_LIBRARY_PATH"] };
    for v in loader.iter().chain(&["PATH"]) {
        strip_var(cmd, v, get(v), appdir);
    }
    if deep {
        for v in BUNDLE_VARS {
            cmd.env_remove(v);
        }
    }
}

fn clean_env(cmd: &mut Command, deep: bool) {
    let appdir = std::env::var_os("APPDIR").unwrap_or_default();
    clean_env_with(cmd, &appdir, |k| std::env::var_os(k), deep);
}

/// The environment for every stack child: default cleaning, or the retry
/// level once a probe showed it is needed. Shared with provisioning, whose
/// `gh`/`git` children inherit the same poisoned AppImage variables.
pub(crate) fn unpoison_env(cmd: &mut Command) {
    clean_env(cmd, SCRUB_ENV.load(Ordering::Relaxed));
}

/// The `node` the probe tried, for the error text: the same lookup the
/// spawn uses, so the message never names a `./node` the spawn would skip.
/// Only looked up when a probe has failed.
fn find_node_on_path() -> Option<PathBuf> {
    resolve_node()
}

const NODE_NOT_FOUND: &str = "node was not found on PATH. Install Node.js 22 or newer (https://nodejs.org), then relaunch the app.";

#[cfg(unix)]
pub(crate) fn is_executable_file(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
pub(crate) fn is_executable_file(p: &Path) -> bool {
    p.is_file()
}

/// The `PATH` a child will actually see after cleaning: bundle entries
/// stripped, or the original when stripping would empty it (`PATH` is never
/// deleted — see `strip_var`). Cleaning treats `PATH` the same at both
/// levels, so one resolver serves the plain probe, the retry and the spawn.
/// Pure so tests can pin it without touching the process env.
fn effective_path(path_var: &OsStr, appdir: &OsStr) -> OsString {
    strip_entries(path_var, appdir, false).unwrap_or_else(|| path_var.to_os_string())
}

/// First `name` on `PATH` reached through an absolute entry. Empty entries
/// (the current directory) and relative entries (`.`, `bin`, ...) are
/// skipped: a child running with the project as its working directory must
/// never pick up a project's `./node` (or `./gh`, `./git`), which would
/// break the "never run project code" contract. Resolves from the cleaned
/// `PATH` the child will get, so the probe and the spawn always agree on
/// which binary runs. Pure so tests can pin it without touching the process
/// env. Shared with provisioning, which resolves `gh` and `git` the same way.
pub(crate) fn find_binary_in(name: &str, path_var: &OsStr, appdir: &OsStr) -> Option<PathBuf> {
    let effective = effective_path(path_var, appdir);
    for dir in std::env::split_paths(&effective) {
        if dir.as_os_str().is_empty() || !dir.is_absolute() {
            continue;
        }
        let candidate = dir.join(name);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
        // Windows installs node.exe (gh.exe, git.exe); the OS lookup used to
        // find it for us.
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{name}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

fn find_node_in(path_var: &OsStr, appdir: &OsStr) -> Option<PathBuf> {
    find_binary_in("node", path_var, appdir)
}

fn resolve_node() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let appdir = std::env::var_os("APPDIR").unwrap_or_default();
    find_node_in(&path, &appdir)
}

/// One `node --version` probe at an explicit cleaning level, independent of
/// the global decision (a fresh probe must not be masked by an earlier one).
/// Probes the same resolved binary the spawn runs (see [`find_node_in`]).
fn spawn_node_version(deep: bool) -> std::io::Result<Output> {
    let Some(node) = resolve_node() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "node not found on PATH",
        ));
    };
    let mut cmd = Command::new(node);
    cmd.arg("--version");
    clean_env(&mut cmd, deep);
    cmd.output()
}

/// Why a probe that printed no parsable version failed, in one line a person
/// can act on: what node printed, its exit status, its first stderr line and
/// which binary was tried. Pure so tests can pin the wording.
fn describe_unparsable(raw: &str, code: Option<i32>, stderr: &str, path: Option<&Path>) -> String {
    let what = if raw.is_empty() {
        "node --version printed nothing".to_string()
    } else {
        let head: String = raw.chars().take(60).collect();
        let shown = if head.len() < raw.len() { format!("{head}…") } else { head };
        format!("could not parse the node version ({shown:?})")
    };
    let mut msg = what;
    match code {
        Some(c) if c != 0 => msg.push_str(&format!(" (exit {c})")),
        None => msg.push_str(" (killed by a signal)"),
        _ => {}
    }
    if let Some(line) = stderr.lines().map(str::trim).find(|l| !l.is_empty()) {
        let line: String = line.chars().take(200).collect();
        msg.push_str(&format!(": {line}"));
    }
    if let Some(p) = path {
        msg.push_str(&format!(" [node: {}]", p.display()));
    }
    msg.push_str("; need node 22+");
    msg
}

fn node_failed(error: String, version: Option<String>, major: Option<u32>) -> NodeStatus {
    NodeStatus {
        ok: false,
        version,
        major,
        error: Some(error),
    }
}

fn node_status_from(out: &Output, path: Option<&Path>) -> NodeStatus {
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
        Some(m) => node_failed(
            format!(
                "node 22+ is required, found {raw}. Install a newer Node.js (https://nodejs.org), then relaunch the app."
            ),
            Some(raw),
            Some(m),
        ),
        None => node_failed(
            describe_unparsable(
                &raw,
                out.status.code(),
                &String::from_utf8_lossy(&out.stderr),
                path,
            ),
            Some(raw),
            None,
        ),
    }
}

fn not_found_status() -> NodeStatus {
    node_failed(
        "node was not found on PATH. Install Node.js 22 or newer (https://nodejs.org), then relaunch the app."
            .to_string(),
        None,
        None,
    )
}

fn remember(status: &NodeStatus) {
    if let Ok(mut g) = NODE_OK.lock() {
        *g = Some(status.clone());
    }
}

/// Probe node, answering from the cache after a success. Used by every stack
/// call; user actions use [`probe_node_fresh`].
pub fn probe_node() -> NodeStatus {
    if let Some(hit) = NODE_OK.lock().ok().and_then(|g| g.clone()) {
        return hit;
    }
    probe_uncached()
}

/// Probe node again from scratch: forget the cached success, so a node that
/// was fixed, broken or switched is noticed.
pub fn probe_node_fresh() -> NodeStatus {
    // The scrub decision is replaced only when this probe has a result, so a
    // stack call in flight keeps the environment it started with.
    if let Ok(mut g) = NODE_OK.lock() {
        *g = None;
    }
    probe_uncached()
}

fn probe_uncached() -> NodeStatus {
    let first = spawn_node_version(false);
    let status = match &first {
        Ok(out) => node_status_from(out, None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return not_found_status(),
        Err(e) => node_failed(format!("could not run node: {e}"), None, None),
    };
    if status.ok {
        SCRUB_ENV.store(false, Ordering::Relaxed);
        remember(&status);
        return status;
    }
    // A loader crash prints nothing or exits non-zero; a wrapper that prints
    // a banner or a too-old version is not helped by a clean environment.
    let retryable = match &first {
        Ok(out) => {
            status.major.is_none()
                && (out.stdout.iter().all(u8::is_ascii_whitespace) || !out.status.success())
        }
        Err(_) => true,
    };
    let base = status.error.clone();
    let mut failure = match &first {
        Ok(out) if status.major.is_none() => node_status_from(out, find_node_on_path().as_deref()),
        _ => status,
    };
    if !retryable {
        return failure;
    }
    // Retry once with the loader and bundle variables stripped. If that
    // works, every later child starts that way.
    match spawn_node_version(true) {
        Ok(out2) => {
            let second = node_status_from(&out2, None);
            if second.ok {
                SCRUB_ENV.store(true, Ordering::Relaxed);
                remember(&second);
                return second;
            }
            // Say what the retry hit only when it differs from the first
            // failure (`base` is the first message without its node path).
            if let (Some(a), Some(b)) = (failure.error.as_mut(), second.error.as_ref()) {
                if Some(b) != base.as_ref() {
                    a.push_str(&format!(" | clean-environment retry: {b}"));
                }
            }
        }
        Err(e) => {
            if let Some(a) = failure.error.as_mut() {
                a.push_str(&format!(" | clean-environment retry could not run node: {e}"));
            }
        }
    }
    failure
}

#[tauri::command(async)]
pub fn node_status() -> NodeStatus {
    probe_node_fresh()
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
    Err("no escacs/stack checkout found: looked upward from the app, its install folder and the working folder for tools/stack/cli.mjs. Press get stack, or pick your stack clone (the folder containing tools/stack/cli.mjs), or set ESCACS_STACK."
        .to_string())
}

/// A checkout is usable when it is a git repo with HEAD and ships the CLI.
/// Same rule as `usable()` in scripts/provision-stack.sh; shared with
/// provisioning so the two can never drift.
pub(crate) fn is_usable_checkout(dir: &Path) -> bool {
    dir.join("tools/stack/cli.mjs").is_file() && has_git_head(dir)
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
    // Only node missing: say that, and do not blame a checkout that is fine.
    let mut msg = if problems.is_empty() {
        String::new()
    } else {
        format!(
            "'{}' is not a usable stack checkout: {}. Pick the escacs/stack clone (the folder containing tools/stack/cli.mjs).",
            path.display(),
            problems.join("; ")
        )
    };
    if !node.ok {
        if !msg.is_empty() {
            msg.push(' ');
        }
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
#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn validate_stack(stack_dir: Option<String>) -> StackReport {
    let node = probe_node_fresh();
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
#[tauri::command(async)]
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
    // Same binary the probe checked: resolved before the cwd becomes the
    // project dir, so a `./node` in the project can never be executed.
    let Some(node) = resolve_node() else {
        return Err(NODE_NOT_FOUND.to_string());
    };
    let mut cmd = Command::new(node);
    unpoison_env(&mut cmd);
    cmd.arg(&cli)
        .arg(subcommand)
        .args(&argv.flags)
        .arg("--project")
        .arg(&project);
    if !argv.positionals.is_empty() {
        cmd.arg("--").args(&argv.positionals);
    }
    cmd.current_dir(&project);
    let (code, out, err) = match run_with_timeout(&mut cmd, timeout_for(subcommand), subcommand) {
        Ok(r) => r,
        Err(e) => {
            // The cached "node works" may be stale (removed or switched while
            // the app was open): the next call probes again.
            if let Ok(mut g) = NODE_OK.lock() {
                *g = None;
            }
            return Err(e);
        }
    };
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
pub(crate) struct Captured {
    pub(crate) bytes: Vec<u8>,
    pub(crate) truncated: bool,
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

/// SIGKILL the process group led by `pid` (the child runs in its own group,
/// so its pgid is its pid). ESRCH (already gone) is harmless. Unix only.
#[cfg(unix)]
fn kill_process_group(pid: u32) {
    let pgid = pid as i32;
    if pgid > 0 {
        // A negative pid addresses the whole group.
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
}

/// SIGKILL the child and everything it started. On unix the child runs in
/// its own process group, so grandchildren (git fetching in the background)
/// die too instead of holding the pipes open and blocking the drain threads
/// past the timeout. Elsewhere this is a plain kill.
#[cfg(unix)]
fn kill_child_tree(child: &mut std::process::Child) {
    kill_process_group(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(unix))]
fn kill_child_tree(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// How long the pipe drains get after the child exits before the process
/// group is killed: a lingering grandchild must not block the run forever.
#[cfg(unix)]
const DRAIN_GRACE: Duration = Duration::from_secs(2);

/// Join the drain threads after the child exited. On unix a grandchild may
/// still hold the pipes, so the joins get a bounded grace period, then the
/// process group is SIGKILLed and the joins complete. Elsewhere the joins
/// are unconditional (current behaviour).
#[cfg(unix)]
fn join_drains(
    out_h: std::thread::JoinHandle<Captured>,
    err_h: std::thread::JoinHandle<Captured>,
    pid: u32,
) -> (Captured, Captured) {
    let start = Instant::now();
    while !out_h.is_finished() || !err_h.is_finished() {
        if start.elapsed() >= DRAIN_GRACE {
            kill_process_group(pid);
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let out = out_h.join().unwrap_or_else(|_| empty_capture());
    let err = err_h.join().unwrap_or_else(|_| empty_capture());
    (out, err)
}

#[cfg(not(unix))]
fn join_drains(
    out_h: std::thread::JoinHandle<Captured>,
    err_h: std::thread::JoinHandle<Captured>,
    _pid: u32,
) -> (Captured, Captured) {
    let out = out_h.join().unwrap_or_else(|_| empty_capture());
    let err = err_h.join().unwrap_or_else(|_| empty_capture());
    (out, err)
}

/// Run `cmd` with piped output, killing the child past `timeout`. Pipes drain
/// on threads so a chatty child can never deadlock against a full buffer.
pub(crate) fn run_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
    label: &str,
) -> Result<(i32, Captured, Captured), String> {
    run_with_timeout_hint(
        cmd,
        timeout,
        &format!("stack {label}"),
        "The stack clone or node may be busy — retry, or narrow the command.",
    )
}

/// Same runner with the caller's own wording, for non-`stack_run` children
/// (provisioning clones). `what` names the operation ("gh clone of
/// escacs/stack"), `hint` is the one actionable sentence after a timeout.
pub(crate) fn run_with_timeout_hint(
    cmd: &mut Command,
    timeout: Duration,
    what: &str,
    hint: &str,
) -> Result<(i32, Captured, Captured), String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("run {what}: {e}"))?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let out_h = std::thread::spawn(move || drain_capped(stdout));
    let err_h = std::thread::spawn(move || drain_capped(stderr));
    let start = Instant::now();
    let code = loop {
        match child
            .try_wait()
            .map_err(|e| format!("wait for {what}: {e}"))?
        {
            Some(status) => break status.code().unwrap_or(-1),
            None => {
                if start.elapsed() >= timeout {
                    kill_child_tree(&mut child);
                    let _ = out_h.join();
                    let _ = err_h.join();
                    return Err(format!(
                        "{what} timed out after {}s and was killed. {hint}",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    };
    let (out, err) = join_drains(out_h, err_h, child.id());
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

    /// `target` expressed relative to the current dir, so a test can feed
    /// the lookup a relative PATH entry that really leads somewhere. `None`
    /// when they share no root (different Windows drives).
    fn relative_from_cwd(target: &Path) -> Option<PathBuf> {
        let cwd = std::env::current_dir().ok()?;
        let cwd_comps: Vec<_> = cwd.components().collect();
        let tgt_comps: Vec<_> = target.components().collect();
        let common = cwd_comps
            .iter()
            .zip(tgt_comps.iter())
            .take_while(|(a, b)| a == b)
            .count();
        if common == 0 {
            return None;
        }
        let mut rel = PathBuf::new();
        for _ in common..cwd_comps.len() {
            rel.push("..");
        }
        rel.extend(tgt_comps[common..].iter());
        Some(rel)
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
        // import also accepts --dry-run (the project page's adopt hints);
        // no other subcommand does. Preset takes no valued flags.
        assert!(build_argv("list", &args(&["--dry-run"]), &p).is_err());
        assert!(build_argv("update", &args(&["--dry-run"]), &p).is_err());
        let argv = build_argv("import", &args(&["skills/a", "--dry-run", "--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--dry-run", "--json"]);
        assert_eq!(argv.positionals, vec!["skills/a"]);
        assert!(build_argv("preset", &args(&["list", "--kind", "skill"]), &p).is_err());
        assert!(build_argv("preset", &args(&["apply", "web", "--to", "x"]), &p).is_err());
        assert!(build_argv("preset", &args(&["apply", "web", "--ref", "v1"]), &p).is_err());
        assert!(build_argv("preset", &args(&["show", "web", "--file", "x"]), &p).is_err());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn offline_flag_is_read_only_and_ordered_before_json() {
        let p = proj("offline");
        let argv = build_argv("status", &args(&["--json", "--offline"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--offline", "--json"]);
        let argv = build_argv("show", &args(&["--offline", "skills/a", "--json"]), &p).unwrap();
        assert_eq!(argv.flags, vec!["--offline", "--json"]);
        assert!(build_argv("list", &args(&["--offline"]), &p).is_ok());
        assert!(build_argv("search", &args(&["q", "--offline"]), &p).is_ok());
        // Writes keep their network-synced view of the stack.
        for sub in ["import", "update", "remove", "sync", "init", "gitignore", "preset"] {
            assert!(build_argv(sub, &args(&["--offline"]), &p).is_err(), "{sub}");
        }
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
    fn timeout_kills_grandchildren_holding_the_pipes() {
        // `sh -c 'sleep 30 & sleep 30'`: the background sleep inherits the
        // stdout pipe, so killing only sh would leave the drain threads (and
        // the timeout error) blocked for 30s. The group kill must end it all.
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 30 & sleep 30"]);
        let start = Instant::now();
        let err = run_with_timeout(&mut cmd, Duration::from_millis(200), "list")
            .expect_err("sh should have timed out");
        assert!(err.contains("timed out"), "unexpected error: {err}");
        assert!(
            start.elapsed() < Duration::from_secs(15),
            "drain threads blocked past the kill"
        );
    }

    #[cfg(unix)]
    #[test]
    fn exiting_child_with_lingering_grandchild_returns_promptly() {
        // The child exits at once, leaving `sleep 30` holding stdout: the
        // drain joins would block for the full 30s without the bounded
        // post-exit wait. Returns the child's own exit code and output.
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 30 & exec echo done"]);
        let start = Instant::now();
        let (code, out, _err) =
            run_with_timeout(&mut cmd, Duration::from_secs(60), "list").expect("exited child returns");
        assert_eq!(code, 0);
        assert_eq!(String::from_utf8_lossy(&out.bytes).trim(), "done");
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "drains blocked past the grace period"
        );
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
        assert!(err.contains("Pick the escacs/stack clone"));
        assert!(!err.contains("settings"));
        let _ = std::fs::remove_dir_all(&p);
    }

    fn sh_out(script: &str) -> Output {
        Command::new("sh").args(["-c", script]).output().expect("sh runs")
    }

    #[test]
    fn empty_node_output_names_exit_stderr_and_binary() {
        let msg = describe_unparsable(
            "",
            Some(127),
            "\n  node: error while loading shared libraries: libfoo.so\nsecond line",
            Some(Path::new("/opt/node/bin/node")),
        );
        assert!(msg.starts_with("node --version printed nothing (exit 127): node: error while loading"));
        assert!(msg.contains("[node: /opt/node/bin/node]"));
        assert!(msg.ends_with("need node 22+"));
        assert!(!msg.contains("second line"));
        // Garbled output keeps the old wording, quoted and capped.
        let msg = describe_unparsable("hello", Some(0), "", None);
        assert_eq!(msg, "could not parse the node version (\"hello\"); need node 22+");
    }

    #[test]
    fn node_status_from_reads_real_child_output() {
        let ok = node_status_from(&sh_out("printf v22.3.0"), None);
        assert!(ok.ok && ok.major == Some(22));
        let old = node_status_from(&sh_out("printf v20.1.0"), None);
        assert!(!old.ok && old.major == Some(20));
        assert!(old.error.unwrap().contains("node 22+ is required, found v20.1.0"));
        let dead = node_status_from(&sh_out("echo boom >&2; exit 3"), None);
        assert!(!dead.ok && dead.major.is_none());
        let err = dead.error.unwrap();
        assert!(err.contains("printed nothing") && err.contains("(exit 3)") && err.contains("boom"));
    }

    fn env_of(cmd: &Command) -> std::collections::HashMap<String, Option<String>> {
        cmd.get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect()
    }

    #[test]
    fn deep_clean_strips_bundle_entries_but_keeps_the_users() {
        let fake = |k: &str| -> Option<OsString> {
            match k {
                "LD_LIBRARY_PATH" => Some("/tmp/.mount_a/usr/lib:/opt/nix/lib".into()),
                "LD_PRELOAD" => Some("/tmp/.mount_a/usr/lib/shim.so".into()),
                "LD_AUDIT" => Some("/opt/audit.so".into()),
                "PATH" => Some("/tmp/.mount_b/usr/bin:/usr/bin::/opt/x".into()),
                _ => None,
            }
        };
        let mut cmd = Command::new("node");
        clean_env_with(&mut cmd, OsStr::new("/tmp/.mount_a"), fake, true);
        let envs = env_of(&cmd);
        // User entries survive; bundle entries go; a clean var is untouched.
        assert_eq!(envs["LD_LIBRARY_PATH"].as_deref(), Some("/opt/nix/lib"));
        assert_eq!(envs["LD_PRELOAD"], None);
        assert!(!envs.contains_key("LD_AUDIT"));
        // PATH keeps its empty entry (the current directory) and the rest.
        assert_eq!(envs["PATH"].as_deref(), Some("/usr/bin::/opt/x"));
        for v in ["APPDIR", "APPIMAGE", "ARGV0", "OWD"] {
            assert_eq!(envs[v], None, "{v} not removed");
        }
    }

    #[test]
    fn default_clean_leaves_preload_and_the_appimage_vars_alone() {
        let fake = |k: &str| -> Option<OsString> {
            match k {
                "LD_LIBRARY_PATH" => Some("/tmp/.mount_a/usr/lib".into()),
                "LD_PRELOAD" => Some("/tmp/.mount_a/usr/lib/shim.so".into()),
                "PATH" => Some("/tmp/.mount_a/usr/bin".into()),
                _ => None,
            }
        };
        let mut cmd = Command::new("node");
        clean_env_with(&mut cmd, OsStr::new("/tmp/.mount_a"), fake, false);
        let envs = env_of(&cmd);
        assert_eq!(envs["LD_LIBRARY_PATH"], None);
        assert!(!envs.contains_key("LD_PRELOAD"));
        assert!(!envs.contains_key("APPDIR"));
        // PATH is never deleted, even when only bundle entries were in it.
        assert!(!envs.contains_key("PATH"));
    }

    #[test]
    fn only_tmp_mounts_count_as_bundles() {
        let none = OsStr::new("");
        assert!(is_bundle_path(Path::new("/tmp/.mount_stack-x/usr/lib"), none));
        assert!(is_bundle_path(Path::new("/var/tmp/.mount_stack-x/usr/lib"), none));
        assert!(is_bundle_path(Path::new("/run/user/1000/.mount_stack-x/usr/lib"), none));
        // A user's own `.mount_*` directory is not an AppImage mount (unless
        // the machine's TMPDIR points there, which this test cannot assume).
        if std::env::temp_dir() != Path::new("/home/me") {
            assert!(!is_bundle_path(Path::new("/home/me/.mount_data/lib"), none));
        }
        assert!(!is_bundle_path(Path::new("/opt/mine/lib"), none));
        // The current APPDIR always counts.
        assert!(is_bundle_path(Path::new("/opt/odd/dir/usr/lib"), OsStr::new("/opt/odd/dir")));
    }

    #[test]
    fn node_only_failure_does_not_blame_the_checkout() {
        let p = proj("nodeonly");
        let node = NodeStatus {
            ok: false,
            version: None,
            major: None,
            error: Some("node missing".to_string()),
        };
        let err = validation_error(&p, true, true, &node).expect("an error");
        assert_eq!(err, "node missing");
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn strip_appdir_lib_paths_keeps_user_entries() {
        let appdir = OsStr::new("/tmp/.mount_StackAbC123");
        let lib =
            OsStr::new("/tmp/.mount_StackAbC123/usr/lib:/opt/mine/lib:/tmp/.mount_StackAbC123/lib");
        assert_eq!(
            strip_entries(lib, appdir, true).as_deref(),
            Some(OsStr::new("/opt/mine/lib"))
        );
    }

    #[test]
    fn strip_appdir_lib_paths_none_when_all_bundled() {
        let appdir = OsStr::new("/tmp/.mount_StackAbC123");
        let lib = OsStr::new("/tmp/.mount_StackAbC123/usr/lib:/tmp/.mount_StackAbC123/lib");
        assert_eq!(strip_entries(lib, appdir, true), None);
    }

    #[test]
    fn a_relaunched_app_loses_the_previous_instances_mount_too() {
        // Shape captured from a real relaunched AppImage: its own mount plus
        // the previous instance's, a user entry, and a trailing empty entry.
        let appdir = OsStr::new("/tmp/.mount_stack-oFGfeC");
        let lib = OsStr::new(
            "/tmp/.mount_stack-oFGfeC/usr/lib/:/tmp/.mount_stack-djHcmD/usr/lib/:/opt/mine/lib:",
        );
        assert_eq!(
            strip_entries(lib, appdir, true).as_deref(),
            Some(OsStr::new("/opt/mine/lib"))
        );
        // The old mount alone is enough to poison, even without APPDIR.
        let mut cmd = Command::new("node");
        let get = |k: &str| -> Option<OsString> {
            (k == "LD_LIBRARY_PATH").then(|| "/tmp/.mount_stack-djHcmD/usr/lib/".into())
        };
        clean_env_with(&mut cmd, OsStr::new(""), get, false);
        assert_eq!(env_of(&cmd)["LD_LIBRARY_PATH"], None);
        // A user library dir under /tmp that is not a mount survives.
        let kept = strip_entries(OsStr::new("/tmp/mylibs:/tmp/.mount_x/usr/lib"), OsStr::new(""), true);
        assert_eq!(kept.as_deref(), Some(OsStr::new("/tmp/mylibs")));
    }

    #[test]
    fn clean_env_sets_removes_or_leaves_the_library_path() {
        let appdir = OsStr::new("/tmp/.mount_StackAbC123");
        let with = |lib: &'static str| move |k: &str| -> Option<OsString> {
            (k == "LD_LIBRARY_PATH").then(|| lib.into())
        };
        let mut cmd = Command::new("node");
        clean_env_with(
            &mut cmd,
            appdir,
            with("/tmp/.mount_StackAbC123/usr/lib:/opt/mine/lib"),
            false,
        );
        let envs = env_of(&cmd);
        assert_eq!(envs.len(), 1);
        assert_eq!(envs["LD_LIBRARY_PATH"].as_deref(), Some("/opt/mine/lib"));

        let mut bare = Command::new("node");
        clean_env_with(&mut bare, appdir, with("/tmp/.mount_StackAbC123/usr/lib"), false);
        let envs = env_of(&bare);
        assert_eq!(envs.len(), 1);
        assert_eq!(envs["LD_LIBRARY_PATH"], None);

        // No APPDIR (dev runs, deb/rpm installs): env untouched.
        let mut plain = Command::new("node");
        clean_env_with(&mut plain, OsStr::new(""), with("/opt/mine/lib"), false);
        assert_eq!(plain.get_envs().count(), 0);
    }

    #[test]
    fn node_lookup_skips_empty_and_relative_path_entries() {
        // A `./node` planted in the project must never be the one resolved,
        // even when PATH leads with cwd-style entries ("" and ".").
        let p = proj("noderesolve");
        let booby = p.join("node");
        std::fs::write(&booby, "#!/bin/sh\necho pwned\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&booby, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let no_appdir = OsStr::new("");
        assert_eq!(find_node_in(OsStr::new(":.:relative/bin"), no_appdir), None);
        assert_eq!(find_node_in(OsStr::new(""), no_appdir), None);
        // A relative entry that genuinely reaches the planted `node`: this
        // is the ./node case (the child runs with cwd = project dir), and
        // without the relative-entry skip it resolves to the booby trap.
        let rel = relative_from_cwd(&p).expect("temp dir shares a root with the cwd");
        assert!(
            rel.join("node").is_file(),
            "test setup: relative entry reaches the booby trap"
        );
        let only_rel = std::env::join_paths([&rel]).unwrap();
        assert_eq!(find_node_in(&only_rel, no_appdir), None);
        // An absolute entry still resolves, and the answer is always absolute.
        let found = find_node_in(OsStr::new(&p.display().to_string()), no_appdir)
            .expect("absolute entry resolves");
        assert_eq!(found, booby);
        assert!(found.is_absolute());
        // Bundle entries are stripped like the child env: a stale AppImage
        // mount never shadows the real node.
        let with_bundle = format!("/tmp/.mount_stack-app-test-nonexistent/usr/bin:{}", p.display());
        let found = find_node_in(OsStr::new(&with_bundle), no_appdir).expect("user entry resolves");
        assert_eq!(found, booby);
        let _ = std::fs::remove_dir_all(&p);
    }
}
