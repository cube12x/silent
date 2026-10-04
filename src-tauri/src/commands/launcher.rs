//! `silent` terminal command: a tiny script that starts the desktop app with the arguments it was
//! given (`silent run …`, `silent bp …`, `silent reload`); the app parses them (see `autostart.rs`).
//! No python, no hardcoded data directories: the script only knows where the app is.

use std::path::{Path, PathBuf};

use silent_runtime::paths;

/// The app to start: the `.app` bundle on macOS, `$APPIMAGE` on Linux (inside a mounted AppImage
/// `current_exe` points into a temporary mount), else the executable itself.
fn app_path() -> PathBuf {
    if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|v| !v.is_empty()) {
        return PathBuf::from(appimage);
    }
    let exe = std::env::current_exe().unwrap_or_default();
    exe.ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .map(PathBuf::from)
        .unwrap_or(exe)
}

/// Where the launcher goes: macOS → Homebrew's bin when writable (already on PATH) else ~/.local/bin;
/// Linux → ~/.local/bin; Windows → %LOCALAPPDATA%\Silent\bin\silent.cmd.
fn launcher_path() -> PathBuf {
    if cfg!(windows) {
        let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).or_else(|| paths::home().map(|h| h.join("AppData").join("Local"))).unwrap_or_default();
        return base.join("Silent").join("bin").join("silent.cmd");
    }
    if cfg!(target_os = "macos") {
        let brew = PathBuf::from("/opt/homebrew/bin");
        if brew.is_dir() {
            if let Ok(probe) = std::fs::File::create(brew.join(".silent-write-test")) {
                drop(probe);
                let _ = std::fs::remove_file(brew.join(".silent-write-test"));
                return brew.join("silent");
            }
        }
    }
    paths::home().unwrap_or_default().join(".local/bin/silent")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LauncherKind {
    /// `open -n -a <app>` keeps the app detached from the terminal; `-n` forces a second process whose
    /// argv the single-instance plugin forwards to the running app.
    MacApp,
    /// Linux binary / AppImage / mac dev build: detach with nohup.
    UnixExe,
    /// `start "" <exe>` returns immediately.
    WindowsCmd,
}

/// The launcher script body for `target`.
pub fn launcher_script(kind: LauncherKind, target: &Path) -> String {
    let t = target.display();
    match kind {
        LauncherKind::MacApp => format!("#!/bin/sh\n# Silent — opens the desktop app with your arguments (silent run … | silent bp … | silent reload | silent cancel).\n# status / wait / update are answered by the app binary itself, without a window.\ncase \"$1\" in status|wait|update) exec \"{t}/Contents/MacOS/silent\" \"$@\";; esac\nexec open -n -a \"{t}\" --args --cwd \"$PWD\" \"$@\"\n"),
        LauncherKind::UnixExe => format!("#!/bin/sh\n# Silent — opens the desktop app with your arguments (silent run … | silent bp … | silent reload).\nnohup \"{t}\" --cwd \"$PWD\" \"$@\" >/dev/null 2>&1 &\n"),
        LauncherKind::WindowsCmd => format!("@echo off\r\nrem Silent - opens the desktop app with your arguments (silent run ... | silent bp ... | silent reload).\r\nstart \"\" \"{t}\" --cwd \"%CD%\" %*\r\n"),
    }
}

fn launcher_kind(app: &Path) -> LauncherKind {
    if cfg!(windows) {
        LauncherKind::WindowsCmd
    } else if app.extension().is_some_and(|e| e == "app") {
        LauncherKind::MacApp
    } else {
        LauncherKind::UnixExe
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStatus {
    pub installed: bool,
    pub path: String,
    /// Directory holding the launcher (what the user adds to PATH when `on_path` is false).
    pub dir: String,
    pub app_path: String,
    pub on_path: bool,
}

fn status() -> LauncherStatus {
    let path = launcher_path();
    let dir = path.parent().map(PathBuf::from).unwrap_or_default();
    let on_path = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).any(|d| d == dir)).unwrap_or(false);
    LauncherStatus {
        installed: path.is_file(),
        path: path.display().to_string(),
        dir: dir.display().to_string(),
        app_path: app_path().display().to_string(),
        on_path,
    }
}

#[tauri::command]
pub fn cli_launcher_status() -> LauncherStatus {
    status()
}

/// Rewrite an installed launcher whose body is stale (an older template): called at app start so a new
/// verb (`status`, `wait`, `update`…) works without a trip to Settings (2026-10-04).
pub fn refresh_launcher_if_stale() {
    let path = launcher_path();
    let Ok(current) = std::fs::read_to_string(&path) else { return };
    let app = app_path();
    let expected = launcher_script(launcher_kind(&app), &app);
    if current != expected {
        match std::fs::write(&path, &expected) {
            Ok(()) => log::info!("launcher refreshed at {}", path.display()),
            Err(e) => log::warn!("launcher refresh failed at {}: {e}", path.display()),
        }
    }
}

#[tauri::command]
pub fn install_cli_launcher() -> Result<LauncherStatus, String> {
    let path = launcher_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let app = app_path();
    let script = launcher_script(launcher_kind(&app), &app);
    std::fs::write(&path, script).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_forward_arguments_and_the_terminal_cwd_without_python() {
        let mac = launcher_script(LauncherKind::MacApp, Path::new("/Applications/Silent.app"));
        assert!(mac.starts_with("#!/bin/sh\n"));
        assert!(mac.contains("exec open -n -a \"/Applications/Silent.app\" --args --cwd \"$PWD\" \"$@\""));
        assert!(mac.contains("status|wait|update) exec \"/Applications/Silent.app/Contents/MacOS/silent\" \"$@\""));
        let unix = launcher_script(LauncherKind::UnixExe, Path::new("/home/a/Silent.AppImage"));
        assert!(unix.contains("nohup \"/home/a/Silent.AppImage\" --cwd \"$PWD\" \"$@\""));
        let win = launcher_script(LauncherKind::WindowsCmd, Path::new("C:\\Program Files\\Silent\\silent.exe"));
        assert!(win.starts_with("@echo off\r\n"));
        assert!(win.contains("start \"\" \"C:\\Program Files\\Silent\\silent.exe\" --cwd \"%CD%\" %*"));
        for s in [&mac, &unix, &win] {
            assert!(!s.contains("python"));
            assert!(!s.contains("Library/Application Support"));
        }
    }

    #[test]
    fn kind_follows_the_target() {
        if !cfg!(windows) {
            assert_eq!(launcher_kind(Path::new("/Applications/Silent.app")), LauncherKind::MacApp);
            assert_eq!(launcher_kind(Path::new("/usr/bin/silent")), LauncherKind::UnixExe);
        }
    }
}
