//! Project validation: confirm a picked folder is a readable directory and
//! report which known markers it contains. Plus a read-only listing of the
//! folders that could be unimported stack entries, for the project page's
//! adopt suggestions. Never executes anything inside the project.

use serde::Serialize;
use std::path::Path;

const MARKERS: &[&str] = &[
    "stack.toml",
    ".agents/skills",
    "package.json",
    ".git",
    "src-tauri/tauri.conf.json",
    "Cargo.toml",
    "README.md",
    "AGENTS.md",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectReport {
    pub path: String,
    pub valid: bool,
    pub markers: Vec<String>,
    pub errors: Vec<String>,
}

#[tauri::command(async)]
pub fn validate_project(path: String) -> Result<ProjectReport, String> {
    let canon = match Path::new(&path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            return Ok(ProjectReport {
                path,
                valid: false,
                markers: vec![],
                errors: vec![format!("cannot resolve path: {e}")],
            });
        }
    };
    let mut errors = Vec::new();
    if !canon.is_dir() {
        errors.push("path is not a directory".to_string());
    }
    let markers = if canon.is_dir() {
        MARKERS
            .iter()
            .filter(|m| canon.join(m).exists())
            .map(|m| m.to_string())
            .collect()
    } else {
        vec![]
    };
    let valid = errors.is_empty();
    Ok(ProjectReport {
        path: canon.display().to_string(),
        valid,
        markers,
        errors,
    })
}

/// Roots scanned for adoptable folders: (relative root, levels below it).
/// Skills and styles land in `.agents/skills/<name>` (with a
/// `.claude/skills/<name>` link beside it); anything else defaults to
/// `.stack/<id>`; hand-placed components often sit in
/// `src/components/<name>`. `.stack` needs depth 3 for
/// `.stack/components/<library>/<name>`.
const FOLDER_ROOTS: &[(&str, usize)] = &[
    (".agents/skills", 1),
    (".claude/skills", 1),
    ("src/components", 1),
    (".stack", 3),
];

/// Cap on reported folders: a huge `.stack` tree must not flood the bridge.
const MAX_FOLDERS: usize = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolders {
    pub folders: Vec<String>,
}

/// Subdirectories of `root` up to `depth` levels deep, as project-relative
/// posix paths. Only names are read, never file contents. Symlinks are
/// listed but never descended into, so a link pointing outside the project
/// leaks only its own name. Hidden names are skipped.
fn collect_dirs(root: &Path, prefix: &str, depth: usize, out: &mut Vec<String>) {
    if depth == 0 || out.len() >= MAX_FOLDERS {
        return;
    }
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if out.len() >= MAX_FOLDERS {
            return;
        }
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let rel = format!("{prefix}/{}", name.to_string_lossy());
        let ftype = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ftype.is_symlink() {
            out.push(rel);
        } else if ftype.is_dir() {
            out.push(rel.clone());
            collect_dirs(&entry.path(), &rel, depth - 1, out);
        }
    }
}

fn list_project_folders(canon: &Path) -> Vec<String> {
    let mut folders = Vec::new();
    for (root, depth) in FOLDER_ROOTS {
        let dir = canon.join(root);
        if dir.is_dir() {
            collect_dirs(&dir, root, *depth, &mut folders);
        }
    }
    folders.sort();
    folders.truncate(MAX_FOLDERS);
    folders
}

/// List the project folders that could be stack entries imported by hand:
/// one level under the skills dirs and `src/components`, three under
/// `.stack`. The frontend matches these names against the catalog; matching
/// is by name only, so a folder here is a suggestion, not proof.
#[tauri::command(async)]
pub fn project_folders(path: String) -> Result<ProjectFolders, String> {
    let canon = match Path::new(&path).canonicalize() {
        Ok(p) => p,
        Err(e) => return Err(format!("cannot resolve path: {e}")),
    };
    if !canon.is_dir() {
        return Err("path is not a directory".to_string());
    }
    Ok(ProjectFolders {
        folders: list_project_folders(&canon),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("stack-app-folders-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn project_folders_lists_known_roots_only() {
        let p = proj("roots");
        for d in [
            ".agents/skills/file-pr",
            ".agents/skills/.hidden",
            ".claude/skills/ponytail",
            "src/components/button",
            "src/components/nested/too-deep",
            ".stack/systems/eng",
            ".stack/components/react/button",
            ".stack/a/b/c/d",
        ] {
            std::fs::create_dir_all(p.join(d)).unwrap();
        }
        std::fs::write(p.join(".agents/skills/note.txt"), "not a dir").unwrap();
        std::fs::create_dir_all(p.join("other/place")).unwrap();

        let folders = list_project_folders(&p);
        assert!(folders.contains(&".agents/skills/file-pr".to_string()));
        assert!(folders.contains(&".claude/skills/ponytail".to_string()));
        assert!(folders.contains(&"src/components/button".to_string()));
        assert!(folders.contains(&".stack/systems/eng".to_string()));
        assert!(folders.contains(&".stack/components/react/button".to_string()));
        // Intermediate dirs show up too: matching is by full path, so the
        // frontend skips the ones that name no entry.
        assert!(folders.contains(&".stack/systems".to_string()));
        // Files, hidden names, unknown roots and over-deep levels do not.
        assert!(!folders.iter().any(|f| f.contains("note.txt")));
        assert!(!folders.iter().any(|f| f.contains(".hidden")));
        assert!(!folders.iter().any(|f| f.starts_with("other/")));
        assert!(!folders.contains(&"src/components/nested/too-deep".to_string()));
        assert!(!folders.contains(&".stack/a/b/c/d".to_string()));
        assert!(folders.contains(&".stack/a/b/c".to_string()));
        let mut sorted = folders.clone();
        sorted.sort();
        assert_eq!(folders, sorted);
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn project_folders_lists_but_never_descends_symlinks() {
        let p = proj("links");
        std::fs::create_dir_all(p.join(".stack/real/child")).unwrap();
        std::fs::create_dir_all(p.join(".agents/skills")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(p.join(".stack/real"), p.join(".agents/skills/linked")).unwrap();
        let folders = list_project_folders(&p);
        assert!(folders.contains(&".stack/real/child".to_string()));
        #[cfg(unix)]
        {
            assert!(folders.contains(&".agents/skills/linked".to_string()));
            assert!(!folders.iter().any(|f| f.starts_with(".agents/skills/linked/")));
        }
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn project_folders_empty_project_lists_nothing() {
        let p = proj("empty");
        assert!(list_project_folders(&p).is_empty());
        let _ = std::fs::remove_dir_all(&p);
    }
}
