//! Open an interactive command (CLI logins: device codes, browser flows) in the user's terminal.
//! macOS: Terminal.app via osascript · Linux: the first terminal emulator found · Windows: a new console.

use std::process::Stdio;

/// Candidate `(program, args)` pairs on Linux, in preference order; `script` is run by `sh -lc`.
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn linux_terminal_candidates(script: &str, preferred: Option<&str>) -> Vec<(String, Vec<String>)> {
    let sh = |prefix: &[&str]| {
        let mut v: Vec<String> = prefix.iter().map(|s| s.to_string()).collect();
        v.extend(["sh".into(), "-lc".into(), script.to_string()]);
        v
    };
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    if let Some(p) = preferred.filter(|p| !p.trim().is_empty()) {
        out.push((p.to_string(), sh(&["-e"])));
    }
    out.push(("x-terminal-emulator".into(), sh(&["-e"])));
    out.push(("gnome-terminal".into(), sh(&["--"])));
    out.push(("konsole".into(), sh(&["-e"])));
    out.push(("xfce4-terminal".into(), sh(&["-x"])));
    out.push(("kitty".into(), sh(&[])));
    out.push(("alacritty".into(), sh(&["-e"])));
    out.push(("xterm".into(), sh(&["-e"])));
    out
}

/// The shell script a Linux terminal runs: the command, then wait so the user can read the result.
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn linux_script(command: &str) -> String {
    format!("{command}; printf '\\n[silent] done. Press Enter to close.'; read _")
}

pub async fn open_in_terminal(title: &str, command: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = title;
        let script = format!("tell application \"Terminal\" to do script \"{}\"", command.replace('"', "\\\""));
        let out = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .arg("-e")
            .arg("tell application \"Terminal\" to activate")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("could not open Terminal: {e}"))?;
        return if out.status.success() {
            Ok(())
        } else {
            Err(format!("Terminal refused: {}. Run manually: {command}", String::from_utf8_lossy(&out.stderr).trim()))
        };
    }
    #[cfg(windows)]
    {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.args(super::shell::windows_start_console(title, command))
            .env("PATH", super::binaries::augmented_path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        silent_runtime::spawn::configure_child(&mut cmd);
        return cmd.spawn().map(|_| ()).map_err(|e| format!("could not open a console: {e}. Run manually: {command}"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = title;
        let script = linux_script(command);
        let preferred = std::env::var("TERMINAL").ok();
        let mut tried = Vec::new();
        for (program, args) in linux_terminal_candidates(&script, preferred.as_deref()) {
            let Some(path) = super::binaries::resolve(&program) else {
                tried.push(program);
                continue;
            };
            let mut cmd = tokio::process::Command::new(path);
            cmd.args(&args).env("PATH", super::binaries::augmented_path()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            silent_runtime::spawn::configure_child(&mut cmd);
            if cmd.spawn().is_ok() {
                return Ok(());
            }
            tried.push(program);
        }
        return Err(format!("no terminal emulator found (tried {}). Run manually: {command}", tried.join(", ")));
    }
    #[allow(unreachable_code)]
    Err(format!("open a terminal and run: {command}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_candidates_prefer_the_users_terminal_then_the_debian_alternative() {
        let c = linux_terminal_candidates("codex login; read _", Some("foot"));
        assert_eq!(c[0].0, "foot");
        assert_eq!(c[1].0, "x-terminal-emulator");
        assert_eq!(c[2].0, "gnome-terminal");
        assert_eq!(c[2].1[0], "--");
        assert!(c.iter().all(|(_, a)| a.ends_with(&["sh".to_string(), "-lc".to_string(), "codex login; read _".to_string()])));
        assert_eq!(linux_terminal_candidates("x", None)[0].0, "x-terminal-emulator");
    }

    #[test]
    fn linux_script_waits_for_enter() {
        assert!(linux_script("grok login").starts_with("grok login; "));
        assert!(linux_script("grok login").ends_with("read _"));
    }
}
