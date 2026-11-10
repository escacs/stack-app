//! escacs stack desktop shell.
//!
//! Security model: the app touches only the user-selected project dir, the
//! stack dir, and its own config dir. All paths are canonicalized and
//! confined (see `paths`). It never runs project code (the only subprocess is
//! `node <stack>/tools/stack/cli.mjs`), never invokes git itself, never
//! commits or pushes, and handles no credentials.

mod config;
pub mod paths;
pub mod project;
pub mod scan;
pub mod stack;

use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

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
            // Silent, non-blocking update check at startup. The result is
            // deliberately ignored here; the settings view offers a manual
            // check plus download/install/relaunch with progress.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(updater) = handle.updater() {
                    let _ = updater.check().await;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running the stack app");
}
