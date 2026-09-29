//! Silent desktop shell: thin Tauri command layer over `silent-runtime`.

mod app_paths;
mod bridge;
mod commands;
mod db;

use tauri::Manager;

/// Shrink the main window so it always fits the current monitor (small laptop screens at 2x scale
/// have a logical work area around 1200x750), then center it.
fn fit_main_window_to_monitor(app: &tauri::App) {
    use tauri::LogicalSize;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let logical_w = monitor.size().width as f64 / scale;
    let logical_h = monitor.size().height as f64 / scale;
    // Leave room for the menu bar / dock and a small margin.
    let max_w = (logical_w - 32.0).max(960.0);
    let max_h = (logical_h - 96.0).max(600.0);
    let Ok(current) = window.inner_size() else {
        return;
    };
    let cur_w = current.width as f64 / scale;
    let cur_h = current.height as f64 / scale;
    if cur_w > max_w || cur_h > max_h {
        let _ = window.set_size(LogicalSize::new(cur_w.min(max_w), cur_h.min(max_h)));
    }
    let _ = window.center();
}

/// Bring the main window back (dock click, `silent …` from a terminal, second launch).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second `Silent --bp …` process hands its argv to this one and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            commands::autostart::queue_from_argv(app, &argv, Some(std::path::Path::new(&cwd)));
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:silent.db", db::migrations())
                .build(),
        )
        .manage(commands::cli::RunRegistry::default())
        .setup(|app| {
            fit_main_window_to_monitor(app);
            // Cold start from the launcher: `Silent --cwd <dir> bp <name>` etc.
            let argv: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().ok();
            commands::autostart::queue_from_argv(app.handle(), &argv, cwd.as_deref());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::frontend_log,
            commands::providers::providers_detect,
            commands::models::provider_models,
            commands::repo::repo_inspect,
            commands::cli::cli_run_start,
            commands::cli::cli_run_cancel,
            commands::cli::provider_install,
            commands::cli::provider_login,
            commands::launcher::cli_launcher_status,
            commands::launcher::install_cli_launcher,
            commands::project::create_project_dir,
            commands::files::read_project_file,
            commands::files::repo_changed_files,
            commands::refs::refs_sync,
            commands::autostart::autostart_take,
            commands::blueprint::blueprint_build_dir,
            commands::blueprint::blueprint_build_stats,
            commands::blueprint::blueprint_build_import,
            commands::blueprint::blueprint_build_send,
            commands::blueprint::blueprint_write_tool,
            commands::prereqs::prereqs_check,
            commands::prereqs::setup_fix,
        ])
        .on_window_event(|window, event| {
            // macOS: closing the main window hides it (orchestrations keep running; the dock brings it back).
            // Elsewhere there is no dock/Reopen, so closing quits; the exit handler below cancels the runs.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (window, event);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Silent")
        .run(|app, event| {
            match event {
                // Dock click / `open -a Silent` with the window hidden or minimized: bring it back.
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => show_main_window(app),
                // Quit: stop every CLI child first (kill_on_drop does not run when the process exits).
                tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => {
                    let registry = app.state::<commands::cli::RunRegistry>();
                    let active = registry.cancel_all();
                    if active > 0 {
                        api.prevent_exit();
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let started = std::time::Instant::now();
                            while handle.state::<commands::cli::RunRegistry>().active() > 0 && started.elapsed() < std::time::Duration::from_secs(3) {
                                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                            }
                            handle.exit(0);
                        });
                    }
                }
                _ => {}
            }
        });
}
