//! Sweep what a worker left behind in a project folder: dev servers (`vite`, `vite preview`, `next dev`, …) and
//! Playwright/Chromium browsers started from that folder. 2026-10-01: four verification lanes left three vite
//! servers and several Chromium windows running; with the lanes gone they pushed the host to load 500.

/// `folder` appears in the command line as a path (itself or a path below it), not as a prefix of a sibling folder:
/// `/…/game` must not match `/…/game-v2` (2026-10-05 R12).
pub fn folder_mentioned(cmdline: &str, folder: &str) -> bool {
    let folder = folder.trim_end_matches('/');
    if folder.is_empty() {
        return false;
    }
    let mut from = 0;
    while let Some(i) = cmdline[from..].find(folder) {
        let start = from + i;
        let end = start + folder.len();
        let before_ok = start == 0 || matches!(cmdline.as_bytes()[start - 1], b' ' | b'=' | b'"' | b'\'' | b':' | b',');
        let after_ok = end == cmdline.len() || matches!(cmdline.as_bytes()[end], b'/' | b' ' | b'"' | b'\'' | b':' | b',');
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

/// The AI CLIs themselves (and Silent): never swept. Judged by the PROGRAM token, not by any path in the arguments
/// (a build folder named `…/codex-game` used to protect everything, 2026-10-05 R12).
pub fn is_our_program(cmdline: &str) -> bool {
    let program = cmdline.split_whitespace().next().unwrap_or("");
    let program = if program.ends_with("/node") || program == "node" { cmdline.split_whitespace().nth(1).unwrap_or("") } else { program };
    let name = program.rsplit('/').next().unwrap_or("");
    matches!(name, "claude" | "codex" | "kimi" | "grok" | "agy" | "silent") || cmdline.starts_with("/Applications/Silent.app/") || program.contains("Silent.app/Contents/MacOS/")
}

fn is_browser(cmdline: &str) -> bool {
    cmdline.contains("ms-playwright/") || cmdline.contains("chrome-headless-shell") || cmdline.contains("Chrome for Testing") || cmdline.contains("Chromium.app/")
}

/// Processes worth sweeping: a browser or a dev server whose command line mentions the folder (or whose cwd is it).
pub fn is_sweepable(cmdline: &str, folder: &str) -> bool {
    let mentions = folder_mentioned(cmdline, folder);
    let browser = is_browser(cmdline);
    let server = cmdline.contains("/node_modules/") && (cmdline.contains("vite") || cmdline.contains("next") || cmdline.contains("webpack") || cmdline.contains("serve") || cmdline.contains("http-server") || cmdline.contains("playwright"));
    !is_our_program(cmdline) && ((browser && mentions) || (server && mentions))
}

/// Lane drivers and browsers started from the folder with RELATIVE paths (`node .silent/tmp/shots/<lane>/run.mjs`):
/// the command line never names the folder, so they are judged by their cwd (2026-10-05: one ran 13 h as an orphan).
pub fn is_sweepable_by_cwd(cmdline: &str, cwd: Option<&str>, folder: &str) -> bool {
    if is_our_program(cmdline) {
        return false;
    }
    let candidate = cmdline.contains(".silent/tmp/") || is_browser(cmdline);
    candidate && cwd.map(|c| c.trim_end_matches('/') == folder.trim_end_matches('/') || c.starts_with(&format!("{}/", folder.trim_end_matches('/')))).unwrap_or(false)
}

#[cfg(unix)]
fn cwd_of(pid: u32) -> Option<String> {
    let out = std::process::Command::new("lsof").args(["-a", "-d", "cwd", "-Fn", "-p", &pid.to_string()]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().find_map(|l| l.strip_prefix('n').map(str::to_string))
}

#[cfg(not(unix))]
fn cwd_of(_pid: u32) -> Option<String> {
    None
}

#[cfg(unix)]
fn list_processes() -> Vec<(u32, String)> {
    let Ok(out) = std::process::Command::new("ps").args(["-axo", "pid=,command="]).output() else { return Vec::new() };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let l = l.trim_start();
            let (pid, cmd) = l.split_once(' ')?;
            Some((pid.trim().parse().ok()?, cmd.trim().to_string()))
        })
        .collect()
}

#[cfg(not(unix))]
fn list_processes() -> Vec<(u32, String)> {
    Vec::new()
}

/// Kill the sweepable processes of `folder`; returns how many were signalled.
pub fn sweep_folder(folder: &str) -> usize {
    let me = std::process::id();
    let victims: Vec<u32> = list_processes()
        .into_iter()
        .filter(|(pid, cmd)| {
            *pid != me
                && (is_sweepable(cmd, folder)
                    // cheap pre-filter before the lsof call: only lane drivers / browsers without the folder in their args
                    || ((cmd.contains(".silent/tmp/") || is_browser(cmd)) && is_sweepable_by_cwd(cmd, cwd_of(*pid).as_deref(), folder)))
        })
        .map(|(pid, _)| pid)
        .collect();
    for pid in &victims {
        silent_runtime::children::kill_tree(*pid);
    }
    if !victims.is_empty() {
        log::info!("swept {} leftover process(es) of {folder}", victims.len());
    }
    victims.len()
}

#[tauri::command]
pub async fn project_sweep(folder: String) -> Result<usize, String> {
    if folder.trim().len() < 8 {
        return Err("folder too short to sweep safely".into());
    }
    Ok(tokio::task::spawn_blocking(move || sweep_folder(&folder)).await.unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_browsers_and_dev_servers_of_the_folder_only() {
        let f = "/Users/x/CubeCode/blueprints/game/build";
        assert!(is_sweepable("node /Users/x/CubeCode/blueprints/game/build/node_modules/vite/bin/vite.js --port 5199", f));
        assert!(is_sweepable("npm exec vite --port 5199 PWD=/Users/x/CubeCode/blueprints/game/build", f) == false); // no node_modules path
        assert!(is_sweepable("/Users/x/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing --user-data-dir=/Users/x/CubeCode/blueprints/game/build/.silent/tmp/pw", f));
        assert!(!is_sweepable("/Users/x/Library/Caches/ms-playwright/chromium-1243/chrome --user-data-dir=/tmp/other", f));
        assert!(!is_sweepable("/Users/x/.local/bin/claude -p work in /Users/x/CubeCode/blueprints/game/build", f));
        assert!(!is_sweepable("node /Users/x/other/node_modules/vite/bin/vite.js", f));
    }

    #[test]
    fn folder_match_is_a_path_boundary_and_ours_is_judged_by_the_program() {
        let f = "/Users/x/CubeCode/blueprints/game";
        assert!(folder_mentioned("node /Users/x/CubeCode/blueprints/game/node_modules/vite/bin/vite.js", f));
        assert!(folder_mentioned("chrome --user-data-dir=/Users/x/CubeCode/blueprints/game/.silent/tmp/pw", f));
        assert!(!folder_mentioned("node /Users/x/CubeCode/blueprints/game-v2/node_modules/vite/bin/vite.js", f));
        assert!(!is_sweepable("node /Users/x/CubeCode/blueprints/game-v2/node_modules/vite/bin/vite.js --port 1", f));
        // a folder whose path contains "/codex" must not shield a dev server inside it
        let g = "/Users/x/CubeCode/codex-game/build";
        assert!(is_sweepable("node /Users/x/CubeCode/codex-game/build/node_modules/vite/bin/vite.js", g));
        assert!(is_our_program("/opt/homebrew/bin/codex exec --cd /Users/x/CubeCode/blueprints/game"));
        assert!(is_our_program("node /opt/homebrew/bin/codex exec"));
        assert!(is_our_program("/Users/x/.local/bin/claude -p hi"));
        assert!(!is_our_program("node /Users/x/CubeCode/codex-game/build/node_modules/vite/bin/vite.js"));
    }

    #[test]
    fn lane_drivers_with_relative_paths_are_swept_by_cwd() {
        let f = "/Users/x/CubeCode/blueprints/game";
        assert!(is_sweepable_by_cwd("node .silent/tmp/shots/blok-koy/run.mjs .silent/tmp/shots/blok-koy", Some(f), f));
        assert!(is_sweepable_by_cwd("/Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell --headless", Some("/Users/x/CubeCode/blueprints/game/sub"), f));
        assert!(!is_sweepable_by_cwd("node .silent/tmp/shots/x/run.mjs", Some("/Users/x/other"), f));
        assert!(!is_sweepable_by_cwd("node .silent/tmp/shots/x/run.mjs", None, f));
        assert!(!is_sweepable_by_cwd("/Users/x/.local/bin/claude -p run .silent/tmp/shots/x/run.mjs", Some(f), f));
        assert!(!is_sweepable_by_cwd("node src/server.js", Some(f), f)); // not a lane driver or browser
    }
}
