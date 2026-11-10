//! Project validation: confirm a picked folder is a readable directory and
//! report which known markers it contains. Read-only; never executes anything
//! inside the project.

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

#[tauri::command]
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
