//! Locate CLI binaries. Apps launched from Finder inherit a minimal PATH, so we also
//! probe the usual install locations of every supported CLI.

use std::path::PathBuf;

pub fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(fixed));
    }
    if let Some(home) = home() {
        for rel in [
            ".local/bin",
            ".npm-global/bin",
            ".cargo/bin",
            ".bun/bin",
            ".kimi-code/bin",
            ".grok/bin",
            ".cursor/bin",
            ".opencode/bin",
            ".volta/bin",
            ".nvm/current/bin",
        ] {
            dirs.push(home.join(rel));
        }
    }
    dirs
}

/// First executable named `binary` in PATH or the well-known fallbacks.
pub fn resolve(binary: &str) -> Option<PathBuf> {
    for dir in candidate_dirs() {
        let candidate = dir.join(binary);
        if let Ok(meta) = std::fs::metadata(&candidate) {
            if meta.is_file() && is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// Resolve the primary binary or any alternative name.
pub fn resolve_any(binary: &str, alternatives: &[&str]) -> Option<PathBuf> {
    resolve(binary).or_else(|| alternatives.iter().find_map(|alt| resolve(alt)))
}

/// PATH value handed to spawned shells so `npm`, `node`, and freshly installed CLIs are found.
pub fn augmented_path() -> String {
    let mut seen = Vec::new();
    for dir in candidate_dirs() {
        if !seen.contains(&dir) {
            seen.push(dir);
        }
    }
    std::env::join_paths(seen)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(_path: &std::path::Path) -> bool {
    true
}
