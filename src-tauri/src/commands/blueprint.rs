//! Blueprint host helpers: build folders under `~/CubeCode/blueprints/<name>/<build>`, importing files
//! dropped from the desktop, and cheap folder stats.

use std::path::{Path, PathBuf};

fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for c in s.trim().chars() {
        let lower = c.to_lowercase().next().unwrap_or(c);
        let mapped = match lower {
            'ç' => 'c',
            'ğ' => 'g',
            'ı' => 'i',
            'ö' => 'o',
            'ş' => 's',
            'ü' => 'u',
            'î' => 'i',
            'â' => 'a',
            'û' => 'u',
            other => other,
        };
        if mapped.is_ascii_alphanumeric() {
            out.push(mapped);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_end_matches('-').to_string();
    if trimmed.is_empty() {
        "build".into()
    } else {
        trimmed.chars().take(40).collect()
    }
}

fn blueprints_root(base: Option<&str>) -> Result<PathBuf, String> {
    Ok(crate::app_paths::workspace_root(base)?.join("blueprints"))
}

/// Create (or reuse) the folder for a build node and return its absolute path.
#[tauri::command]
pub fn blueprint_build_dir(blueprint: String, build: String, base: Option<String>) -> Result<String, String> {
    let dir = blueprints_root(base.as_deref())?.join(slug(&blueprint)).join(slug(&build));
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStats {
    pub file_count: usize,
    pub images: Vec<String>,
    pub newest_ms: u64,
}

const SKIP: &[&str] = &[
    "node_modules",
    ".git",
    ".silent",
    "dist",
    "target",
    ".cache",
];

/// `outputs_only`: inside `.silent/tmp` (screenshots the workers took) images are collected but nothing is
/// counted as a project file; `.silent/refs` and the rest of `.silent` are never outputs.
fn walk(dir: &Path, root: &Path, stats: &mut BuildStats, budget: &mut usize, outputs_only: bool) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let in_silent = dir.file_name().is_some_and(|n| n == ".silent");
    for entry in entries.flatten() {
        if *budget == 0 {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if name == ".silent" {
                // Only `.silent/tmp` (worker screenshots) is an output; refs/inbox are skipped below.
                walk(&path, root, stats, budget, true);
                continue;
            }
            if SKIP.contains(&name.as_str()) {
                continue;
            }
            if in_silent {
                if name == "tmp" {
                    walk(&path, root, stats, budget, true);
                }
                continue;
            }
            if name.starts_with('.') {
                continue;
            }
            walk(&path, root, stats, budget, outputs_only);
        } else if meta.is_file() {
            *budget -= 1;
            if !outputs_only {
                stats.file_count += 1;
            }
            let lower = name.to_ascii_lowercase();
            if lower.ends_with(".png")
                || lower.ends_with(".jpg")
                || lower.ends_with(".jpeg")
                || lower.ends_with(".webp")
                || lower.ends_with(".gif")
            {
                if let Ok(rel) = path.strip_prefix(root) {
                    stats.images.push(silent_runtime::paths::to_slash(rel));
                }
            }
            if let Ok(m) = meta.modified() {
                if let Ok(d) = m.duration_since(std::time::UNIX_EPOCH) {
                    stats.newest_ms = stats.newest_ms.max(d.as_millis() as u64);
                }
            }
        }
    }
}

/// File count, image list and newest mtime of a build folder (bounded walk).
#[tauri::command]
pub fn blueprint_build_stats(folder: String) -> Result<BuildStats, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Ok(BuildStats {
            file_count: 0,
            images: Vec::new(),
            newest_ms: 0,
        });
    }
    let mut stats = BuildStats {
        file_count: 0,
        images: Vec::new(),
        newest_ms: 0,
    };
    let mut budget = 20_000usize;
    walk(&root, &root, &mut stats, &mut budget, false);
    stats.images.sort();
    stats.images.truncate(200);
    Ok(stats)
}

fn unique_target(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    for i in 2..1000 {
        let c = dir.join(format!("{stem}-{i}{ext}"));
        if !c.exists() {
            return c;
        }
    }
    dir.join(format!("{stem}-{}{ext}", std::process::id()))
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<usize> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        let mut n = 0;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let name = entry.file_name();
            if SKIP.contains(&name.to_string_lossy().as_ref()) {
                continue;
            }
            n += copy_recursive(&entry.path(), &dst.join(name))?;
        }
        Ok(n)
    } else {
        std::fs::copy(src, dst)?;
        Ok(1)
    }
}

