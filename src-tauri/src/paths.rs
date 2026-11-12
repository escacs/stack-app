//! Path confinement: everything the app touches must sit inside the selected
//! project dir, the stack dir, or its own config dir. Helpers canonicalize
//! (resolving `..` and symlinks) and then enforce containment, so traversal
//! and symlink escapes are rejected.

use std::path::{Component, Path, PathBuf};

/// Canonicalize `dir`; it must exist and be a directory.
pub fn canonical_dir(dir: &Path, what: &str) -> Result<PathBuf, String> {
    let resolved = dir
        .canonicalize()
        .map_err(|e| format!("{what} '{}': {e}", dir.display()))?;
    if !resolved.is_dir() {
        return Err(format!("{what} '{}' is not a directory", dir.display()));
    }
    Ok(resolved)
}

/// Canonicalize an existing `path` and require it to sit inside `root`.
pub fn confine_existing(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = canonical_dir(root, "resolve root")?;
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("resolve '{}': {e}", path.display()))?;
    if !resolved.starts_with(&root) {
        return Err(format!("'{}' escapes its root directory", path.display()));
    }
    Ok(resolved)
}

/// Express an existing absolute `path` as a project-relative posix path
/// inside `root`. Both sides are canonicalized, so `..` and symlinks that
/// escape the project are rejected. The project dir itself is rejected: the
/// adopt picker needs a folder *inside* the project, not the project root.
pub fn relative_inside(root: &Path, path: &Path) -> Result<String, String> {
    let root = canonical_dir(root, "resolve root")?;
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("resolve '{}': {e}", path.display()))?;
    if !resolved.is_dir() {
        return Err("pick a folder inside the project".to_string());
    }
    let rel = resolved
        .strip_prefix(&root)
        .map_err(|_| "folder is outside this project".to_string())?;
    if rel.as_os_str().is_empty() {
        return Err("pick a folder inside the project, not the project itself".to_string());
    }
    let mut parts: Vec<String> = Vec::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(c) => parts.push(c.to_string_lossy().into_owned()),
            _ => return Err("folder is outside this project".to_string()),
        }
    }
    if parts.is_empty() {
        return Err("pick a folder inside the project, not the project itself".to_string());
    }
    Ok(parts.join("/"))
}

/// Join a project-relative `user` path onto `root` without requiring it to
/// exist (for `--to` targets). Absolute paths and lexical `..` escapes are
/// rejected; then the longest existing prefix is canonicalized to catch
/// symlink escapes through existing parents.
pub fn join_inside(root: &Path, user: &str) -> Result<PathBuf, String> {
    if user.is_empty() || user.len() > 512 {
        return Err("invalid path".to_string());
    }
    let root = canonical_dir(root, "resolve root")?;
    let mut out = root.clone();
    for comp in Path::new(user).components() {
        match comp {
            Component::Prefix(_) | Component::RootDir => {
                return Err("use a project-relative path, not an absolute one".to_string());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
                if !out.starts_with(&root) {
                    return Err("path escapes the project directory".to_string());
                }
            }
            Component::Normal(c) => out.push(c),
        }
    }
    let mut cursor = out.as_path();
    loop {
        if cursor.exists() {
            let resolved = cursor
                .canonicalize()
                .map_err(|e| format!("resolve path: {e}"))?;
            if !resolved.starts_with(&root) {
                return Err("path escapes the project directory through a symlink".to_string());
            }
            return Ok(out);
        }
        cursor =
            cursor
                .parent()
                .ok_or_else(|| "path escapes the project directory".to_string())?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("stack-app-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn join_inside_accepts_relative() {
        let root = tmp_root("rel");
        let out = join_inside(&root, "src/components/button").unwrap();
        assert!(out.starts_with(root.canonicalize().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn join_inside_rejects_dotdot_escape() {
        let root = tmp_root("dotdot");
        assert!(join_inside(&root, "../outside").is_err());
        assert!(join_inside(&root, "a/../../outside").is_err());
        assert!(join_inside(&root, "a/../b").is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn join_inside_rejects_absolute() {
        let root = tmp_root("abs");
        assert!(join_inside(&root, "/etc/passwd").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn join_inside_rejects_symlink_escape() {
        let root = tmp_root("link");
        let outside = tmp_root("link-outside");
        std::os::unix::fs::symlink(&outside, root.join("evil")).unwrap();
        assert!(join_inside(&root, "evil/new-file").is_err());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn confine_existing_rejects_outside() {
        let root = tmp_root("conf");
        let outside = tmp_root("conf-out");
        let f = outside.join("x.txt");
        std::fs::write(&f, "x").unwrap();
        assert!(confine_existing(&root, &f).is_err());
        let inside = root.join("y.txt");
        std::fs::write(&inside, "y").unwrap();
        assert!(confine_existing(&root, &inside).is_ok());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn relative_inside_returns_posix_relative() {
        let root = tmp_root("relin");
        std::fs::create_dir_all(root.join(".agents/skills/file-pr")).unwrap();
        let rel = relative_inside(&root, &root.join(".agents/skills/file-pr")).unwrap();
        assert_eq!(rel, ".agents/skills/file-pr");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn relative_inside_rejects_outside_and_root() {
        let root = tmp_root("relout");
        let outside = tmp_root("relout-out");
        std::fs::create_dir_all(outside.join("elsewhere")).unwrap();
        assert_eq!(
            relative_inside(&root, &outside.join("elsewhere")).unwrap_err(),
            "folder is outside this project"
        );
        assert!(relative_inside(&root, &root).is_err());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn relative_inside_rejects_symlink_escape() {
        let root = tmp_root("rellink");
        let outside = tmp_root("rellink-out");
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("evil")).unwrap();
        assert_eq!(
            relative_inside(&root, &root.join("evil")).unwrap_err(),
            "folder is outside this project"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
