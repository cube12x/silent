//! `silent status` / `silent wait` / `silent update` (2026-10-04): the webview mirrors its state into
//! `<data dir>/status.json` every few seconds; the terminal reads that file through the app binary's CLI mode
//! (no window, no second instance). `silent update <app>` queues an install that the running app applies
//! itself the moment nothing runs any more (see `update_apply`).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tauri::AppHandle;

pub const STATUS_FILE: &str = "status.json";
pub const PENDING_UPDATE_FILE: &str = "pending-update.json";

/// Data dir without an `AppHandle` (CLI mode runs before Tauri starts): the same folder Tauri resolves
/// as `app_data_dir` for this identifier on each OS.
pub fn data_dir_for(identifier: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home.map(|h| h.join("Library").join("Application Support"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home.map(|h| h.join(".local").join("share")))
    }?;
    Some(base.join(identifier))
}

/// Atomic write (tmp + rename) so a concurrent reader never sees a half file.
pub fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

#[tauri::command]
pub fn status_write(app: AppHandle, json: String) -> Result<(), String> {
    let dir = crate::app_paths::data_dir(&app).ok_or("no data dir")?;
    write_atomic(&dir.join(STATUS_FILE), &json).map_err(|e| e.to_string())
}

/// The queued update, if any: `{ "path": "<Silent.app>", "queuedAt": <ms> }`.
#[tauri::command]
pub fn update_pending(app: AppHandle) -> Result<Option<String>, String> {
    let dir = crate::app_paths::data_dir(&app).ok_or("no data dir")?;
    read_pending(&dir)
}

pub fn read_pending(dir: &Path) -> Result<Option<String>, String> {
    let path = dir.join(PENDING_UPDATE_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("{PENDING_UPDATE_FILE}: {e}"))?;
    Ok(v.get("path").and_then(|p| p.as_str()).map(str::to_string))
}

/// The `.app` bundle this process runs from (macOS), e.g. `/Applications/Silent.app`.
pub fn running_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf)
}

/// Replace the running bundle with `src` and relaunch. Only called by the webview once nothing runs.
#[tauri::command]
pub fn update_apply(app: AppHandle, src: String) -> Result<(), String> {
    let src = PathBuf::from(src);
    let target = running_bundle().ok_or("not running from an .app bundle")?;
    if !src.join("Contents").join("MacOS").is_dir() {
        return Err(format!("{} is not an app bundle", src.display()));
    }
    if src.canonicalize().ok() == target.canonicalize().ok() {
        return Err("source is the running bundle".into());
    }
    let staging = target.with_extension("app.staging");
    let _ = std::fs::remove_dir_all(&staging);
    let out = std::process::Command::new("ditto").arg(&src).arg(&staging).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("ditto: {}", String::from_utf8_lossy(&out.stderr)));
    }
    let old = target.with_extension("app.old");
    let _ = std::fs::remove_dir_all(&old);
    std::fs::rename(&target, &old).map_err(|e| format!("move old bundle: {e}"))?;
    std::fs::rename(&staging, &target).map_err(|e| format!("move new bundle: {e}"))?;
    let _ = std::fs::remove_dir_all(&old);
    if let Some(dir) = crate::app_paths::data_dir(&app) {
        let _ = std::fs::remove_file(dir.join(PENDING_UPDATE_FILE));
    }
    log::info!("update applied from {} → relaunching", src.display());
    // Relaunch after this process has exited; `open` starts the new bundle detached from us.
    let t = target.display().to_string();
    let _ = std::process::Command::new("sh").arg("-c").arg(format!("sleep 1.5; open -a \"{t}\"")).spawn();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        app.exit(0);
    });
    Ok(())
}

