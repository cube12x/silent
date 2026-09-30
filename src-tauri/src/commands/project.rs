//! Project folder helpers: create a fresh working directory so CLIs never run without a cwd.

use std::path::PathBuf;


fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let s = s.trim_matches('-').to_string();
    let mut out = String::new();
    for part in s.split('-').filter(|p| !p.is_empty()) {
        if !out.is_empty() {
            out.push('-');
        }
        out.push_str(part);
    }
    if out.is_empty() {
        "project".into()
    } else {
        out
    }
}

/// `<workspace>/<slug>` (created if missing; workspace = Settings folder or `~/CubeCode`). Never overwrites.
#[tauri::command]
pub fn create_project_dir(name: String, base: Option<String>) -> Result<String, String> {
    let base: PathBuf = crate::app_paths::workspace_root(base.as_deref())?;
    let dir = base.join(slug(&name));
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::slug;
    #[test]
    fn slugs() {
        assert_eq!(slug("Oyun Hareket Prototipi!"), "oyun-hareket-prototipi");
        assert_eq!(slug("   "), "project");
    }
}

/// Show a folder (or a file's folder) in the OS file browser: Finder, Explorer or the desktop's default handler.
/// Four quick clicks on a Build box call this so the user can watch what an AI is writing while it runs.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err(format!("{} does not exist yet", p.display()));
    }
    let target = if p.is_dir() { p.clone() } else { p.parent().map(PathBuf::from).unwrap_or(p.clone()) };
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(&target);
        c
    } else if cfg!(windows) {
        let mut c = std::process::Command::new("explorer");
        c.arg(&target);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&target);
        c
    };
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not open {}: {e}", target.display()))
}
