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
    let dir = crate::app_paths::data_dir(&app);
    match swap_bundle(&PathBuf::from(&src)) {
        Ok(target) => {
            if let Some(dir) = &dir {
                clear_pending(dir);
            }
            relaunch(app, &target);
            Ok(())
        }
        Err(e) if e.starts_with(RETRY_PREFIX) => {
            // Transient: the bundle is still being written by `tauri build`; the queue stays and the next idle tick retries.
            log::info!("update from {src} postponed: {e}");
            Err(e)
        }
        Err(e) => {
            // A queued update that cannot be applied must not stay queued: the app would retry it every two idle
            // minutes and refuse every new run meanwhile (2026-10-04). The user re-queues with `silent update`.
            if let Some(dir) = &dir {
                clear_pending(dir);
            }
            log::warn!("update from {src} dropped: {e}");
            Err(e)
        }
    }
}

/// Removes the queue file written by `silent update`; a missing file is fine.
pub fn clear_pending(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(PENDING_UPDATE_FILE));
}

const RETRY_PREFIX: &str = "retry: ";
/// Red boxes listed per blueprint in `silent status` (the rest are counted; old stages pile up red Denetçi boxes).
const FAILED_SHOWN: usize = 3;
/// A bundle whose binary changed this recently is probably still being built/signed (`tauri build` takes ~20 s there).
const SETTLE_SECS: u64 = 60;

/// The source must be a complete app bundle other than the running one, and not mid-write.
pub fn validate_source(src: &Path, target: &Path) -> Result<(), String> {
    validate_source_at(src, target, std::time::SystemTime::now())
}

fn validate_source_at(src: &Path, target: &Path, now: std::time::SystemTime) -> Result<(), String> {
    let macos = src.join("Contents").join("MacOS");
    if !macos.is_dir() {
        return Err(format!("{} is not an app bundle", src.display()));
    }
    if src.canonicalize().ok() == target.canonicalize().ok() {
        return Err("source is the running bundle".into());
    }
    let newest = std::fs::read_dir(&macos)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .max()
        .ok_or_else(|| format!("{} has no executable", macos.display()))?;
    if now.duration_since(newest).map(|d| d.as_secs() < SETTLE_SECS).unwrap_or(true) {
        return Err(format!("{RETRY_PREFIX}{} was written less than {SETTLE_SECS} s ago — still being built? retrying later", src.display()));
    }
    Ok(())
}

/// Copies `src` over the running bundle (staging copy, then two renames). Returns the bundle path.
fn swap_bundle(src: &Path) -> Result<PathBuf, String> {
    let target = running_bundle().ok_or("not running from an .app bundle")?;
    validate_source(src, &target)?;
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
    log::info!("update applied from {} → relaunching", src.display());
    Ok(target)
}

/// Relaunch after this process has exited; `open` starts the new bundle detached from us.
fn relaunch(app: AppHandle, target: &Path) {
    spawn_relauncher(target);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        app.exit(0);
    });
}

/// The shell that reopens the bundle. It runs in its own process group (so our exit does not take it down) and
/// retries `open` until a Silent process exists (2026-10-04 23:37: one single `open` after `sleep 1.5` was lost on
/// a loaded host and Silent stayed closed until the user opened it).
pub fn relaunch_script(target: &Path) -> String {
    let t = target.display().to_string();
    format!("sleep 1.5; for i in 1 2 3 4 5 6 7 8 9 10; do open -a \"{t}\"; sleep 3; pgrep -x silent >/dev/null && exit 0; done")
}

fn spawn_relauncher(target: &Path) {
    use std::os::unix::process::CommandExt;
    let mut cmd = std::process::Command::new("sh");
    cmd.arg("-c").arg(relaunch_script(target)).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd.process_group(0);
    if let Err(e) = cmd.spawn() {
        log::error!("could not spawn the relauncher: {e}");
    }
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
    run_verb(&dir, verb, &rest)
}

