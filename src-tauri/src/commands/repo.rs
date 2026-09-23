//! Lightweight repository inspection used by the New Session modal and Repo Agent cards.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub exists: bool,
    pub is_git_repo: bool,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_count: Option<u32>,
    pub languages: Vec<String>,
}

const MAX_FILES: u32 = 5000;
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    ".git",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
];

fn language_for(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "ts" | "tsx" => "TypeScript",
        "rs" => "Rust",
        "py" => "Python",
        "go" => "Go",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "rb" => "Ruby",
        "cs" => "C#",
        _ => return None,
    })
}

fn read_branch(root: &Path) -> Option<String> {
    let head = std::fs::read_to_string(root.join(".git/HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref: refs/heads/") {
        Some(branch) => Some(branch.to_owned()),
        None => Some(head.chars().take(8).collect()),
    }
}

fn walk(root: &Path) -> (u32, HashMap<&'static str, u32>) {
    let mut count = 0u32;
    let mut langs: HashMap<&'static str, u32> = HashMap::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                let name = entry.file_name();
                if SKIP_DIRS.iter().any(|skip| name == *skip) {
                    continue;
                }
                stack.push(path);
            } else if file_type.is_file() {
                count += 1;
                if let Some(lang) = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .and_then(language_for)
                {
                    *langs.entry(lang).or_insert(0) += 1;
                }
                if count >= MAX_FILES {
                    return (count, langs);
                }
            }
        }
    }
    (count, langs)
}

pub fn inspect(path: &str) -> RepoInfo {
    let root = PathBuf::from(path);
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_owned());
    if !root.is_dir() {
        return RepoInfo {
            path: path.into(),
            exists: false,
            is_git_repo: false,
            name,
            branch: None,
            file_count: None,
            languages: Vec::new(),
        };
    }
    let is_git_repo = root.join(".git").exists();
    let (count, langs) = walk(&root);
    let mut ranked: Vec<(&str, u32)> = langs.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    RepoInfo {
        path: path.into(),
        exists: true,
        is_git_repo,
        name,
        branch: if is_git_repo {
            read_branch(&root)
        } else {
            None
        },
        file_count: Some(count),
        languages: ranked
            .into_iter()
            .take(4)
            .map(|(l, _)| l.to_owned())
            .collect(),
    }
}

#[tauri::command]
pub async fn repo_inspect(path: String) -> Result<RepoInfo, String> {
    let path = path.trim().to_owned();
    if path.is_empty() {
        return Err("path is required".into());
    }
    tauri::async_runtime::spawn_blocking(move || inspect(&path))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspects_a_temp_repo() {
        let dir = std::env::temp_dir().join(format!("silent-repo-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(dir.join("a.ts"), "").unwrap();
        std::fs::write(dir.join("b.tsx"), "").unwrap();
        std::fs::write(dir.join("c.rs"), "").unwrap();
        std::fs::write(dir.join("node_modules/x/ignored.js"), "").unwrap();
        let info = inspect(dir.to_str().unwrap());
        assert!(info.exists && info.is_git_repo);
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(info.file_count, Some(3)); // .git and node_modules are skipped
        assert_eq!(info.languages, vec!["TypeScript", "Rust"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_path_is_reported() {
        let info = inspect("/definitely/not/here");
        assert!(!info.exists);
        assert_eq!(info.name, "here");
    }
}
