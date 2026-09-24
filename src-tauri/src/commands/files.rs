//! Read a text file inside a project folder (for briefs the workers should not have to rediscover).

use std::path::{Component, Path, PathBuf};

fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel);
    if rel.is_absolute() || rel.components().any(|c| matches!(c, Component::ParentDir)) {
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
        assert_eq!(
            safe_join(Path::new("/r"), "docs/a.md").unwrap(),
            Path::new("/r/docs/a.md")
        );
    }
}
