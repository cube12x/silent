//! Locate CLI binaries. Apps launched from Finder/the Start menu inherit a minimal PATH, so we also
//! probe the usual install locations of every supported CLI (see `silent_runtime::paths`).

use std::path::{Path, PathBuf};

use silent_runtime::paths;

pub use silent_runtime::paths::home;

fn candidate_dirs() -> Vec<PathBuf> {
    paths::user_bin_dirs()
}

/// First executable named `binary` (or `binary.exe`/`.cmd`/`.bat` on Windows) in PATH or the well-known fallbacks.
pub fn resolve(binary: &str) -> Option<PathBuf> {
    let names = paths::exe_candidates(binary);
    for dir in candidate_dirs() {
        for name in &names {
            let candidate = dir.join(name);
            if let Ok(meta) = std::fs::metadata(&candidate) {
                if meta.is_file() && is_executable(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Resolve the primary binary or any alternative name.
pub fn resolve_any(binary: &str, alternatives: &[&str]) -> Option<PathBuf> {
    resolve(binary).or_else(|| alternatives.iter().find_map(|alt| resolve(alt)))
}

/// The program to spawn plus leading arguments. On Windows an npm `.cmd` shim is unwrapped into
/// `node.exe <entry.js>` because `cmd.exe` cannot take the quotes and newlines of a prompt.
pub fn resolve_program(binary: &str, alternatives: &[&str]) -> Option<(PathBuf, Vec<String>)> {
    let program = resolve_any(binary, alternatives)?;
    if let Some(js) = paths::npm_shim_js(&program) {
        let node = program
            .parent()
            .map(|d| d.join("node.exe"))
            .filter(|n| n.is_file())
            .or_else(|| resolve("node"))
            .unwrap_or_else(|| PathBuf::from("node"));
        return Some((node, vec![js.to_string_lossy().into_owned()]));
    }
    Some((program, Vec::new()))
}

/// PATH value handed to spawned shells so `npm`, `node`, and freshly installed CLIs are found.
pub fn augmented_path() -> String {
    std::env::join_paths(candidate_dirs())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    matches!(
        path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).as_deref(),
        Some("exe" | "cmd" | "bat" | "com")
    )
}