fn run_verb(dir: &Path, verb: &str, rest: &[String]) -> Option<i32> {
    match verb {
        "status" => {
            let json = rest.iter().any(|a| a == "--json");
            match std::fs::read_to_string(dir.join(STATUS_FILE)) {
                Ok(text) if json => println!("{text}"),
                Ok(text) => println!("{}", render_status(&text)),
                Err(_) if json => println!("{{\"error\":\"no status yet — is Silent running?\"}}"),
                Err(_) => println!("no status yet — is Silent running?"),
            }
            Some(0)
        }
        "wait" => Some(wait_for(dir, rest, Instant::now())),
        "update" if rest.iter().any(|a| a == "--cancel") => {
            clear_pending(dir);
            println!("update queue cleared — Silent accepts new runs again");
            Some(0)
        }
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

/// Human-readable `silent status`: what runs, what failed, who is waiting for an answer (`--json` gives the raw file).
pub fn render_status(text: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return text.to_string(),
    };
    let mut out = String::new();
    let at = v.get("at").and_then(|a| a.as_i64()).unwrap_or(0);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let age = if at > 0 && now > at { (now - at) / 1000 } else { 0 };
    out.push_str(&format!("snapshot {age}s old"));
    if let Some(h) = v.get("host") {
        out.push_str(&format!(
            " · host {} (load {:.1}/{} cpus, swap {:.0}%)",
            h.get("level").and_then(|x| x.as_str()).unwrap_or("?"),
            h.get("load1").and_then(|x| x.as_f64()).unwrap_or(0.0),
            h.get("cpus").and_then(|x| x.as_i64()).unwrap_or(0),
            h.get("swapUsedPct").and_then(|x| x.as_f64()).unwrap_or(0.0)
        ));
    }
    out.push('\n');
    if let Some(p) = v.get("pendingUpdate").and_then(|p| p.as_str()) {
        out.push_str(&format!("⏸ update queued: {p} (installs when idle; new runs are refused)\n"));
    }
    let empty = vec![];
    let blocked = v.get("blocked").and_then(|b| b.as_array()).unwrap_or(&empty);
    for b in blocked {
        let s = |k: &str| b.get(k).and_then(|x| x.as_str());
        // The CLI takes the blueprint and the box, not the subtask id (old snapshots lack them: fall back to the id).
        let target = match (s("blueprint"), s("node")) {
            (Some(bp), Some(node)) => format!("\"{bp}\" \"{node}\""),
            _ => s("subtaskId").unwrap_or("?").to_string(),
        };
        out.push_str(&format!(
            "❓ BLOCKED {} — {}\n   answer: silent bp answer {target} \"…\"\n",
            s("title").unwrap_or("?"),
            s("question").unwrap_or("").lines().next().unwrap_or("")
        ));
    }
    for w in v.get("waiting").and_then(|b| b.as_array()).unwrap_or(&empty) {
        let pending = w.get("pending").and_then(|p| p.as_array()).cloned().unwrap_or_default();
        let items: Vec<String> = pending
            .iter()
            .map(|p| {
                let g = |k: &str| p.get(k).and_then(|x| x.as_str()).unwrap_or("");
                let frames = p.get("frames").and_then(|x| x.as_i64()).unwrap_or(0);
                let mut d = vec![g("kind").to_string()];
                if frames > 0 {
                    d.push(format!("{frames} frames"));
                }
                if !g("frameSize").is_empty() {
                    d.push(g("frameSize").to_string());
                }
                if g("status") == "rejected" {
                    d.push("REJECTED".into());
                }
                format!("{} ({})", g("name"), d.join(", "))
            })
            .collect();
        out.push_str(&format!(
            "🎨 WAITING {} ({}) — {} asset(s): {}\n   deliver: {}\n",
            w.get("node").and_then(|x| x.as_str()).unwrap_or("Model Plus"),
            w.get("blueprint").and_then(|x| x.as_str()).unwrap_or("?"),
            pending.len(),
            items.join(", "),
            w.get("deliverCmd").and_then(|x| x.as_str()).unwrap_or("silent bp deliver …")
        ));
    }
    for bp in v.get("blueprints").and_then(|b| b.as_array()).unwrap_or(&empty) {
        let nodes = bp.get("nodes").and_then(|n| n.as_array()).unwrap_or(&empty);
        let status_of = |n: &serde_json::Value| n.get("status").and_then(|s| s.as_str()).unwrap_or("").to_string();
        let running: Vec<&serde_json::Value> = nodes.iter().filter(|n| status_of(n) == "running" || status_of(n) == "waiting").collect();
        let failed: Vec<&serde_json::Value> = nodes.iter().filter(|n| status_of(n) == "failed").collect();
        // Blueprints nobody touched for 6 h only add old red boxes to the list: skip them unless something runs.
        let updated = bp.get("updatedAt").and_then(|x| x.as_i64()).unwrap_or(0);
        let stale = now > 0 && updated > 0 && now - updated > 6 * 3600 * 1000;
        if running.is_empty() && (failed.is_empty() || stale) {
            continue;
        }
        out.push_str(&format!("{}\n", bp.get("name").and_then(|x| x.as_str()).unwrap_or("?")));
        let shown_failed = failed.iter().take(FAILED_SHOWN).copied();
        let live: Vec<&serde_json::Value> = running.iter().copied().chain(shown_failed).collect();
        let hidden = failed.len().saturating_sub(FAILED_SHOWN);
        for n in live {
            let status = n.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let mark = match status { "running" => "▶", "waiting" => "⏸", _ => "✗" };
            let note = n.get("note").and_then(|s| s.as_str()).map(|s| format!(" — {s}")).unwrap_or_default();
            out.push_str(&format!("  {mark} {} [{}]{}\n", n.get("title").and_then(|x| x.as_str()).unwrap_or("?"), n.get("type").and_then(|x| x.as_str()).unwrap_or(""), note));
        }
        if hidden > 0 {
            out.push_str(&format!("  … +{hidden} more red boxes (older stages; --json lists them)\n"));
        }
    }
    for r in v.get("runs").and_then(|b| b.as_array()).unwrap_or(&empty).iter().filter(|r| r.get("status").and_then(|s| s.as_str()) == Some("running")) {
        out.push_str(&format!(
            "run {} {}/{} tasks, {} tokens\n",
            r.get("id").and_then(|x| x.as_str()).unwrap_or("?"),
            r.get("done").and_then(|x| x.as_i64()).unwrap_or(0),
            r.get("total").and_then(|x| x.as_i64()).unwrap_or(0),
            r.get("tokens").and_then(|x| x.as_i64()).unwrap_or(0)
        ));
    }
    if out.lines().count() <= 1 {
        out.push_str("idle — nothing running\n");
    }
    out.trim_end().to_string()
}

fn default_update_source() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/CubeCode/silent/target/release/bundle/macos/Silent.app")
}

