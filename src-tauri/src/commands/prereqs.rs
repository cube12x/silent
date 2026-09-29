//! First-run prerequisites: node/npm (CLI installs), git (reference repos), python3 (Uydurma tool),
//! Xcode Command Line Tools on macOS (git is a stub without them).

use std::process::Stdio;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::State;

use silent_runtime::RuntimeEvent;

use super::binaries;
use super::cli::RunRegistry;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrereqStatus {
    pub id: &'static str,
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub note: Option<String>,
}

/// A path under `Microsoft\WindowsApps` is the Store alias that only opens the Store: not a Python.
pub fn is_windows_store_alias(path: &str) -> bool {
    path.replace('/', "\\").to_ascii_lowercase().contains("\\microsoft\\windowsapps\\")
}

/// `/usr/bin/git` on a fresh Mac is the Command Line Tools stub that pops an installer dialog.
pub fn is_mac_git_stub(path: &str, clt_installed: bool) -> bool {
    path == "/usr/bin/git" && !clt_installed
}

async fn probe_version(path: &std::path::Path, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(path);
    cmd.args(args).env("PATH", binaries::augmented_path()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    silent_runtime::spawn::configure_child(&mut cmd);
    let out = tokio::time::timeout(Duration::from_secs(4), cmd.output()).await.ok()?.ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let line = text.lines().find(|l| l.chars().any(|c| c.is_ascii_digit()))?;
    Some(line.trim().to_string())
}

#[cfg(target_os = "macos")]
async fn clt_installed() -> bool {
    tokio::process::Command::new("xcode-select")
        .arg("-p")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
async fn clt_installed() -> bool {
    true
}

async fn check(id: &'static str, names: &[&str], args: &[&str]) -> PrereqStatus {
    for name in names {
        if let Some(path) = binaries::resolve(name) {
            let p = path.display().to_string();
            if is_windows_store_alias(&p) {
                continue;
            }
            let version = probe_version(&path, args).await;
            return PrereqStatus { id, found: version.is_some(), version, path: Some(p), note: None };
        }
    }
    PrereqStatus { id, found: false, version: None, path: None, note: None }
}

#[tauri::command]
pub async fn prereqs_check() -> Vec<PrereqStatus> {
    let clt = clt_installed().await;
    let mut out = vec![
        check("node", &["node"], &["--version"]).await,
        check("npm", &["npm"], &["--version"]).await,
        check("git", &["git"], &["--version"]).await,
        check("python3", if cfg!(windows) { &["python", "py", "python3"] } else { &["python3", "python"] }, &["--version"]).await,
    ];
    if let Some(git) = out.iter_mut().find(|p| p.id == "git") {
        if let Some(path) = git.path.as_deref() {
            if is_mac_git_stub(path, clt) {
                git.found = false;
                git.version = None;
                git.note = Some("run `xcode-select --install`".into());
            }
        }
    }
    if cfg!(target_os = "macos") {
        out.push(PrereqStatus { id: "xcode-clt", found: clt, version: None, path: None, note: if clt { None } else { Some("xcode-select --install".into()) } });
    }
    out
}

#[derive(serde::Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum SetupFix {
    /// npm global installs fail with EACCES when Node came from the nodejs.org pkg: switch to ~/.npm-global.
    NpmUserPrefix,
}

#[tauri::command]
pub async fn setup_fix(app: tauri::AppHandle, registry: State<'_, RunRegistry>, fix: SetupFix, on_event: Channel<RuntimeEvent>) -> Result<String, String> {
    let command = match fix {
        SetupFix::NpmUserPrefix => {
            if cfg!(windows) {
                return Err("npm -g needs no prefix fix on Windows".into());
            }
            "mkdir -p \"$HOME/.npm-global\" && npm config set prefix \"$HOME/.npm-global\" && echo \"npm prefix set to $HOME/.npm-global\""
        }
    };
    let mut config = super::shell::shell_config(command);
    config.timeout = Duration::from_secs(120);
    let run_id = format!("setup:{}", std::process::id());
    config.children_registry = crate::app_paths::children_registry(&app);
    config.run_id = run_id.clone();
    let parser: silent_runtime::LineParser = Box::new(|line: &str| if line.trim().is_empty() { Vec::new() } else { vec![RuntimeEvent::stdout(line)] });
    super::cli::spawn_registered(&registry, run_id, config, parser, on_event)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_windows_store_python_alias() {
        assert!(is_windows_store_alias("C:\\Users\\b\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe"));
        assert!(!is_windows_store_alias("C:\\Python312\\python.exe"));
    }

    #[test]
    fn classify_git_stub_without_clt() {
        assert!(is_mac_git_stub("/usr/bin/git", false));
        assert!(!is_mac_git_stub("/usr/bin/git", true));
        assert!(!is_mac_git_stub("/opt/homebrew/bin/git", false));
    }
}
