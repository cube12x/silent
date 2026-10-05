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

/// Show a folder (or a file's folder) in the OS file browser: Finder, Explorer or the desktop's default handler.
/// Four quick clicks on a Build box call this so the user can watch what an AI is writing while it runs.
/// Open an http(s) URL in the system browser. The webview must never navigate to it: a click on a worker's
/// `http://localhost:5173` link replaced Silent's UI with the dev server's page and there was no way back (2026-10-01).
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("only http(s) urls can be opened".into());
    }
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(u);
        c
    } else if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", u]);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(u);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not open {u}: {e}"))
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err(format!("{} does not exist yet", p.display()));
    }
    let target = if p.is_dir() { p.clone() } else { p.parent().map(PathBuf::from).unwrap_or(p.clone()) };
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(&target);
        c
    } else if cfg!(windows) {
        let mut c = std::process::Command::new("explorer");
        c.arg(&target);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&target);
        c
    };
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not open {}: {e}", target.display()))
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub tail: String,
    pub elapsed_ms: u64,
}

/// Running checks by token → process-group id, so a cancel (and the timeout) can kill the WHOLE tree
/// (2026-10-05: `kill_on_drop` only killed `/bin/sh`; vitest workers, Chromium and dev servers outlived a timed-out check).
fn checks() -> &'static std::sync::Mutex<std::collections::HashMap<String, u32>> {
    static CHECKS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, u32>>> = std::sync::OnceLock::new();
    CHECKS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}
fn cancelled_checks() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SET: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::OnceLock::new();
    SET.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// TERM the process group, give it `grace`, then KILL it (the group leader is the shell; `configure_child` made it a leader).
async fn kill_group(pgid: u32, grace: std::time::Duration) {
    #[cfg(unix)]
    {
        let signal = |sig: &'static str| async move {
            let _ = tokio::process::Command::new("kill").arg(format!("-{sig}")).arg("--").arg(format!("-{pgid}")).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().await;
        };
        signal("TERM").await;
        tokio::time::sleep(grace).await;
        signal("KILL").await;
    }
    #[cfg(windows)]
    {
        let _ = grace;
        let _ = tokio::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pgid.to_string()]).status().await;
    }
}

/// Is any process left in the group? (unix: `kill -0 -pgid`.)
#[cfg(all(unix, test))]
fn group_alive(pgid: u32) -> bool {
    std::process::Command::new("kill").arg("-0").arg("--").arg(format!("-{pgid}")).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

/// Denetçi: cancel the check started with `token` — kills its process group; the running command reports "cancelled".
#[tauri::command]
pub async fn project_check_cancel(token: String) -> Result<bool, String> {
    let pgid = checks().lock().map_err(|e| e.to_string())?.get(&token).copied();
    let Some(pgid) = pgid else {
        return Ok(false);
    };
    cancelled_checks().lock().map_err(|e| e.to_string())?.insert(token);
    kill_group(pgid, std::time::Duration::from_millis(1500)).await;
    Ok(true)
}

async fn read_capped<R: tokio::io::AsyncRead + Unpin>(mut r: R, cap: usize) -> Vec<u8> {
    use tokio::io::AsyncReadExt;
    let mut out: Vec<u8> = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                out.extend_from_slice(&buf[..n]);
                if out.len() > cap {
                    let cut = out.len() - cap;
                    out.drain(..cut);
                }
            }
        }
    }
    out
}

/// Denetçi: run one shell command in `cwd` without any model, bounded by `timeout_secs`; keeps the last
/// `max_lines` lines of combined output (what a fixer AI needs to see). `token` lets `project_check_cancel`
/// kill it. The wait is on the SHELL's exit, not on pipe EOF: a dev server left in the background by the
/// command no longer turns a green check into a false timeout (readers get a short grace, then are dropped).
#[tauri::command]
pub async fn project_run_check(cwd: String, command: String, timeout_secs: Option<u64>, max_lines: Option<usize>, token: Option<String>) -> Result<CheckResult, String> {
    let dir = PathBuf::from(&cwd);
    if !dir.is_dir() {
        return Err(format!("{cwd} is not a directory"));
    }
    if command.trim().is_empty() {
        return Err("command is required".into());
    }
    let config = super::shell::shell_config(&command);
    let mut cmd = tokio::process::Command::new(&config.program);
    cmd.args(&config.args).current_dir(&dir).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    silent_runtime::spawn::configure_child(&mut cmd);
    let started = std::time::Instant::now();
    let limit = std::time::Duration::from_secs(timeout_secs.unwrap_or(900).clamp(10, 7200));
    let keep = max_lines.unwrap_or(40).clamp(5, 400);
    let mut child = cmd.spawn().map_err(|e| format!("could not run `{command}`: {e}"))?;
    let pgid = child.id().unwrap_or(0);
    if let Some(t) = &token {
        if let Ok(mut m) = checks().lock() {
            m.insert(t.clone(), pgid);
        }
    }
    let out_task = tokio::spawn(read_capped(child.stdout.take().expect("piped stdout"), 1 << 20));
    let err_task = tokio::spawn(read_capped(child.stderr.take().expect("piped stderr"), 1 << 20));
    let waited = tokio::time::timeout(limit, child.wait()).await;
    let timed_out = waited.is_err();
    if timed_out {
        kill_group(pgid, std::time::Duration::from_secs(2)).await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
    }
    // Readers: whatever arrived. After a kill the group is dead, so EOF is certain — wait for it (a loaded host
    // can starve the reader tasks for seconds). After a normal exit a grandchild may hold the pipe open — short grace only.
    let killed = timed_out || token.as_ref().is_some_and(|t| cancelled_checks().lock().map(|c| c.contains(t)).unwrap_or(false));
    let reader_grace = std::time::Duration::from_secs(if killed { 15 } else { 3 });
    let grab = |task: tokio::task::JoinHandle<Vec<u8>>| async move {
        match tokio::time::timeout(reader_grace, task).await {
            Ok(Ok(bytes)) => bytes,
            _ => Vec::new(),
        }
    };
    let (stdout, stderr) = tokio::join!(grab(out_task), grab(err_task));
    let was_cancelled = token.as_ref().map(|t| cancelled_checks().lock().map(|mut s| s.remove(t)).unwrap_or(false)).unwrap_or(false);
    if let Some(t) = &token {
        if let Ok(mut m) = checks().lock() {
            m.remove(t);
        }
    }
    let text = format!("{}{}", String::from_utf8_lossy(&stdout), String::from_utf8_lossy(&stderr));
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = silent_runtime::redaction::redact_secrets(&lines[lines.len().saturating_sub(keep)..].join("\n"));
    let elapsed_ms = started.elapsed().as_millis() as u64;
    if was_cancelled {
        return Ok(CheckResult { ok: false, exit_code: None, tail: format!("cancelled\n{tail}"), elapsed_ms });
    }
    match waited {
        Ok(Ok(status)) => Ok(CheckResult { ok: status.success(), exit_code: status.code(), tail, elapsed_ms }),
        Ok(Err(e)) => Err(format!("could not run `{command}`: {e}")),
        Err(_) => Ok(CheckResult { ok: false, exit_code: None, tail: format!("timed out after {} s\n{tail}", limit.as_secs()), elapsed_ms }),
    }
}

