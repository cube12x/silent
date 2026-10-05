//! `silent run <folder> "<request>"` / `silent bp …` / `silent reload` from the terminal: the launcher
//! passes its arguments to the app (`Silent --cwd <dir> bp <name>`); a running instance receives them
//! through the single-instance plugin, a cold start through `std::env::args`. Either way the request is
//! written to `<app data>/autostart.json`, which the webview polls with `autostart_take`.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::AppHandle;

/// Turn launcher argv into the JSON request the webview understands. `Ok(None)` when the arguments
/// are not a Silent command (plain launch, `-psn_…`, `tauri dev`).
pub fn parse_argv(args: &[String], cwd: Option<&Path>) -> Result<Option<Value>, String> {
    let mut it = args.iter().skip(1).peekable(); // skip the executable
    let mut cwd: Option<PathBuf> = cwd.map(Path::to_path_buf);
    if it.peek().map(|s| s.as_str()) == Some("--cwd") {
        it.next();
        cwd = it.next().map(PathBuf::from);
    }
    let Some(first) = it.next() else { return Ok(None) };
    match first.as_str() {
        "reload" => Ok(Some(json!({ "folder": "", "prompt": "", "reload": true }))),
        "cancel" => Ok(Some(json!({ "folder": "", "prompt": "", "cancel": true }))),
        "bp" => {
            let rest: Vec<String> = it.cloned().collect();
            parse_bp(&rest, cwd.as_deref()).map(Some)
        }
        "run" => {
            let rest: Vec<String> = it.cloned().collect();
            parse_run(&rest, cwd.as_deref()).map(Some)
        }
        _ => Ok(None),
    }
}

fn parse_bp(rest: &[String], cwd: Option<&Path>) -> Result<Value, String> {
    let mut i = 0;
    let mut only = false;
    if rest.get(i).map(String::as_str) == Some("only") {
        only = true;
        i += 1;
    }
    let (bpref, node, answer, auto): (String, Option<String>, Option<String>, Option<String>) = match rest.get(i).map(String::as_str) {
        Some("auto") => {
            let desc = rest[i + 1..].join(" ");
            if desc.trim().is_empty() {
                return Err("usage: silent bp auto <what you want built…>".into());
            }
            (String::new(), None, None, Some(desc))
        }
        Some("edit") => {
            let bpref = rest.get(i + 1).cloned().unwrap_or_default();
            let desc = rest[(i + 2).min(rest.len())..].join(" ");
            if bpref.is_empty() || desc.trim().is_empty() {
                return Err("usage: silent bp edit <blueprint name|id> <what to change…>".into());
            }
            return Ok(json!({ "folder": "", "prompt": "", "blueprint": { "ref": bpref, "node": null, "answer": null, "only": false, "auto": null, "edit": desc } }));
        }
        Some("fix") => {
            // silent bp fix <blueprint> "<problem…>" [--file rel]…  → the Dosyalar tab's Tamirci dialog, prefilled.
            let bpref = rest.get(i + 1).cloned().unwrap_or_default();
            let mut problem: Vec<String> = Vec::new();
            let mut files: Vec<String> = Vec::new();
            let mut run = false;
            let mut j = i + 2;
            while j < rest.len() {
                if rest[j] == "--run" {
                    // 2026-10-04: start the repair at once instead of prefilling the dialog (nobody at the screen).
                    run = true;
                    j += 1;
                } else if rest[j] == "--file" {
                    if let Some(f) = rest.get(j + 1) {
                        files.push(f.clone());
                    }
                    j += 2;
                } else {
                    problem.push(rest[j].clone());
                    j += 1;
                }
            }
            let problem = problem.join(" ");
            if bpref.is_empty() || problem.trim().is_empty() {
                return Err("usage: silent bp fix <blueprint name|id> <problem…> [--file path]…".into());
            }
            return Ok(json!({ "folder": "", "prompt": "", "blueprint": { "ref": bpref, "node": null, "answer": null, "only": false, "auto": null, "fix": { "problem": problem, "files": files, "run": run } } }));
        }
        Some("deliver") => {
            // silent bp deliver <blueprint> <box> <file>… [--for <request>]  → hand asset files to a Model Plus box.
            let bpref = rest.get(i + 1).cloned().unwrap_or_default();
            let node = rest.get(i + 2).cloned().unwrap_or_default();
            let mut paths: Vec<String> = Vec::new();
            let mut for_name: Option<String> = None;
            let mut j = i + 3;
            while j < rest.len() {
                if rest[j] == "--for" {
                    for_name = rest.get(j + 1).cloned();
                    j += 2;
                } else {
                    let raw = PathBuf::from(&rest[j]);
                    let abs = if raw.is_absolute() { raw } else if let Some(base) = cwd { base.join(raw) } else { raw };
                    if !abs.is_file() {
                        return Err(format!("not a file: {}", abs.display()));
                    }
                    paths.push(abs.to_string_lossy().to_string());
                    j += 1;
                }
            }
            if bpref.is_empty() || node.is_empty() || paths.is_empty() {
                return Err("usage: silent bp deliver <blueprint name|id> <box title|id> <file>… [--for <request name>]".into());
            }
            return Ok(json!({ "folder": "", "prompt": "", "blueprint": { "ref": bpref, "node": node, "answer": null, "only": false, "auto": null, "deliver": { "paths": paths, "for": for_name } } }));
        }
        Some("answer") => {
            let bpref = rest.get(i + 1).cloned().unwrap_or_default();
            let node = rest.get(i + 2).cloned().unwrap_or_default();
            let text = rest[(i + 3).min(rest.len())..].join(" ");
            if bpref.is_empty() || node.is_empty() || text.trim().is_empty() {
                return Err("usage: silent bp answer <blueprint name|id> <node title|id> <answer…>".into());
            }
            (bpref, Some(node), Some(text), None)
        }
        Some(bpref) => (bpref.to_string(), rest.get(i + 1).cloned().filter(|s| !s.is_empty()), None, None),
        None => {
            return Err("usage: silent bp <blueprint name|id> [node title|id] | silent bp only <blueprint> <node> | silent bp answer <blueprint> <node> <answer…> | silent bp auto <description…> | silent bp edit <blueprint> <change…> | silent bp fix <blueprint> <problem…> [--file path]… | silent bp deliver <blueprint> <box> <file>… [--for <request>]".into())
        }
    };
    Ok(json!({
        "folder": "",
        "prompt": "",
        "blueprint": { "ref": bpref, "node": node, "answer": answer, "only": only, "auto": auto },
    }))
}

