//! Shallow-clone reference repositories into `<repo>/.silent/refs/<name>` for expert kits.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefSpec {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefResult {
    pub name: String,
    pub path: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn safe_name(name: &str) -> Option<String> {
    let n: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();
    if n.is_empty() || n.starts_with('.') || n.contains("..") {
        None
    } else {
        Some(n)
    }
}

fn ensure_gitignore(repo: &Path) {
    let gi = repo.join(".gitignore");
    let current = std::fs::read_to_string(&gi).unwrap_or_default();
    if current
        .lines()
        .any(|l| l.trim() == ".silent/" || l.trim() == ".silent")
    {
        return;
    }
    let sep = if current.is_empty() || current.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    let _ = std::fs::write(&gi, format!("{current}{sep}.silent/\n"));
}

/// Clone (depth 1) each reference that is not present yet. Existing clones are kept as they are.
#[tauri::command]
pub async fn refs_sync(repo_path: String, refs: Vec<RefSpec>) -> Result<Vec<RefResult>, String> {
    let repo = PathBuf::from(&repo_path);
    if !repo.is_dir() {
        return Err(format!("{repo_path} is not a directory"));
    }
    let root = repo.join(".silent").join("refs");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    ensure_gitignore(&repo);
    let mut out = Vec::new();
    let t0 = std::time::Instant::now();
    for r in refs {
        let t = std::time::Instant::now();
        let Some(name) = safe_name(&r.name) else {
            out.push(RefResult {
                name: r.name,
                path: String::new(),
                ok: false,
                error: Some("invalid name".into()),
            });
            continue;
        };
        if !(r.url.starts_with("https://") || r.url.starts_with("git@")) {
            out.push(RefResult {
                name,
                path: String::new(),
                ok: false,
                error: Some("only https:// or git@ URLs".into()),
            });
            continue;
        }
        let dest = root.join(&name);
        let path = dest.to_string_lossy().into_owned();
        if dest.join(".git").exists() || dest.join("README.md").exists() {
            super::digest::ensure_ref_digest(&dest);
            out.push(RefResult {
                name,
                path,
                ok: true,
                error: None,
            });
            continue;
        }
        // A Finder/Start-menu launched app has a minimal PATH: find git where the user installed it.
        let git = super::binaries::resolve("git").unwrap_or_else(|| "git".into());
        let mut clone = Command::new(git);
        clone
            .args(["clone", "--depth", "1", "--single-branch", "--quiet", &r.url, &path])
            .env("PATH", super::binaries::augmented_path())
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null());
        silent_runtime::spawn::configure_child(&mut clone);
        let res = tokio::time::timeout(Duration::from_secs(240), clone.output()).await;
        let ok = matches!(&res, Ok(Ok(o)) if o.status.success());
        log::info!(
            "refs_sync {} ok={ok} in {:.1}s",
            r.url,
            t.elapsed().as_secs_f32()
        );
        match res {
            Ok(Ok(o)) if o.status.success() => {
                super::digest::ensure_ref_digest(&dest);
                out.push(RefResult {
                    name,
                    path,
                    ok: true,
                    error: None,
                })
            }
            Ok(Ok(o)) => out.push(RefResult {
                name,
                path,
                ok: false,
                error: Some(
                    String::from_utf8_lossy(&o.stderr)
                        .trim()
                        .chars()
                        .take(300)
                        .collect(),
                ),
            }),
            Ok(Err(e)) => out.push(RefResult {
                name,
                path,
                ok: false,
                error: Some(e.to_string()),
            }),
            Err(_) => out.push(RefResult {
                name,
                path,
                ok: false,
                error: Some("timeout".into()),
            }),
        }
    }
    log::info!("refs_sync total {:.1}s", t0.elapsed().as_secs_f32());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_are_sanitised() {
        assert_eq!(safe_name("kaplay").as_deref(), Some("kaplay"));
        assert_eq!(safe_name("a/b").as_deref(), Some("ab"));
        assert!(safe_name("../x").is_none());
        assert!(safe_name(".hidden").is_none());
        assert!(safe_name("/").is_none());
    }
    #[test]
    fn gitignore_gets_silent_dir_once() {
        let dir = std::env::temp_dir().join(format!("silent-gi-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules\n").unwrap();
        ensure_gitignore(&dir);
        ensure_gitignore(&dir);
        let s = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(s.matches(".silent/").count(), 1);
        assert!(s.starts_with("node_modules\n"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
