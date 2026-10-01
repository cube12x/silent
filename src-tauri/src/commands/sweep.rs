//! Sweep what a worker left behind in a project folder: dev servers (`vite`, `vite preview`, `next dev`, …) and
//! Playwright/Chromium browsers started from that folder. 2026-10-01: four verification lanes left three vite
//! servers and several Chromium windows running; with the lanes gone they pushed the host to load 500.

/// Processes worth sweeping: a browser or a dev server whose command line mentions the folder (or whose cwd is it).
pub fn is_sweepable(cmdline: &str, folder: &str) -> bool {
    let mentions = cmdline.contains(folder);
    let browser = cmdline.contains("ms-playwright/") || cmdline.contains("chrome-headless-shell") || cmdline.contains("Chrome for Testing");
    let server = cmdline.contains("/node_modules/") && (cmdline.contains("vite") || cmdline.contains("next") || cmdline.contains("webpack") || cmdline.contains("serve") || cmdline.contains("http-server") || cmdline.contains("playwright"));
    let ours = cmdline.contains("/bin/claude") || cmdline.contains("/codex") || cmdline.contains("/kimi") || cmdline.contains("/grok") || cmdline.contains("/agy") || cmdline.contains("Silent.app/");
    !ours && ((browser && mentions) || (server && mentions))
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
    let victims: Vec<u32> = list_processes().into_iter().filter(|(pid, cmd)| *pid != me && is_sweepable(cmd, folder)).map(|(pid, _)| pid).collect();
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
}