fn parse_run(rest: &[String], cwd: Option<&Path>) -> Result<Value, String> {
    let (mut kit, mut polish, mut cost, mut pool, mut prefer, mut agent) = (None::<String>, None::<bool>, None::<String>, Vec::<String>::new(), None::<String>, None::<String>);
    let (mut turbo, mut mechanical) = (false, false);
    let mut i = 0;
    while i < rest.len() {
        match rest[i].as_str() {
            "--kit" => {
                kit = rest.get(i + 1).cloned();
                i += 2;
            }
            "--no-polish" => {
                polish = Some(false);
                i += 1;
            }
            "--turbo" => {
                turbo = true;
                i += 1;
            }
            "--mechanical" => {
                mechanical = true;
                i += 1;
            }
            "--cost" => {
                cost = rest.get(i + 1).cloned();
                i += 2;
            }
            "--pool" => {
                pool = rest.get(i + 1).map(|p| p.split(',').filter(|s| !s.is_empty()).map(String::from).collect()).unwrap_or_default();
                i += 2;
            }
            "--prefer" => {
                prefer = rest.get(i + 1).cloned();
                i += 2;
            }
            "--agent" => {
                agent = rest.get(i + 1).cloned();
                i += 2;
            }
            _ => break,
        }
    }
    let folder = rest.get(i).cloned().filter(|f| !f.is_empty());
    let prompt = rest[(i + 1).min(rest.len())..].join(" ");
    let (Some(folder), false) = (folder, prompt.trim().is_empty()) else {
        return Err("usage: silent run [--kit ID] [--no-polish] [--turbo] [--mechanical] [--cost MODE] [--pool p:m,p:m] [--prefer p:m] [--agent NAME] <folder> <request…>".into());
    };
    let mut path = PathBuf::from(&folder);
    if path.is_relative() {
        if let Some(base) = cwd {
            path = base.join(path);
        }
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    Ok(json!({
        "folder": path.to_string_lossy(),
        "prompt": prompt,
        "kit": kit,
        "polish": polish,
        "turbo": turbo,
        "mechanical": mechanical,
        "cost": cost,
        "pool": pool,
        "prefer": prefer,
        "agent": agent,
    }))
}

/// Parse launcher argv and queue it for the webview. Errors and non-commands are logged, never fatal.
pub fn queue_from_argv(app: &AppHandle, argv: &[String], cwd: Option<&Path>) {
    match parse_argv(argv, cwd) {
        Ok(Some(value)) => match crate::app_paths::data_dir(app) {
            Some(dir) => match queue_request(&dir.join(AUTOSTART_DIR), &value) {
                Ok(path) => log::info!("autostart queued {}: {}", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), value.to_string().chars().take(160).collect::<String>()),
                Err(e) => log::error!("autostart queue write failed: {e}"),
            },
            None => log::error!("autostart: app data dir unavailable"),
        },
        Ok(None) => {}
        Err(e) => log::warn!("silent argv rejected: {e}"),
    }
}

