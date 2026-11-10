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
}