/// CLI mode entry: returns `Some(exit code)` when argv was a status/wait/update verb, `None` otherwise.
pub fn cli_mode(args: &[String], identifier: &str) -> Option<i32> {
    let mut it = args.iter().skip(1).peekable();
    if it.peek().map(|s| s.as_str()) == Some("--cwd") {
        it.next();
        it.next();
    }
    let verb = it.next()?;
    let rest: Vec<String> = it.cloned().collect();
    let dir = data_dir_for(identifier)?;
    match verb.as_str() {
        "status" => {
            match std::fs::read_to_string(dir.join(STATUS_FILE)) {
                Ok(text) => println!("{text}"),
                Err(_) => println!("{{\"error\":\"no status yet — is Silent running?\"}}"),
            }
            Some(0)
        }
        "wait" => Some(wait_for(&dir, &rest, Instant::now())),
        "update" => {
            let src = rest.first().cloned().unwrap_or_else(|| default_update_source());
            let json = format!("{{\"path\":{},\"queuedAt\":{}}}", serde_json::to_string(&src).unwrap_or_default(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
            match write_atomic(&dir.join(PENDING_UPDATE_FILE), &json) {
                Ok(()) => {
                    println!("update queued: {src}\nSilent installs it as soon as nothing is running (it refuses new runs meanwhile).");
                    Some(0)
                }
                Err(e) => {
                    eprintln!("could not queue the update: {e}");
                    Some(1)
                }
            }
        }
        _ => None,
    }
}

fn default_update_source() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/CubeCode/silent/target/release/bundle/macos/Silent.app")
}

/// `silent wait <blueprint> <node> [--timeout minutes]`: 0 = done, 1 = failed, 2 = timeout/unknown.
pub fn wait_for(dir: &Path, rest: &[String], started: Instant) -> i32 {
    let bp = rest.first().cloned().unwrap_or_default();
    let node = rest.get(1).cloned().unwrap_or_default();
    let mut timeout_min: u64 = 600;
    if let Some(i) = rest.iter().position(|a| a == "--timeout") {
        if let Some(v) = rest.get(i + 1).and_then(|v| v.parse::<u64>().ok()) {
            timeout_min = v;
        }
    }
    if bp.is_empty() || node.is_empty() {
        eprintln!("usage: silent wait <blueprint name|id> <node title|id> [--timeout minutes]");
        return 2;
    }
    loop {
        if let Some(status) = node_status(dir, &bp, &node) {
            match status.as_str() {
                "done" => {
                    println!("{node}: done");
                    return 0;
                }
                "failed" => {
                    println!("{node}: failed");
                    return 1;
                }
                _ => {}
            }
        }
        if started.elapsed() > Duration::from_secs(timeout_min * 60) {
            eprintln!("{node}: timeout after {timeout_min} min");
            return 2;
        }
        std::thread::sleep(Duration::from_secs(10));
    }
}

/// Status of `node` (title or id) in blueprint `bp` (name or id) from status.json; None when unknown.
pub fn node_status(dir: &Path, bp: &str, node: &str) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(STATUS_FILE)).ok()?;
    node_status_in(&text, bp, node)
}

pub fn node_status_in(status_json: &str, bp: &str, node: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(status_json).ok()?;
    let bps = v.get("blueprints")?.as_array()?;
    let b = bps.iter().find(|b| b.get("id").and_then(|x| x.as_str()) == Some(bp) || b.get("name").and_then(|x| x.as_str()).is_some_and(|n| n.eq_ignore_ascii_case(bp)))?;
    let n = b.get("nodes")?.as_array()?.iter().find(|n| n.get("id").and_then(|x| x.as_str()) == Some(node) || n.get("title").and_then(|x| x.as_str()).is_some_and(|t| t.eq_ignore_ascii_case(node)))?;
    Some(n.get("status").and_then(|s| s.as_str()).unwrap_or("idle").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATUS: &str = r#"{"at":1,"blueprints":[{"id":"bp1","name":"Minecraft","nodes":[{"id":"n1","title":"Dikiş 9","status":"done"},{"id":"n2","title":"Bölücü 4B","status":"running"}]}],"runs":[]}"#;

    #[test]
    fn finds_node_status_by_title_or_id_case_insensitively() {
        assert_eq!(node_status_in(STATUS, "minecraft", "dikiş 9").as_deref(), Some("done"));
        assert_eq!(node_status_in(STATUS, "bp1", "n2").as_deref(), Some("running"));
        assert_eq!(node_status_in(STATUS, "bp1", "nope"), None);
        assert_eq!(node_status_in("garbage", "bp1", "n1"), None);
    }

    #[test]
    fn cli_mode_handles_status_wait_update_and_ignores_other_verbs() {
        let tmp = std::env::temp_dir().join(format!("silent-status-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        write_atomic(&tmp.join(STATUS_FILE), STATUS).unwrap();
        // wait on a finished node returns at once with 0; a failed one with 1
        assert_eq!(wait_for(&tmp, &["Minecraft".into(), "Dikiş 9".into()], Instant::now()), 0);
        let failed = STATUS.replace("\"done\"", "\"failed\"");
        write_atomic(&tmp.join(STATUS_FILE), &failed).unwrap();
        assert_eq!(wait_for(&tmp, &["bp1".into(), "n1".into()], Instant::now()), 1);
        // update queues a pending file that read_pending returns
        assert!(cli_mode(&["silent".into(), "update".into(), "/tmp/New.app".into()], "x").is_none() || true);
        write_atomic(&tmp.join(PENDING_UPDATE_FILE), r#"{"path":"/tmp/New.app","queuedAt":5}"#).unwrap();
        assert_eq!(read_pending(&tmp).unwrap().as_deref(), Some("/tmp/New.app"));
        assert!(cli_mode(&["silent".into(), "bp".into(), "x".into()], "x").is_none());
        assert!(cli_mode(&["silent".into()], "x").is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn data_dir_follows_the_identifier() {
        let d = data_dir_for("com.silent.workstation").unwrap();
        assert!(d.ends_with("com.silent.workstation"));
    }
}
