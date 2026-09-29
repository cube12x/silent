//! The platform shell used to run install commands (`npm install -g …`, `curl … | bash`).

use silent_runtime::SpawnConfig;

use super::binaries;

/// A `SpawnConfig` that runs `command` through the user's shell with Silent's augmented PATH.
/// Unix: a login shell so version managers (nvm, volta) are initialised. Windows: `cmd.exe`.
pub fn shell_config(command: &str) -> SpawnConfig {
    if cfg!(windows) {
        // `set "PATH=…"` inside the same cmd so freshly installed CLIs (npm's %APPDATA%\npm) are found.
        let script = format!("set \"PATH={};%PATH%\" && {command}", binaries::augmented_path());
        SpawnConfig::new("cmd.exe", vec!["/d".into(), "/s".into(), "/c".into(), format!("\"{script}\"")])
    } else {
        SpawnConfig::new(
            "/bin/sh",
            vec!["-lc".into(), format!("export PATH=\"{}:$PATH\"; {command}", binaries::augmented_path())],
        )
    }
}

/// `cmd /c start "<title>" cmd /k "<command>"`: a new console window that stays open after the command.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_start_console(title: &str, command: &str) -> Vec<String> {
    vec!["/c".into(), "start".into(), format!("\"{}\"", title.replace('"', "")), "cmd".into(), "/k".into(), format!("\"{command}\"")]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_start_console_keeps_the_window_open_with_a_title() {
        let args = windows_start_console("Silent — codex login", "codex login");
        assert_eq!(args[0..2], ["/c".to_string(), "start".to_string()]);
        assert_eq!(args[2], "\"Silent — codex login\"");
        assert_eq!(args[4], "/k");
        assert_eq!(args[5], "\"codex login\"");
    }

    #[test]
    fn shell_config_targets_the_host_shell() {
        let c = shell_config("echo hi");
        if cfg!(windows) {
            assert_eq!(c.program.to_string_lossy(), "cmd.exe");
            assert!(c.args.last().unwrap().contains("echo hi"));
        } else {
            assert_eq!(c.program.to_string_lossy(), "/bin/sh");
            assert_eq!(c.args[0], "-lc");
            assert!(c.args[1].ends_with("; echo hi"));
        }
    }
}
