//! Read files inside a project folder: text for briefs, listings and blobs for the Dosyalar tab.

use std::path::{Component, Path, PathBuf};

fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel);
    // Absolute, rooted (`/etc`, `\etc`) or drive-prefixed (`C:`) paths and any `..` are rejected on every OS.
    if rel.is_absolute() || rel.has_root() || rel.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_))) {
        return None;
    }
    Some(root.join(rel))
}

/// Writes `root/rel` (parents created). Model Plus mirrors its requests and manifest into the build with this.
#[tauri::command]
pub fn write_project_file(root: String, rel: String, content: String) -> Result<(), String> {
    let Some(path) = safe_join(Path::new(&root), &rel) else {
        return Err("invalid path".into());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
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
    use super::write_project_file;
    use super::safe_join;
    use std::path::Path;
    #[test]
    fn write_project_file_creates_parents_and_stays_inside_root() {
        let root = std::env::temp_dir().join(format!("silent-wpf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        write_project_file(root.to_string_lossy().to_string(), ".silent/model-plus/requests.json".into(), "{}".into()).unwrap();
        assert_eq!(std::fs::read_to_string(root.join(".silent/model-plus/requests.json")).unwrap(), "{}");
        write_project_file(root.to_string_lossy().to_string(), ".silent/model-plus/requests.json".into(), "[]".into()).unwrap();
        assert_eq!(std::fs::read_to_string(root.join(".silent/model-plus/requests.json")).unwrap(), "[]");
        assert!(write_project_file(root.to_string_lossy().to_string(), "../escape.txt".into(), "x".into()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        assert!(safe_join(Path::new("/r"), "../x").is_none());
        assert!(safe_join(Path::new("/r"), "/etc/passwd").is_none());
        // On unix these are ordinary relative file names; only Windows treats them as rooted/drive paths.
        #[cfg(windows)]
        {
            assert!(safe_join(Path::new("/r"), "\\etc\\passwd").is_none());
            assert!(safe_join(Path::new("/r"), "C:\\x\\y").is_none());
        }
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

/// One entry of a project listing (paths relative to the root, slash-separated).
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct ProjectFile {
    pub rel: String,
    pub size: u64,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u64,
}

fn walk_list(dir: &Path, root: &Path, out: &mut Vec<ProjectFile>, budget: &mut usize) {
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
            walk_list(&path, root, out, budget);
        } else if meta.is_file() {
            if name.starts_with('.') {
                continue;
            }
            *budget -= 1;
            if let Ok(rel) = path.strip_prefix(root) {
                let mtime_ms = meta
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(ProjectFile { rel: silent_runtime::paths::to_slash(rel), size: meta.len(), mtime_ms });
            }
        }
    }
}

/// Every file under `root` (node_modules, .git, .silent, dist, dotfiles … skipped), sorted by path, capped.
#[tauri::command]
pub fn list_project_files(root: String, max_files: Option<usize>) -> Result<Vec<ProjectFile>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("{root} is not a directory"));
    }
    let cap = max_files.unwrap_or(5000).clamp(1, 20_000);
    let mut out = Vec::new();
    let mut budget = cap;
    walk_list(&root_path, &root_path, &mut out, &mut budget);
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

/// Standard base64 (RFC 4648, with padding) — small enough to avoid a new dependency.
pub fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn mime_for(rel: &str) -> &'static str {
    match rel.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("json") => "application/json",
        Some("txt") | Some("md") => "text/plain",
        _ => "application/octet-stream",
    }
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct ProjectBlob {
    pub mime: String,
    pub base64: String,
}

/// `root/rel` as a base64 blob with a mime type (images, audio, JSON for previews), or `None` when missing.
#[tauri::command]
pub fn read_project_blob(root: String, rel: String, max_bytes: Option<usize>) -> Result<Option<ProjectBlob>, String> {
    let Some(path) = safe_join(Path::new(&root), &rel) else {
        return Err("invalid path".into());
    };
    if !path.is_file() {
        return Ok(None);
    }
    let cap = max_bytes.unwrap_or(8 * 1024 * 1024).min(32 * 1024 * 1024);
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() as usize > cap {
        return Err(format!("{rel} is larger than {cap} bytes"));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(ProjectBlob { mime: mime_for(&rel).to_string(), base64: base64_encode(&bytes) }))
}

#[cfg(test)]
mod listing_tests {
    use super::{base64_encode, list_project_files, read_project_blob};
    #[test]
    fn lists_files_skipping_dependencies_and_dotfiles() {
        let dir = std::env::temp_dir().join(format!("silent-list-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/y")).unwrap();
        std::fs::create_dir_all(dir.join(".silent")).unwrap();
        std::fs::write(dir.join("a.png"), [0x89, b'P', b'N', b'G']).unwrap();
        std::fs::write(dir.join("src/x.ts"), "x").unwrap();
        std::fs::write(dir.join("node_modules/y/index.js"), "y").unwrap();
        std::fs::write(dir.join(".silent/z"), "z").unwrap();
        std::fs::write(dir.join(".DS_Store"), "d").unwrap();
        let files = list_project_files(dir.to_string_lossy().into_owned(), None).unwrap();
        let rels: Vec<&str> = files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(rels, vec!["a.png", "src/x.ts"]);
        assert_eq!(files[0].size, 4);
        let blob = read_project_blob(dir.to_string_lossy().into_owned(), "a.png".into(), None).unwrap().unwrap();
        assert_eq!(blob.mime, "image/png");
        assert_eq!(blob.base64, "iVBORw==");
        assert!(read_project_blob(dir.to_string_lossy().into_owned(), "../etc".into(), None).is_err());
        assert!(read_project_blob(dir.to_string_lossy().into_owned(), "missing.png".into(), None).unwrap().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn base64_matches_rfc4648() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }
}
