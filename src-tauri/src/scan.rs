//! Project-folder scanner: list immediate subdirectories of configured
//! scan roots, reporting which known markers each one contains.
//!
//! Confined and shallow by construction: depth 1 only (never into
//! `node_modules`, `target`, `.git`, or anything nested), at most
//! [`MAX_SCAN_RESULTS`] entries, symlinks escaping the root skipped, and no
//! file contents ever read — only `stat`-level existence checks.

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::paths::canonical_dir;

/// Hard cap on repos returned per scan (across all roots).
pub const MAX_SCAN_RESULTS: usize = 200;
/// Hard cap on roots scanned in one call.
pub const MAX_SCAN_ROOTS: usize = 16;

/// Markers probed (existence only) inside each candidate directory.
const SCAN_MARKERS: &[&str] = &[
    ".git",
    "stack.toml",
    ".agents/skills",
    ".claude/skills",
    ".stack",
    ".gitignore",
];

/// Home folder candidates appended to the defaults when they exist.
const HOME_CANDIDATES: &[&str] = &["Projects", "dev", "code"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRepo {
    pub path: String,
    pub name: String,
    pub has_lock: bool,
    /// Which of `.git`, `stack.toml`, `.agents/skills`,
    /// `.claude/skills`, `.stack`, `.gitignore` exist here.
    pub markers: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOut {
    /// First scanned root (kept for older frontends; prefer `roots`).
    pub root: String,
    pub roots: Vec<String>,
    pub repos: Vec<ScanRepo>,
    /// True when more candidates existed than the 200-result cap.
    pub capped: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRoots {
    pub roots: Vec<String>,
    pub stack_path: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

/// Default roots: the parent of the stack clone, plus `~/Projects`, `~/dev`
/// and `~/code` when they exist. Returns the roots plus the resolved stack
/// dir (if any) for context.
pub fn default_roots(stack_override: Option<&str>) -> (Vec<PathBuf>, Option<PathBuf>) {
    let mut roots: Vec<PathBuf> = Vec::new();
    let stack = crate::stack::resolve_stack_dir(stack_override)
        .ok()
        .map(|(p, _)| p);
    if let Some(ref s) = stack {
        if let Some(parent) = s.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    if let Some(home) = home_dir() {
        for cand in HOME_CANDIDATES {
            let p = home.join(cand);
            if p.is_dir() {
                roots.push(p);
            }
        }
    }
    // Dedup (a home candidate can equal the stack parent).
    let mut seen = std::collections::HashSet::new();
    roots.retain(|r| {
        let key = r.canonicalize().unwrap_or_else(|_| r.clone());
        seen.insert(key)
    });
    roots.truncate(MAX_SCAN_ROOTS);
    (roots, stack)
}

/// Scan one root, depth 1 only, appending candidates to `out`. Never reads
/// file contents, never recurses. Capping happens centrally in
/// [`sort_and_cap`], after lock-holders sort first.
fn scan_one_root(root: &Path, out: &mut Vec<ScanRepo>) -> Result<(), String> {
    let canon_root = canonical_dir(root, "resolve scan root")?;
    let entries =
        std::fs::read_dir(&canon_root).map_err(|e| format!("read '{}': {e}", canon_root.display()))?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // unreadable entry: skip, keep scanning
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        // Candidates are reported by their as-scanned path (canonical root
        // plus name). Symlinks must resolve inside the root and to a dir.
        let link_path = entry.path();
        let dir_path: PathBuf = if file_type.is_symlink() {
            let target = match link_path.canonicalize() {
                Ok(t) => t,
                Err(_) => continue, // dangling link: skip
            };
            if !target.starts_with(&canon_root) {
                continue; // escape: skip
            }
            if !target.is_dir() {
                continue;
            }
            link_path
        } else {
            if !file_type.is_dir() {
                continue; // files are not candidates
            }
            link_path
        };
        let markers: Vec<String> = SCAN_MARKERS
            .iter()
            .filter(|m| dir_path.join(m).exists())
            .map(|m| m.to_string())
            .collect();
        out.push(ScanRepo {
            path: dir_path.display().to_string(),
            name,
            has_lock: markers.iter().any(|m| m == "stack.toml"),
            markers,
        });
    }
    Ok(())
}

fn sort_and_cap(mut repos: Vec<ScanRepo>) -> (Vec<ScanRepo>, bool) {
    // Dedup by reported path (the same root can be listed twice),
    // lock-holders first, then by name for a stable order.
    let mut seen = std::collections::HashSet::new();
    repos.retain(|r| seen.insert(r.path.clone()));
    repos.sort_by(|a, b| {
        b.has_lock
            .cmp(&a.has_lock)
            .then_with(|| a.name.cmp(&b.name))
    });
    let capped = repos.len() > MAX_SCAN_RESULTS;
    repos.truncate(MAX_SCAN_RESULTS);
    (repos, capped)
}

/// Scan configured roots for project folders. Explicit `roots` (or the legacy
/// single `root`) win; with neither, the defaults are used (parent of the
/// stack clone plus existing `~/Projects`, `~/dev`, `~/code`).
/// `stack_dir` is only the settings override for resolving those defaults.
#[tauri::command(async)]
pub fn scan_projects(
    root: Option<String>,
    roots: Option<Vec<String>>,
    stack_dir: Option<String>,
) -> Result<ScanOut, String> {
    let mut requested: Vec<PathBuf> = Vec::new();
    let mut used_defaults = false;
    if let Some(rs) = roots {
        if !rs.is_empty() {
            requested = rs.iter().map(PathBuf::from).collect();
        }
    }
    if requested.is_empty() {
        if let Some(r) = root {
            if !r.trim().is_empty() {
                requested.push(PathBuf::from(r));
            }
        }
    }
    if requested.is_empty() {
        let (defaults, _) = default_roots(stack_dir.as_deref());
        requested = defaults;
        used_defaults = true;
    }
    if requested.len() > MAX_SCAN_ROOTS {
        return Err(format!(
            "too many scan roots ({}); at most {MAX_SCAN_ROOTS}",
            requested.len()
        ));
    }
    let mut repos: Vec<ScanRepo> = Vec::new();
    let mut scanned: Vec<String> = Vec::new();
    for req in &requested {
        // Explicit roots fail loudly; default roots are best-effort.
        match canonical_dir(req, "resolve scan root") {
            Ok(canon) => {
                scan_one_root(&canon, &mut repos)?;
                scanned.push(canon.display().to_string());
            }
            Err(e) => {
                if !used_defaults {
                    return Err(e);
                }
            }
        }
    }
    let (repos, capped) = sort_and_cap(repos);
    Ok(ScanOut {
        root: scanned.first().cloned().unwrap_or_default(),
        roots: scanned,
        repos,
        capped,
    })
}

/// Report the default scan roots without scanning (for settings UI).
#[tauri::command(async)]
pub fn default_scan_roots(stack_dir: Option<String>) -> ScanRoots {
    let (roots, stack) = default_roots(stack_dir.as_deref());
    ScanRoots {
        roots: roots.iter().map(|r| r.display().to_string()).collect(),
        stack_path: stack.map(|s| s.display().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_base(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("stack-app-scan-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn reports_markers_and_orders_lock_first() {
        let base = tmp_base("markers");
        let root = base.join("home");
        std::fs::create_dir_all(root.join("plain")).unwrap();
        std::fs::create_dir_all(root.join("gitty/.git")).unwrap();
        std::fs::create_dir_all(root.join("locked/.git")).unwrap();
        std::fs::write(root.join("locked/stack.toml"), "# lock\n").unwrap();
        std::fs::write(root.join("top-file.txt"), "x").unwrap();
        // Nested dirs are never candidates (depth 1 only).
        std::fs::create_dir_all(root.join("locked/nested/.git")).unwrap();

        let mut repos = Vec::new();
        scan_one_root(&root, &mut repos).unwrap();
        let (repos, capped) = sort_and_cap(repos);
        assert!(!capped);
        let names: Vec<&str> = repos.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["locked", "gitty", "plain"]);
        assert!(repos[0].has_lock);
        assert!(repos[0].markers.contains(&".git".to_string()));
        assert!(repos[0].markers.contains(&"stack.toml".to_string()));
        assert_eq!(repos[1].markers, vec![".git".to_string()]);
        assert!(repos[2].markers.is_empty());
        assert!(!repos[2].has_lock);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn caps_results_at_200() {
        let base = tmp_base("cap");
        let root = base.join("many");
        std::fs::create_dir_all(&root).unwrap();
        for i in 0..205 {
            std::fs::create_dir_all(root.join(format!("proj-{i:03}"))).unwrap();
        }
        let mut repos = Vec::new();
        scan_one_root(&root, &mut repos).unwrap();
        let (repos, capped) = sort_and_cap(repos);
        assert!(capped);
        assert_eq!(repos.len(), MAX_SCAN_RESULTS);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks_escaping_the_root() {
        let base = tmp_base("links");
        let root = base.join("root");
        let outside = base.join("outside");
        std::fs::create_dir_all(root.join("real")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("evil")).unwrap();
        std::os::unix::fs::symlink("real", root.join("alias")).unwrap();
        std::os::unix::fs::symlink("dangling-target", root.join("dangling")).unwrap();

        let mut repos = Vec::new();
        scan_one_root(&root, &mut repos).unwrap();
        let (repos, _) = sort_and_cap(repos);
        let names: Vec<&str> = repos.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"real"));
        assert!(names.contains(&"alias"), "inside link kept: {names:?}");
        assert!(!names.contains(&"evil"), "escape skipped: {names:?}");
        assert!(!names.contains(&"dangling"), "dangling skipped: {names:?}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn explicit_missing_root_is_an_error() {
        let out = scan_projects(
            Some("/nonexistent-scan-root-xyz".to_string()),
            None,
            None,
        );
        assert!(out.is_err());
    }

    #[test]
    fn too_many_roots_rejected() {
        let roots: Vec<String> = (0..MAX_SCAN_ROOTS + 1).map(|i| format!("/tmp/r{i}")).collect();
        let out = scan_projects(None, Some(roots), None);
        assert!(out.unwrap_err().contains("too many scan roots"));
    }

    #[test]
    fn default_roots_include_stack_parent() {
        let base = tmp_base("roots");
        let stack = base.join("stack");
        std::fs::create_dir_all(&stack).unwrap();
        let canon = stack.canonicalize().unwrap();
        let (roots, resolved) = default_roots(Some(&stack.display().to_string()));
        assert_eq!(resolved.unwrap(), canon);
        let parent = canon.parent().expect("stack has a parent");
        assert!(
            roots.iter().any(|r| r == parent),
            "stack parent {parent:?} in {roots:?}"
        );
        let _ = std::fs::remove_dir_all(&base);
    }
}
