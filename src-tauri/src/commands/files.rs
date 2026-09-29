//! Read a text file inside a project folder (for briefs the workers should not have to rediscover).

use std::path::{Component, Path, PathBuf};

fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel);
    // Absolute, rooted (`/etc`, `\etc`) or drive-prefixed (`C:`) paths and any `..` are rejected on every OS.
    if rel.is_absolute() || rel.has_root() || rel.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_))) {
        return None;
    }
    Some(root.join(rel))
}

/// Returns up to `max_bytes` of `root/rel` as text, or `None` when the file does not exist.
#[tauri::command]
pub fn read_project_file(
    root: String,
    rel: String,
    max_bytes: Option<usize>,
) -> Result<Option<String>, String> {
    let Some(path) = safe_join(Path::new(&root), &rel) else {
        return Err("invalid path".into());
    };
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let cap = max_bytes.unwrap_or(64 * 1024).min(512 * 1024);
    let slice = if bytes.len() > cap {
        &bytes[..cap]
    } else {
        &bytes[..]
    };
    Ok(Some(String::from_utf8_lossy(slice).into_owned()))
}

#[cfg(test)]
mod tests {
    use super::safe_join;
    use std::path::Path;
    #[test]
    fn rejects_traversal_and_absolute() {
        assert!(safe_join(Path::new("/r"), "../x").is_none());
        assert!(safe_join(Path::new("/r"), "/etc/passwd").is_none());
        assert!(safe_join(Path::new("/r"), "\\etc\\passwd").is_none());
        assert!(safe_join(Path::new("/r"), "C:\\x\\y").is_none());
        assert_eq!(
            safe_join(Path::new("/r"), "docs/a.md").unwrap(),
            Path::new("/r/docs/a.md")
        );
    }
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".silent",
    "dist",
    "build",
    "target",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    "coverage",
];

fn walk_changed(
    dir: &Path,
    root: &Path,
    since: std::time::SystemTime,
    out: &mut Vec<String>,
    budget: &mut usize,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *budget == 0 {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || (name.starts_with('.') && name != ".github") {
                continue;
            }
            walk_changed(&path, root, since, out, budget);
        } else if meta.is_file() {
            *budget -= 1;
            if meta.modified().map(|m| m >= since).unwrap_or(false) {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.push(silent_runtime::paths::to_slash(rel));
                }
            }
        }
    }
}

/// Files under `root` (excluding node_modules, .git, dist, …) modified at or after `since_ms` (Unix ms).
/// Fallback for CLIs that edit through shell commands and therefore emit no file-change events.
#[tauri::command]
pub fn repo_changed_files(root: String, since_ms: u64) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("{root} is not a directory"));
    }
    let since = std::time::UNIX_EPOCH + std::time::Duration::from_millis(since_ms);
    let mut out = Vec::new();
    let mut budget = 20_000usize;
    walk_changed(&root_path, &root_path, since, &mut out, &mut budget);
    out.sort();
    out.truncate(500);
    Ok(out)
}

#[cfg(test)]
mod changed_tests {
    use super::repo_changed_files;
    #[test]
    fn lists_only_recent_files_and_skips_node_modules() {
        let dir = std::env::temp_dir().join(format!("silent-changed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("src/old.ts"), "a").unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        let f = std::fs::File::options()
            .write(true)
            .open(dir.join("src/old.ts"))
            .unwrap();
        f.set_modified(old).unwrap();
        std::fs::write(dir.join("src/new.ts"), "b").unwrap();
        std::fs::write(dir.join("node_modules/x/index.js"), "c").unwrap();
        let since = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            - 60_000;
        let files = repo_changed_files(dir.to_string_lossy().into_owned(), since).unwrap();
        assert_eq!(files, vec!["src/new.ts".to_string()]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