/// Queue folder: one file per request, taken oldest-first (2026-10-05: a single autostart.json lost every
/// command that arrived within the same 3 s poll — `silent bp A; silent bp B` kept only B).
pub const AUTOSTART_DIR: &str = "autostart";
static QUEUE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Writes `<dir>/<millis>-<counter>.json` atomically (tmp + rename). Returns the final path.
pub fn queue_request(dir: &Path, value: &Value) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let n = QUEUE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let name = format!("{millis:020}-{:06}-{}.json", n, std::process::id());
    let tmp = dir.join(format!("{name}.tmp"));
    let path = dir.join(&name);
    std::fs::write(&tmp, value.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Oldest queued request, removed from the queue; a legacy single `autostart.json` next to the folder is consumed first.
pub fn take_request(dir: &Path, legacy: Option<&Path>) -> Result<Option<Value>, String> {
    if let Some(legacy) = legacy.filter(|p| p.is_file()) {
        let text = std::fs::read_to_string(legacy).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(legacy);
        return serde_json::from_str(&text).map(Some).map_err(|e| format!("autostart.json: {e}"));
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(None);
    };
    let mut names: Vec<String> = entries.flatten().filter_map(|e| e.file_name().to_str().map(str::to_string)).filter(|n| n.ends_with(".json")).collect();
    names.sort();
    let Some(name) = names.into_iter().next() else {
        return Ok(None);
    };
    let path = dir.join(&name);
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    log::info!("autostart taken {name} ({} bytes): {}", text.len(), text.chars().take(160).collect::<String>());
    serde_json::from_str(&text).map(Some).map_err(|e| format!("{name}: {e}"))
}

/// Returns and removes the oldest pending request, if any.
#[tauri::command]
pub fn autostart_take(app: AppHandle) -> Result<Option<Value>, String> {
    let Some(dir) = crate::app_paths::data_dir(&app) else {
        return Ok(None);
    };
    let legacy = crate::app_paths::autostart_path(&app);
    take_request(&dir.join(AUTOSTART_DIR), legacy.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(s: &str) -> Vec<String> {
        std::iter::once("Silent".to_string()).chain(s.split_whitespace().map(String::from)).collect()
    }

    #[test]
    fn parses_bp_default_only_answer_auto_and_reload() {
        let v = parse_argv(&argv("bp Alien n_par"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["ref"], "Alien");
        assert_eq!(v["blueprint"]["node"], "n_par");
        assert_eq!(v["blueprint"]["only"], false);
        assert!(v["blueprint"]["answer"].is_null());
        let v = parse_argv(&argv("bp only Alien Sesçi"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["only"], true);
        let v = parse_argv(&argv("bp answer Alien Mimar use the second option"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["answer"], "use the second option");
        let v = parse_argv(&argv("bp auto a pixel art game"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["auto"], "a pixel art game");
        assert_eq!(v["blueprint"]["ref"], "");
        let v = parse_argv(&argv("bp edit Alien add an effort setting to the main AI"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["edit"], "add an effort setting to the main AI");
        assert_eq!(v["blueprint"]["ref"], "Alien");
        let v = parse_argv(&argv("bp fix Alien flowers clip into the wall --file src/game/world/index.ts --file src/content.ts"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["ref"], "Alien");
        assert_eq!(v["blueprint"]["fix"]["problem"], "flowers clip into the wall");
        assert_eq!(v["blueprint"]["fix"]["files"][1], "src/content.ts");
        assert!(parse_argv(&argv("bp fix Alien"), None).is_err());
        let v = parse_argv(&argv("reload"), None).unwrap().unwrap();
        assert_eq!(v["reload"], true);
        assert_eq!(v["folder"], "");
        assert!(parse_argv(&argv("bp"), None).is_err());
        assert!(parse_argv(&argv("bp answer Alien"), None).is_err());
    }

    #[test]
    fn parses_run_with_all_flags_and_resolves_the_folder_against_cwd() {
        let base = std::env::temp_dir().join(format!("silent-argv-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let v = parse_argv(&argv("--cwd BASE run --kit game-2d-web --no-polish --turbo --mechanical --cost economy --pool a:b,c:d --prefer a:b --agent Pixel demo make a game").iter().map(|s| s.replace("BASE", &base.to_string_lossy())).collect::<Vec<_>>(), None).unwrap().unwrap();
        assert_eq!(v["prompt"], "make a game");
        assert_eq!(v["kit"], "game-2d-web");
        assert_eq!(v["polish"], false);
        assert_eq!(v["turbo"], true);
        assert_eq!(v["mechanical"], true);
        assert_eq!(v["cost"], "economy");
        assert_eq!(v["pool"], json!(["a:b", "c:d"]));
        assert_eq!(v["prefer"], "a:b");
        assert_eq!(v["agent"], "Pixel");
        let folder = PathBuf::from(v["folder"].as_str().unwrap());
        assert!(folder.is_absolute() && folder.ends_with("demo") && folder.is_dir());
        let v = parse_argv(&argv("run demo hello"), Some(&base)).unwrap().unwrap();
        assert!(v["polish"].is_null() && v["kit"].is_null());
        assert_eq!(v["turbo"], false);
        assert_eq!(v["pool"], json!([]));
        assert!(parse_argv(&argv("run demo"), Some(&base)).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn parses_fix_with_run_flag() {
        let v = parse_argv(&argv("bp fix Alien the door is broken --file src/door.ts --run"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["fix"]["problem"], "the door is broken");
        assert_eq!(v["blueprint"]["fix"]["files"][0], "src/door.ts");
        assert_eq!(v["blueprint"]["fix"]["run"], true);
        let v = parse_argv(&argv("bp fix Alien the door is broken"), None).unwrap().unwrap();
        assert_eq!(v["blueprint"]["fix"]["run"], false);
    }

    #[test]
    fn parses_deliver_with_files_resolved_against_cwd() {
        let base = std::env::temp_dir().join(format!("silent-deliver-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("mario-sheet.png"), b"png").unwrap();
        std::fs::write(base.join("coin.wav"), b"wav").unwrap();
        // (the shell hands a quoted title as ONE argv entry; the helper splits on spaces, so use a single-word title here)
        let v = parse_argv(&argv("bp deliver Mario ModelPlus mario-sheet.png coin.wav --for mario"), Some(&base)).unwrap().unwrap();
        assert_eq!(v["blueprint"]["ref"], "Mario");
        assert_eq!(v["blueprint"]["node"], "ModelPlus");
        let paths = v["blueprint"]["deliver"]["paths"].as_array().unwrap();
        assert_eq!(paths.len(), 2);
        assert!(PathBuf::from(paths[0].as_str().unwrap()).is_absolute() && paths[0].as_str().unwrap().ends_with("mario-sheet.png"));
        assert_eq!(v["blueprint"]["deliver"]["for"], "mario");
        assert!(parse_argv(&argv("bp deliver Mario Model"), Some(&base)).is_err());
        assert!(parse_argv(&argv("bp deliver Mario Model missing.png"), Some(&base)).unwrap_err().contains("not a file"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn queue_keeps_every_request_and_takes_them_oldest_first() {
        let base = std::env::temp_dir().join(format!("silent-queue-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("autostart");
        let legacy = base.join("autostart.json");
        assert_eq!(take_request(&dir, Some(&legacy)).unwrap(), None);
        queue_request(&dir, &json!({"n": 1})).unwrap();
        queue_request(&dir, &json!({"n": 2})).unwrap();
        queue_request(&dir, &json!({"n": 3})).unwrap();
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 3, "no tmp files left behind");
        // a legacy single file is consumed before the queue
        std::fs::write(&legacy, r#"{"n":0}"#).unwrap();
        assert_eq!(take_request(&dir, Some(&legacy)).unwrap(), Some(json!({"n": 0})));
        assert!(!legacy.exists());
        assert_eq!(take_request(&dir, Some(&legacy)).unwrap(), Some(json!({"n": 1})));
        assert_eq!(take_request(&dir, Some(&legacy)).unwrap(), Some(json!({"n": 2})));
        assert_eq!(take_request(&dir, Some(&legacy)).unwrap(), Some(json!({"n": 3})));
        assert_eq!(take_request(&dir, Some(&legacy)).unwrap(), None);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn parses_cancel() {
        let v = parse_argv(&argv("cancel"), None).unwrap().unwrap();
        assert_eq!(v["cancel"], true);
        assert!(v["blueprint"].is_null());
    }

    #[test]
    fn ignores_plain_launches() {
        assert_eq!(parse_argv(&argv(""), None).unwrap(), None);
        assert_eq!(parse_argv(&argv("-psn_0_12345"), None).unwrap(), None);
        assert_eq!(parse_argv(&argv("--cwd /tmp"), None).unwrap(), None);
    }
}