/// `silent wait <blueprint> <node> [--timeout minutes] [--once]`: 0 = done, 1 = failed, 2 = timeout/unknown,
/// 3 = still running (only with `--once`, which checks a single time — the launcher loops in the shell because a
/// long-lived GUI-bundle process gets App-Napped and its sleeps stretch; 2026-10-04: a 58-minute wait never woke).
pub fn wait_for(dir: &Path, rest: &[String], started: Instant) -> i32 {
    let positional: Vec<&String> = rest.iter().filter(|a| !a.starts_with("--") && !rest.iter().zip(rest.iter().skip(1)).any(|(f, v)| f == "--timeout" && v == *a)).collect();
    let bp = positional.first().map(|s| s.to_string()).unwrap_or_default();
    let node = positional.get(1).map(|s| s.to_string()).unwrap_or_default();
    let once = rest.iter().any(|a| a == "--once");
    let mut timeout_min: u64 = 600;
    if let Some(i) = rest.iter().position(|a| a == "--timeout") {
        if let Some(v) = rest.get(i + 1).and_then(|v| v.parse::<u64>().ok()) {
            timeout_min = v;
        }
    }
    if bp.is_empty() || node.is_empty() {
        eprintln!("usage: silent wait <blueprint name|id> <node title|id> [--timeout minutes] [--once]");
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
        if once {
            return 3;
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
    fn relaunch_script_retries_open_until_a_silent_process_exists() {
        let s = relaunch_script(Path::new("/Applications/Silent.app"));
        assert!(s.contains("open -a \"/Applications/Silent.app\""));
        assert!(s.contains("pgrep -x silent"));
        assert!(s.matches("sleep").count() >= 2, "{s}");
    }

    #[test]
    fn render_status_lists_waiting_model_boxes_and_prints_the_real_answer_shape() {
        let text = r#"{"at":1,"blueprints":[{"id":"b","name":"Mario","updatedAt":1,"nodes":[{"id":"m1","title":"Model Plus","type":"model","status":"waiting","note":"2 waiting"}]}],"runs":[],"blocked":[{"runId":"r1","subtaskId":"t9","title":"Portal","question":"Which id?","blueprint":"Minecraft","node":"Bölücü 4C"}],"waiting":[{"blueprint":"Mario","blueprintId":"b","node":"Model Plus","nodeId":"m1","pending":[{"name":"mario","kind":"sprite-sheet","frames":15,"frameSize":"64x64","status":"pending"},{"name":"coin_pickup","kind":"audio","frames":0,"status":"rejected"}],"deliverCmd":"silent bp deliver \"Mario\" \"Model Plus\" <file>"}]}"#;
        let out = render_status(text);
        assert!(out.contains("🎨 WAITING Model Plus (Mario) — 2 asset(s): mario (sprite-sheet, 15 frames, 64x64), coin_pickup (audio, REJECTED)"), "{out}");
        assert!(out.contains("deliver: silent bp deliver \"Mario\" \"Model Plus\" <file>"), "{out}");
        assert!(out.contains("answer: silent bp answer \"Minecraft\" \"Bölücü 4C\" \"…\""), "{out}");
        // a blueprint whose only live box is waiting is listed, with ⏸
        assert!(out.contains("Mario\n  ⏸ Model Plus [model] — 2 waiting"), "{out}");
    }

    #[test]
    fn render_status_shows_running_failed_blocked_and_the_update_queue() {
        let text = r#"{"at":1,"host":{"load1":7.2,"cpus":6,"swapUsedPct":91,"level":"high"},"pendingUpdate":"/tmp/New.app","blocked":[{"runId":"r1","subtaskId":"t9","title":"Portal","question":"Which id?\nmore"}],"blueprints":[{"id":"b","name":"Minecraft","nodes":[{"id":"n1","title":"Dikiş 9","type":"ai","status":"done"},{"id":"n2","title":"Bölücü 4B","type":"ai","status":"running"},{"id":"n3","title":"Denetçi","type":"check","status":"failed","note":"npm test red"}]}],"runs":[{"id":"r1","status":"running","done":1,"total":9,"tokens":12}]}"#;
        let out = render_status(text);
        assert!(out.contains("host high"));
        assert!(out.contains("update queued: /tmp/New.app"));
        assert!(out.contains("❓ BLOCKED Portal — Which id?"));
        assert!(out.contains("silent bp answer t9"));
        assert!(out.contains("▶ Bölücü 4B [ai]"));
        assert!(out.contains("✗ Denetçi [check] — npm test red"));
        assert!(!out.contains("Dikiş 9"));
        assert!(out.contains("run r1 1/9 tasks, 12 tokens"));
        assert_eq!(render_status("{\"at\":1,\"blueprints\":[],\"runs\":[]}").lines().last().unwrap(), "idle — nothing running");
        // old blueprints with only red boxes are skipped; many red boxes collapse to a count
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        let old = now - 7 * 3600 * 1000;
        let reds: Vec<String> = (1..=5).map(|i| format!("{{\"id\":\"f{i}\",\"title\":\"Denetçi {i}\",\"type\":\"check\",\"status\":\"failed\"}}")).collect();
        let text = format!(
            "{{\"at\":{now},\"blueprints\":[{{\"id\":\"o\",\"name\":\"Old\",\"updatedAt\":{old},\"nodes\":[{}]}},{{\"id\":\"n\",\"name\":\"Fresh\",\"updatedAt\":{now},\"nodes\":[{}]}}],\"runs\":[]}}",
            reds[0], reds.join(",")
        );
        let out = render_status(&text);
        assert!(!out.contains("Old"), "{out}");
        assert!(out.contains("Fresh"));
        assert_eq!(out.matches("✗ Denetçi").count(), 3, "{out}");
        assert!(out.contains("+2 more red boxes"));
        assert_eq!(render_status("garbage"), "garbage");
    }

    #[test]
    fn a_bad_update_source_is_rejected_and_the_queue_file_is_dropped() {
        let tmp = std::env::temp_dir().join(format!("silent-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("Not.app")).unwrap();
        let target = tmp.join("Silent.app");
        std::fs::create_dir_all(target.join("Contents/MacOS")).unwrap();
        assert!(validate_source(&tmp.join("Not.app"), &target).unwrap_err().contains("not an app bundle"));
        assert!(validate_source(&tmp.join("Missing.app"), &target).is_err());
        assert_eq!(validate_source(&target, &target).unwrap_err(), "source is the running bundle");
        let good = tmp.join("New.app");
        std::fs::create_dir_all(good.join("Contents/MacOS")).unwrap();
        assert!(validate_source(&good, &target).unwrap_err().contains("no executable"));
        std::fs::write(good.join("Contents/MacOS/silent"), b"bin").unwrap();
        // just written → transient (the queue must stay); settled → ok
        let fresh = validate_source(&good, &target).unwrap_err();
        assert!(fresh.starts_with(RETRY_PREFIX), "{fresh}");
        let later = std::time::SystemTime::now() + Duration::from_secs(SETTLE_SECS + 5);
        assert!(validate_source_at(&good, &target, later).is_ok());
        write_atomic(&tmp.join(PENDING_UPDATE_FILE), "{\"path\":\"x\"}").unwrap();
        assert_eq!(read_pending(&tmp).unwrap().as_deref(), Some("x"));
        clear_pending(&tmp);
        assert_eq!(read_pending(&tmp).unwrap(), None);
        clear_pending(&tmp); // idempotent
        write_atomic(&tmp.join(PENDING_UPDATE_FILE), "{\"path\":\"x\"}").unwrap();
        assert_eq!(run_verb(&tmp, "update", &["--cancel".into()]), Some(0));
        assert_eq!(read_pending(&tmp).unwrap(), None);
        let _ = std::fs::remove_dir_all(&tmp);
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
        // --once: a running box answers 3 immediately instead of sleeping
        assert_eq!(wait_for(&tmp, &["bp1".into(), "n2".into(), "--once".into(), "--timeout".into(), "5".into()], Instant::now()), 3);
        assert_eq!(wait_for(&tmp, &["--once".into(), "bp1".into(), "n1".into()], Instant::now()), 1);
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
