//! Persistent app config: recent projects, stack path, scan root, and the
//! selected worker/project. Stored as JSON in the platform config dir
//! (`<config>/codes.escacs.stack/config.json`); no secrets are kept here.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const MAX_RECENT: usize = 10;

/// Serializes all config access. Reads take it too, not just writes: a
/// corrupt file is quarantined (a write) during the read, so an unlocked
/// `get_config` could quarantine a file a concurrent writer just saved, or
/// race another reader quarantining the same file.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());
/// Distinguishes temp files within one process (the pid covers the rest).
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

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
    /// One-line notice for the UI, set only when `get_config` recovered from
    /// a corrupt file (which it renames aside to `config.json.bad`). Never
    /// persisted: `save_config` drops whatever the frontend sends and
    /// `write_config_to` always clears it, so stored configs stay clean.
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    Ok(dir.join("config.json"))
}

fn lock_config() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CONFIG_LOCK
        .lock()
        .map_err(|_| "config store is unavailable".to_string())
}

/// Load the config at `path`. A missing file means defaults; an unparsable
/// one is renamed aside to `config.json.bad` and also means defaults, plus a
/// notice for the UI. Pure of Tauri so tests can pin it on a temp dir.
fn load_config_from(path: &Path) -> Result<AppConfig, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(AppConfig::default()),
        Err(e) => return Err(format!("read config: {e}")),
    };
    match serde_json::from_str::<AppConfig>(&text) {
        Ok(config) => Ok(config),
        Err(_) => {
            let bad = path.with_extension("json.bad");
            // Overwrite any older .bad: a rename that fails leaves the corrupt
            // file in place, which would lock the app out again next launch.
            let _ = std::fs::remove_file(&bad);
            std::fs::rename(path, &bad).map_err(|e| format!("quarantine corrupt config: {e}"))?;
            Ok(AppConfig {
                notice: Some(
                    "The settings file was corrupt, so defaults were loaded. The old file was kept as config.json.bad."
                        .to_string(),
                ),
                ..AppConfig::default()
            })
        }
    }
}

/// Write `config` to `path` atomically: temp file in the same dir, then
/// rename, so a crash can never leave a half-written `config.json`.
fn write_config_to(path: &Path, config: &AppConfig) -> Result<(), String> {
    let mut config = config.clone();
    config.recent_projects.truncate(MAX_RECENT);
    config.scan_roots.truncate(crate::scan::MAX_SCAN_ROOTS);
    // A recovery notice is UI-only: it must never land in the stored file.
    config.notice = None;
    let text =
        serde_json::to_string_pretty(&config).map_err(|e| format!("encode config: {e}"))?;
    // Unique per process and per write, so two app instances sharing a
    // config dir can't overwrite each other's temp file.
    let tmp = path.with_extension(format!(
        "json.tmp.{}-{}",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    // A failed write or rename removes the temp file; the previous
    // config.json is never touched, so it stays intact on every error.
    if let Err(e) = std::fs::write(&tmp, &text) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("write config: {e}"));
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("write config: {e}"));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let _guard = lock_config()?;
    let path = config_path(&app)?;
    load_config_from(&path)
}

#[tauri::command(async)]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let _guard = lock_config()?;
    let path = config_path(&app)?;
    write_config_to(&path, &config)
}

/// Pin the stack checkout path (first-run provisioning keeps every other
/// key). Goes through the same locked load/write as every config command.
pub(crate) fn pin_stack_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let _guard = lock_config()?;
    let config_path = config_path(app)?;
    let mut config = load_config_from(&config_path)?;
    config.stack_path = Some(path.to_string());
    write_config_to(&config_path, &config)
}

/// Prepend `path` to the recent-projects list (deduplicated, capped).
#[tauri::command(async)]
pub fn add_recent_project(app: AppHandle, path: String) -> Result<AppConfig, String> {
    let _guard = lock_config()?;
    let config_path = config_path(&app)?;
    let mut config = load_config_from(&config_path)?;
    config.recent_projects.retain(|p| p != &path);
    config.recent_projects.insert(0, path);
    config.recent_projects.truncate(MAX_RECENT);
    write_config_to(&config_path, &config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("stack-app-config-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn corrupt_config_is_quarantined_and_recovers_to_defaults() {
        let dir = tmpdir("bad");
        let path = dir.join("config.json");
        std::fs::write(&path, "{oops, not json").unwrap();
        let config = load_config_from(&path).expect("corrupt config recovers");
        assert!(config.recent_projects.is_empty());
        assert!(config.stack_path.is_none());
        assert!(config.worker.is_none() && config.project.is_none());
        let notice = config.notice.expect("a notice for the UI");
        assert!(notice.contains("config.json.bad"), "notice: {notice}");
        // The corrupt bytes are kept aside, and no half-written config remains.
        assert!(!path.exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("config.json.bad")).unwrap(),
            "{oops, not json"
        );
        // A second corrupt file overwrites the older .bad instead of failing.
        std::fs::write(&path, "still bad").unwrap();
        load_config_from(&path).expect("second corrupt config recovers");
        assert_eq!(
            std::fs::read_to_string(dir.join("config.json.bad")).unwrap(),
            "still bad"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_config_means_defaults_and_writes_leave_no_temp_file() {
        let dir = tmpdir("roundtrip");
        let path = dir.join("config.json");
        let config = load_config_from(&path).expect("missing config loads");
        assert!(config.notice.is_none());
        assert!(config.recent_projects.is_empty());
        let mut saved = AppConfig {
            recent_projects: vec!["/tmp/p".to_string()],
            ..AppConfig::default()
        };
        // A notice in memory (from an earlier recovery) is never persisted.
        saved.notice = Some("stale".to_string());
        write_config_to(&path, &saved).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .filter(|n| n.to_string_lossy().starts_with("config.json.tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("notice"), "stored config stays clean: {raw}");
        let back = load_config_from(&path).unwrap();
        assert_eq!(back.recent_projects, vec!["/tmp/p".to_string()]);
        assert!(back.notice.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