/// Copy files/folders dropped from the desktop into a build folder (`<folder>/<sub>`); returns the count.
#[tauri::command]
pub fn blueprint_build_import(
    folder: String,
    paths: Vec<String>,
    sub: Option<String>,
    skip_existing: Option<bool>,
) -> Result<usize, String> {
    let mut dir = PathBuf::from(&folder);
    if let Some(s) = sub.filter(|s| !s.is_empty()) {
        dir = dir.join(slug(&s));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut total = 0;
    for p in paths {
        let src = PathBuf::from(&p);
        let Some(name) = src.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            continue;
        };
        if !src.exists() {
            continue;
        }
        if skip_existing.unwrap_or(false) {
            // Mirroring: a file with the same name and size is already there.
            if let (Ok(have), Ok(want)) = (dir.join(&name).metadata(), src.metadata()) {
                if have.is_file() && have.len() == want.len() {
                    continue;
                }
            }
        }
        let dst = unique_target(&dir, &name);
        total += copy_recursive(&src, &dst).map_err(|e| format!("{p}: {e}"))?;
    }
    Ok(total)
}

/// Copy the contents of one build folder into another (Send button). Returns files copied.
#[tauri::command]
pub fn blueprint_build_send(
    from: String,
    to: String,
    sub: Option<String>,
) -> Result<usize, String> {
    let src = PathBuf::from(&from);
    if !src.is_dir() {
        return Err(format!("{from} is not a directory"));
    }
    let mut dst = PathBuf::from(&to);
    if let Some(s) = sub.filter(|s| !s.is_empty()) {
        dst = dst.join(slug(&s));
    }
    copy_recursive(&src, &dst).map_err(|e| e.to_string())
}

/// Drop a helper script into `<folder>/.silent/tools/<name>` (the Uydurma placeholder tool for workers).
#[tauri::command]
pub fn blueprint_write_tool(folder: String, name: String, content: String) -> Result<String, String> {
    if name.contains('/') || name.contains("..") || name.is_empty() {
        return Err("invalid tool name".into());
    }
    let dir = PathBuf::from(&folder).join(".silent").join("tools");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(&name);
    std::fs::write(&path, content).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slug_handles_turkish_and_spaces() {
        assert_eq!(slug("Loki 2 — Mimarî"), "loki-2-mimari");
        assert_eq!(slug("   "), "build");
    }
    #[test]
    fn stats_collect_worker_screenshots_and_import_skips_existing() {
        let base = std::env::temp_dir().join(format!("silent-bp-shots-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let repo = base.join("repo");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::create_dir_all(repo.join(".silent/tmp")).unwrap();
        std::fs::create_dir_all(repo.join(".silent/refs/lib")).unwrap();
        std::fs::write(repo.join("src/main.ts"), "x").unwrap();
        std::fs::write(repo.join(".silent/tmp/frame1.png"), "png").unwrap();
        std::fs::write(repo.join(".silent/refs/lib/logo.png"), "png").unwrap();
        let stats = blueprint_build_stats(repo.to_string_lossy().into_owned()).unwrap();
        assert_eq!(stats.file_count, 1, "screenshots are not project files");
        assert_eq!(stats.images, vec![".silent/tmp/frame1.png".to_string()], "refs are never outputs");
        let photos = base.join("photos");
        let src = repo.join(".silent/tmp/frame1.png").to_string_lossy().into_owned();
        let f = photos.to_string_lossy().into_owned();
        assert_eq!(blueprint_build_import(f.clone(), vec![src.clone()], None, Some(true)).unwrap(), 1);
        assert_eq!(blueprint_build_import(f.clone(), vec![src.clone()], None, Some(true)).unwrap(), 0, "same name+size is skipped");
        assert_eq!(blueprint_build_import(f.clone(), vec![src], None, None).unwrap(), 1, "without the flag a -2 copy is made");
        let _ = std::fs::remove_dir_all(&base);
    }
    #[test]
    fn import_and_stats_and_send() {
        let base = std::env::temp_dir().join(format!("silent-bp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("src");
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("a.png"), "x").unwrap();
        std::fs::write(src.join("sub/b.txt"), "y").unwrap();
        let build = base.join("build");
        std::fs::create_dir_all(&build).unwrap();
        let n = blueprint_build_import(
            build.to_string_lossy().into_owned(),
            vec![
                src.join("a.png").to_string_lossy().into_owned(),
                src.join("sub").to_string_lossy().into_owned(),
            ],
            None,
            None,
        )
        .unwrap();
        assert_eq!(n, 2);
        let n2 = blueprint_build_import(
            build.to_string_lossy().into_owned(),
            vec![src.join("a.png").to_string_lossy().into_owned()],
            None,
            None,
        )
        .unwrap();
        assert_eq!(n2, 1);
        assert!(
            build.join("a-2.png").exists(),
            "duplicate names get a suffix"
        );
        let stats = blueprint_build_stats(build.to_string_lossy().into_owned()).unwrap();
        assert_eq!(stats.file_count, 3);
        assert_eq!(stats.images.len(), 2);
        let other = base.join("other");
        let sent = blueprint_build_send(
            build.to_string_lossy().into_owned(),
            other.to_string_lossy().into_owned(),
            Some("inbox".into()),
        )
        .unwrap();
        assert_eq!(sent, 3);
        assert!(other.join("inbox/a.png").exists());
        let _ = std::fs::remove_dir_all(base);
    }
}
