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
        "bp" => {
            let rest: Vec<String> = it.cloned().collect();
            parse_bp(&rest).map(Some)
        }
        "run" => {
            let rest: Vec<String> = it.cloned().collect();
            parse_run(&rest, cwd.as_deref()).map(Some)
        }
        _ => Ok(None),
    }
}

fn parse_bp(rest: &[String]) -> Result<Value, String> {
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
            return Err("usage: silent bp <blueprint name|id> [node title|id] | silent bp only <blueprint> <node> | silent bp answer <blueprint> <node> <answer…> | silent bp auto <description…>".into())
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
        return Err("usage: silent run [--kit ID] [--no-polish] [--cost MODE] [--pool p:m,p:m] [--prefer p:m] [--agent NAME] <folder> <request…>".into());
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
        "cost": cost,
        "pool": pool,
        "prefer": prefer,
        "agent": agent,
    }))
}

/// Parse launcher argv and queue it for the webview. Errors and non-commands are logged, never fatal.
pub fn queue_from_argv(app: &AppHandle, argv: &[String], cwd: Option<&Path>) {
    match parse_argv(argv, cwd) {
        Ok(Some(value)) => match crate::app_paths::autostart_path(app) {
            Some(path) => match std::fs::write(&path, value.to_string()) {
                Ok(()) => log::info!("autostart queued from argv: {}", value.to_string().chars().take(160).collect::<String>()),
                Err(e) => log::error!("autostart.json write failed: {e}"),
            },
            None => log::error!("autostart: app data dir unavailable"),
        },
        Ok(None) => {}
        Err(e) => log::warn!("silent argv rejected: {e}"),
    }
}

/// Returns and removes the pending request, if any.
#[tauri::command]
pub fn autostart_take(app: AppHandle) -> Result<Option<Value>, String> {
    let Some(path) = crate::app_paths::autostart_path(&app) else {
        return Ok(None);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    // Rust-side evidence (independent of the webview log bridge): a request was taken.
    log::info!("autostart taken ({} bytes): {}", text.len(), text.chars().take(160).collect::<String>());
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("autostart.json: {e}"))?;
    Ok(Some(value))
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
        let v = parse_argv(&argv("--cwd BASE run --kit game-2d-web --no-polish --cost economy --pool a:b,c:d --prefer a:b --agent Pixel demo make a game").iter().map(|s| s.replace("BASE", &base.to_string_lossy())).collect::<Vec<_>>(), None).unwrap().unwrap();
        assert_eq!(v["prompt"], "make a game");
        assert_eq!(v["kit"], "game-2d-web");
        assert_eq!(v["polish"], false);
        assert_eq!(v["cost"], "economy");
        assert_eq!(v["pool"], json!(["a:b", "c:d"]));
        assert_eq!(v["prefer"], "a:b");
        assert_eq!(v["agent"], "Pixel");
        let folder = PathBuf::from(v["folder"].as_str().unwrap());
        assert!(folder.is_absolute() && folder.ends_with("demo") && folder.is_dir());
        let v = parse_argv(&argv("run demo hello"), Some(&base)).unwrap().unwrap();
        assert!(v["polish"].is_null() && v["kit"].is_null());
        assert_eq!(v["pool"], json!([]));
        assert!(parse_argv(&argv("run demo"), Some(&base)).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn ignores_plain_launches() {
        assert_eq!(parse_argv(&argv(""), None).unwrap(), None);
        assert_eq!(parse_argv(&argv("-psn_0_12345"), None).unwrap(), None);
        assert_eq!(parse_argv(&argv("--cwd /tmp"), None).unwrap(), None);
    }
}
