//! Anlık Görüntü (Faz 4): git snapshots of a build folder that never touch the working tree or the branch.
//! A snapshot is a commit object stored under `refs/silent/snapshots/<stamp>`; restoring checks that tree
//! out into the working tree (index reset to HEAD afterwards, so the diff shows what the restore changed).

use std::path::Path;
use tokio::process::Command;

async fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd).stdin(std::process::Stdio::null()).kill_on_drop(true);
    silent_runtime::spawn::configure_child(&mut cmd);
    let out = cmd.output().await.map_err(|e| format!("git {}: {e}", args.first().copied().unwrap_or("")))?;
    if !out.status.success() {
        return Err(format!("git {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Make sure `cwd` is a git repository (a fresh build folder may not be one yet).
async fn ensure_repo(cwd: &Path) -> Result<(), String> {
    if cwd.join(".git").exists() {
        return Ok(());
    }
    git(cwd, &["init", "-q"]).await?;
    Ok(())
}

pub async fn snapshot(cwd: &Path) -> Result<String, String> {
    if !cwd.is_dir() {
        return Err(format!("{} is not a folder", cwd.display()));
    }
    ensure_repo(cwd).await?;
    // Stage everything into a temporary index so the user's real index is untouched.
    let tmp_index = cwd.join(".git").join(format!("silent-index-{}", std::process::id()));
    let result = snapshot_with_index(cwd, &tmp_index).await;
    let _ = std::fs::remove_file(&tmp_index);
    result
}

async fn git_with_index(cwd: &Path, index: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd).env("GIT_INDEX_FILE", index).stdin(std::process::Stdio::null()).kill_on_drop(true);
    silent_runtime::spawn::configure_child(&mut cmd);
    let out = cmd.output().await.map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(format!("git {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

async fn snapshot_with_index(cwd: &Path, index: &Path) -> Result<String, String> {
    git_with_index(cwd, index, &["add", "-A", "--", "."]).await?;
    let tree = git_with_index(cwd, index, &["write-tree"]).await?;
    let head = git(cwd, &["rev-parse", "--verify", "-q", "HEAD"]).await.ok().filter(|h| !h.is_empty());
    let stamp = chrono_like_stamp();
    let msg = format!("silent snapshot {stamp}");
    let commit = match head.as_deref() {
        Some(h) => git_with_index(cwd, index, &["commit-tree", &tree, "-p", h, "-m", &msg]).await?,
        None => git_with_index(cwd, index, &["commit-tree", &tree, "-m", &msg]).await?,
    };
    let reference = format!("refs/silent/snapshots/{stamp}");
    git(cwd, &["update-ref", &reference, &commit]).await?;
    Ok(reference)
}

pub async fn restore(cwd: &Path, reference: &str) -> Result<(), String> {
    if !reference.starts_with("refs/silent/snapshots/") {
        return Err("not a Silent snapshot ref".into());
    }
    git(cwd, &["rev-parse", "--verify", "-q", reference]).await.map_err(|_| format!("snapshot {reference} not found"))?;
    // A temporary index that mirrors the current working tree, so `read-tree -u` also removes files the snapshot
    // lacks (with the user's own index those files would be untracked and survive). The real index and HEAD stay as they are.
    let tmp_index = cwd.join(".git").join(format!("silent-restore-{}", std::process::id()));
    let result = async {
        git_with_index(cwd, &tmp_index, &["add", "-A", "--", "."]).await?;
        git_with_index(cwd, &tmp_index, &["read-tree", "--reset", "-u", reference]).await?;
        Ok::<(), String>(())
    }
    .await;
    let _ = std::fs::remove_file(&tmp_index);
    result?;
    Ok(())
}

/// `YYYYMMDD-HHMMSS-<ms>` without pulling in a date crate: seconds since the epoch are enough to sort and to read.
fn chrono_like_stamp() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}-{:03}", now.as_secs(), now.subsec_millis())
}

#[tauri::command]
pub async fn git_snapshot(cwd: String) -> Result<String, String> {
    snapshot(Path::new(&cwd)).await
}

#[tauri::command]
pub async fn git_restore(cwd: String, git_ref: String) -> Result<(), String> {
    restore(Path::new(&cwd), &git_ref).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn snapshot_then_restore_brings_back_the_files_without_touching_the_branch() {
        let dir = std::env::temp_dir().join(format!("silent-snap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "one").unwrap();
        // no repo yet: the first snapshot initialises one
        let r1 = snapshot(&dir).await.unwrap();
        assert!(r1.starts_with("refs/silent/snapshots/"));
        assert!(dir.join(".git").exists());
        // the user's index stays empty (nothing staged for them)
        assert_eq!(git(&dir, &["diff", "--cached", "--name-only"]).await.unwrap(), "");
        std::fs::write(dir.join("a.txt"), "two").unwrap();
        std::fs::write(dir.join("b.txt"), "new").unwrap();
        let r2 = snapshot(&dir).await.unwrap();
        assert_ne!(r1, r2);
        // restore the first snapshot: a.txt back to "one", b.txt (absent in r1) is removed
        restore(&dir, &r1).await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "one");
        assert!(!dir.join("b.txt").exists());
        // and forward again
        restore(&dir, &r2).await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "two");
        assert!(dir.join("b.txt").exists());
        assert!(restore(&dir, "refs/heads/main").await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
