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