#[cfg(test)]
mod check_tests {
    use super::*;

    #[tokio::test]
    async fn runs_a_command_and_keeps_the_tail() {
        let dir = std::env::temp_dir();
        let ok = project_run_check(dir.to_string_lossy().into_owned(), if cfg!(windows) { "echo 1& echo 2& echo 3& echo 4& echo 5& echo 6& echo 7".into() } else { "for i in 1 2 3 4 5 6 7; do echo $i; done; exit 0".into() }, Some(30), Some(5), None).await.unwrap();
        assert!(ok.ok);
        assert_eq!(ok.exit_code, Some(0));
        assert_eq!(ok.tail.trim().lines().map(|l| l.trim()).collect::<Vec<_>>(), ["3", "4", "5", "6", "7"]);
        let bad = project_run_check(dir.to_string_lossy().into_owned(), if cfg!(windows) { "exit 3".into() } else { "echo nope 1>&2; exit 3".into() }, Some(30), None, None).await.unwrap();
        assert!(!bad.ok);
        assert_eq!(bad.exit_code, Some(3));
        assert!(project_run_check("/definitely/not/here".into(), "true".into(), None, None, None).await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_timed_out_check_kills_its_whole_process_group() {
        let dir = std::env::temp_dir();
        let t = std::time::Instant::now();
        // The shell leaves a background child behind; both must be gone after the timeout.
        let res = project_run_check(dir.to_string_lossy().into_owned(), "echo begin; sleep 300 & sleep 300".into(), Some(10), None, Some("t-timeout".into())).await.unwrap();
        assert!(!res.ok && res.exit_code.is_none(), "{res:?}");
        assert!(res.tail.starts_with("timed out"), "{res:?}");
        assert!(res.tail.contains("begin"), "output before the timeout is kept: {res:?}");
        assert!(t.elapsed() < std::time::Duration::from_secs(40));
        assert!(checks().lock().unwrap().get("t-timeout").is_none());
        // no sleep from this shell may survive: look for our marker argument
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let ps = std::process::Command::new("sh").arg("-c").arg("ps -Ao pgid,args | grep -v grep | grep 'sleep 300' | wc -l").output().unwrap();
        let alive: i32 = String::from_utf8_lossy(&ps.stdout).trim().parse().unwrap_or(0);
        assert_eq!(alive, 0, "process group must be empty after the timeout");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_cancelled_check_reports_cancelled_and_its_group_dies() {
        let dir = std::env::temp_dir();
        let run = tokio::spawn(project_run_check(dir.to_string_lossy().into_owned(), "sleep 200 & sleep 200".into(), Some(60), None, Some("t-cancel".into())));
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        let pgid = checks().lock().unwrap().get("t-cancel").copied().expect("registered");
        assert!(group_alive(pgid));
        assert!(project_check_cancel("t-cancel".into()).await.unwrap());
        let res = tokio::time::timeout(std::time::Duration::from_secs(15), run).await.expect("returns promptly").unwrap().unwrap();
        assert!(!res.ok && res.tail.starts_with("cancelled"), "{res:?}");
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert!(!group_alive(pgid), "group must be dead after cancel");
        assert!(!project_check_cancel("unknown".into()).await.unwrap());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_green_command_whose_child_keeps_the_pipe_open_is_not_a_timeout() {
        let dir = std::env::temp_dir();
        let t = std::time::Instant::now();
        // The background child inherits stdout and lives on; the shell itself exits 0 at once.
        // (a short sleeper: it dies by itself — a `pkill -f "sleep 30"` here also matched the other test's `sleep 300`)
        let res = project_run_check(dir.to_string_lossy().into_owned(), "sleep 8 & echo ok; exit 0".into(), Some(20), None, Some("t-pipe".into())).await.unwrap();
        assert!(res.ok && res.exit_code == Some(0), "{res:?}");
        assert!(t.elapsed() < std::time::Duration::from_secs(7), "must not wait for the pipe: {:?}", t.elapsed());
    }
}
