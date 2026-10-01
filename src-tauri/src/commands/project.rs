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

/// Denetçi: run one shell command in `cwd` without any model, bounded by `timeout_secs`; keeps the last
/// `max_lines` lines of combined output (what a fixer AI needs to see).
#[tauri::command]
pub async fn project_run_check(cwd: String, command: String, timeout_secs: Option<u64>, max_lines: Option<usize>) -> Result<CheckResult, String> {
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
    match tokio::time::timeout(limit, cmd.output()).await {
        Ok(Ok(out)) => {
            let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
            let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
            let tail = lines[lines.len().saturating_sub(keep)..].join("\n");
            Ok(CheckResult { ok: out.status.success(), exit_code: out.status.code(), tail: silent_runtime::redaction::redact_secrets(&tail), elapsed_ms: started.elapsed().as_millis() as u64 })
        }
        Ok(Err(e)) => Err(format!("could not run `{command}`: {e}")),
        Err(_) => Ok(CheckResult { ok: false, exit_code: None, tail: format!("timed out after {} s", limit.as_secs()), elapsed_ms: started.elapsed().as_millis() as u64 }),
    }
}

#[cfg(test)]
mod check_tests {
    use super::*;

    #[tokio::test]
    async fn runs_a_command_and_keeps_the_tail() {
        let dir = std::env::temp_dir();
        let ok = project_run_check(dir.to_string_lossy().into_owned(), if cfg!(windows) { "echo 1& echo 2& echo 3& echo 4& echo 5& echo 6& echo 7".into() } else { "for i in 1 2 3 4 5 6 7; do echo $i; done; exit 0".into() }, Some(30), Some(5)).await.unwrap();
        assert!(ok.ok);
        assert_eq!(ok.exit_code, Some(0));
        assert_eq!(ok.tail.trim().lines().map(|l| l.trim()).collect::<Vec<_>>(), ["3", "4", "5", "6", "7"]);
        let bad = project_run_check(dir.to_string_lossy().into_owned(), if cfg!(windows) { "exit 3".into() } else { "echo nope 1>&2; exit 3".into() }, Some(30), None).await.unwrap();
        assert!(!bad.ok);
        assert_eq!(bad.exit_code, Some(3));
        assert!(project_run_check("/definitely/not/here".into(), "true".into(), None, None).await.is_err());
    }
}
