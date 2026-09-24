//! `silent` terminal command: a tiny shell script that opens the desktop app (`open -a`).
//! Silent itself stays a GUI app; the command only launches it.

use std::path::PathBuf;

use super::binaries;

/// The `.app` bundle containing the running executable (dev builds fall back to the executable).
fn app_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .map(PathBuf::from)
        .unwrap_or(exe)
}

/// Where the launcher goes: Homebrew's bin when writable (already on PATH), else ~/.local/bin.
fn launcher_path() -> PathBuf {
    let brew = PathBuf::from("/opt/homebrew/bin");
    if brew.is_dir()
        && std::fs::metadata(&brew)
            .map(|m| !m.permissions().readonly())
            .unwrap_or(false)
    {
        if let Ok(probe) = std::fs::File::create(brew.join(".silent-write-test")) {
            drop(probe);
            let _ = std::fs::remove_file(brew.join(".silent-write-test"));
            return brew.join("silent");
        }
    }
    binaries::home()
        .unwrap_or_default()
        .join(".local/bin/silent")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStatus {
    pub installed: bool,
    pub path: String,
    pub app_path: String,
    pub on_path: bool,
}

fn status() -> LauncherStatus {
    let path = launcher_path();
    let dir = path.parent().map(PathBuf::from).unwrap_or_default();
    let on_path = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d == dir))
        .unwrap_or(false);
    LauncherStatus {
        installed: path.is_file(),
        path: path.display().to_string(),
        app_path: app_path().display().to_string(),
        on_path,
    }
}

#[tauri::command]
pub fn cli_launcher_status() -> LauncherStatus {
    status()
}

#[tauri::command]
pub fn install_cli_launcher() -> Result<LauncherStatus, String> {
    let path = launcher_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let app = app_path();
    let script = if app.extension().is_some_and(|e| e == "app") {
        format!("#!/bin/sh\n# Silent — opens the desktop app. Installed by Silent > Settings.\nexec open -a \"{}\" --args \"$@\"\n", app.display())
    } else {
        format!(
            "#!/bin/sh\n# Silent (dev build) — launches the app executable.\nexec \"{}\" \"$@\"\n",
            app.display()
        )
    };
    std::fs::write(&path, script).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(status())
}
