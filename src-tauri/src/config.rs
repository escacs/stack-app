//! Persistent app config: recent projects, stack path, scan root, and the
//! selected worker/project. Stored as JSON in the platform config dir
//! (`<config>/codes.escacs.stack/config.json`); no secrets are kept here.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const MAX_RECENT: usize = 10;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub recent_projects: Vec<String>,
    #[serde(default)]
    pub stack_path: Option<String>,
    #[serde(default)]
    pub scan_root: Option<String>,
    /// Extra scan roots beyond `scan_root` (settings UI). Frontends must
    /// round-trip this field: `save_config` stores exactly what it gets.
    #[serde(default)]
    pub scan_roots: Vec<String>,
    #[serde(default)]
    pub worker: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    Ok(dir.join("config.json"))
}

#[tauri::command(async)]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("parse config: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AppConfig::default()),
        Err(e) => Err(format!("read config: {e}")),
    }
}

#[tauri::command(async)]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let mut config = config;
    config.recent_projects.truncate(MAX_RECENT);
    config.scan_roots.truncate(crate::scan::MAX_SCAN_ROOTS);
    let path = config_path(&app)?;
    let text =
        serde_json::to_string_pretty(&config).map_err(|e| format!("encode config: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("write config: {e}"))?;
    Ok(())
}

/// Prepend `path` to the recent-projects list (deduplicated, capped).
#[tauri::command(async)]
pub fn add_recent_project(app: AppHandle, path: String) -> Result<AppConfig, String> {
    let mut config = get_config(app.clone())?;
    config.recent_projects.retain(|p| p != &path);
    config.recent_projects.insert(0, path);
    config.recent_projects.truncate(MAX_RECENT);
    save_config(app, config.clone())?;
    Ok(config)
}
