//! escacs stack desktop shell.
//!
//! Security model: the app touches only the user-selected project dir, the
//! stack dir, and its own config dir. All paths are canonicalized and
//! confined (see `paths`). It never runs project code (subprocesses are
//! `node <stack>/tools/stack/cli.mjs` plus, during first-run provisioning,
//! fixed `gh`/`git` clone commands with a fixed repo and destination — see
//! `provision`), never commits or pushes, and handles no credentials.

mod config;
pub mod paths;
pub mod project;
pub mod provision;
pub mod scan;
pub mod stack;

use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

/// Event the startup check emits when a newer release exists. The frontend
/// listens for it (see `appUpdate` in src/store.ts) to badge the footer.
/// Keep the name in sync on both sides.
pub const UPDATE_AVAILABLE_EVENT: &str = "stack://update-available";

/// Payload for [`UPDATE_AVAILABLE_EVENT`], kept pure for tests.
pub fn update_available_payload(version: &str) -> serde_json::Value {
    serde_json::json!({ "version": version })
}

/// Native folder picker. Runs on a blocking thread so the webview stays
/// responsive while the dialog is open. Returns `None` on cancel.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| p.to_string())
    })
    .await
    .map_err(|e| format!("folder picker failed: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Non-blocking update check at startup. Failures go to stderr
            // (a 404 here once meant the releases page was unreachable, and
            // swallowing it hid that for a whole release); a newer release
            // emits UPDATE_AVAILABLE_EVENT for the footer badge. The settings
            // view offers a manual check plus download/install/relaunch.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let updater = match handle.updater() {
                    Ok(u) => u,
                    Err(e) => {
                        eprintln!("stack: startup update check unavailable: {e}");
                        return;
                    }
                };
                match updater.check().await {
                    Ok(Some(update)) => {
                        eprintln!("stack: update available: {}", update.version);
                        let _ = handle.emit(
                            UPDATE_AVAILABLE_EVENT,
                            update_available_payload(&update.version),
                        );
                    }
                    Ok(None) => {}
                    Err(e) => eprintln!("stack: startup update check failed: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            config::get_config,
            config::save_config,
            config::add_recent_project,
            project::validate_project,
            scan::scan_projects,
            scan::default_scan_roots,
            stack::node_status,
            stack::stack_location,
            stack::validate_stack,
            stack::stack_run,
            provision::provision_stack,
            provision::stack_cli_status,
            provision::link_stack_cli,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the stack app");
}

#[cfg(test)]
mod tests {
    /// The frameless titlebar needs these grants or its drag and buttons are
    /// silently denied (`core:window:default` has none of them).
    #[test]
    fn capabilities_grant_the_window_chrome_permissions() {
        let caps = include_str!("../capabilities/default.json");
        for perm in [
            "core:window:allow-start-dragging",
            "core:window:allow-minimize",
            "core:window:allow-toggle-maximize",
            "core:window:allow-close",
        ] {
            assert!(caps.contains(&format!("\"{perm}\"")), "missing {perm}");
        }
    }

    use super::*;

    #[test]
    fn update_available_event_shape() {
        assert_eq!(UPDATE_AVAILABLE_EVENT, "stack://update-available");
        assert_eq!(
            update_available_payload("0.1.2"),
            serde_json::json!({ "version": "0.1.2" })
        );
    }
}
