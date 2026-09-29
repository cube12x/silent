//! Cross-platform path helpers shared by the runtime and the app: home directory, CLI search
//! directories, Windows `.cmd`/`.exe` candidates, npm shim unwrapping, separators.
//! Everything that depends on the host is parameterised so the tests run the same on every OS.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    MacOs,
    Linux,
    Windows,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::MacOs
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// The user's home directory: `HOME`, then Windows' `USERPROFILE`, then `HOMEDRIVE`+`HOMEPATH`.
pub fn home() -> Option<PathBuf> {
    home_from(|k| std::env::var_os(k))
}

pub fn home_from(get: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    let nonempty = |v: OsString| if v.is_empty() { None } else { Some(v) };
    if let Some(h) = get("HOME").and_then(nonempty) {
        return Some(PathBuf::from(h));
    }
    if let Some(h) = get("USERPROFILE").and_then(nonempty) {
        return Some(PathBuf::from(h));
    }
    match (get("HOMEDRIVE").and_then(nonempty), get("HOMEPATH").and_then(nonempty)) {
        (Some(mut drive), Some(path)) => {
            drive.push(path);
            Some(PathBuf::from(drive))
        }
        _ => None,
    }
}

/// `std::env::temp_dir()` as a string without a trailing separator (Windows returns `C:\...\Temp\`).
pub fn temp_dir_str() -> String {
    trim_trailing_separator(&std::env::temp_dir().to_string_lossy())
}

pub fn trim_trailing_separator(s: &str) -> String {
    let t = s.trim_end_matches(['/', '\\']);
    if t.is_empty() { s.to_string() } else { t.to_string() }
}

/// File names to try for a CLI called `binary`: the bare name on unix; `.exe`, then the npm
/// `.cmd`/`.bat` shims on Windows (a native `claude.exe` beats its npm shim).
pub fn exe_candidates(binary: &str) -> Vec<String> {
    exe_candidates_for(binary, cfg!(windows))
}

pub fn exe_candidates_for(binary: &str, windows: bool) -> Vec<String> {
    if !windows || Path::new(binary).extension().is_some() {
        return vec![binary.to_string()];
    }
    ["exe", "cmd", "bat"].iter().map(|ext| format!("{binary}.{ext}")).collect()
}

/// Directories to search for CLIs: PATH, the platform's usual install spots, the version managers.
/// Apps launched from Finder/the Start menu inherit a minimal PATH, so this list is deliberately wide.
pub fn user_bin_dirs() -> Vec<PathBuf> {
    let env: HashMap<String, String> = std::env::vars().collect();
    user_bin_dirs_for(&env, home().as_deref(), Os::current())
}

pub fn user_bin_dirs_for(env: &HashMap<String, String>, home: Option<&Path>, os: Os) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = env.get("PATH").map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    match os {
        Os::MacOs | Os::Linux => {
            for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/home/linuxbrew/.linuxbrew/bin", "/snap/bin"] {
                dirs.push(PathBuf::from(fixed));
            }
        }
        Os::Windows => {
            let joined = |key: &str, rel: &str| env.get(key).map(|base| Path::new(base).join(rel));
            for (key, rel) in [
                ("APPDATA", "npm"),
                ("ProgramFiles", "nodejs"),
                ("ProgramFiles(x86)", "nodejs"),
                ("LOCALAPPDATA", "Programs\\nodejs"),
                ("LOCALAPPDATA", "Volta\\bin"),
                ("LOCALAPPDATA", "pnpm"),
                ("LOCALAPPDATA", "Silent\\bin"),
                ("ProgramFiles", "Git\\cmd"),
            ] {
                if let Some(d) = joined(key, rel) {
                    dirs.push(d);
                }
            }
            if let Some(appdata) = env.get("APPDATA") {
                // nvm-windows keeps node.exe directly in the version dir; fnm under installation/
                dirs.extend(version_dirs(&Path::new(appdata).join("nvm"), ""));
                dirs.extend(version_dirs(&Path::new(appdata).join("fnm").join("node-versions"), "installation"));
            }
        }
    }
    if let Some(home) = home {
        for rel in [".local/bin", ".npm-global/bin", ".cargo/bin", ".bun/bin", ".kimi-code/bin", ".grok/bin", ".cursor/bin", ".opencode/bin", ".volta/bin"] {
            dirs.push(home.join(rel));
        }
        match os {
            Os::MacOs => {
                dirs.push(home.join("Library/pnpm"));
                dirs.extend(version_dirs(&home.join("Library/Application Support/fnm/node-versions"), "installation/bin"));
            }
            Os::Linux => {
                dirs.push(home.join(".local/share/pnpm"));
                dirs.extend(version_dirs(&home.join(".local/share/fnm/node-versions"), "installation/bin"));
            }
            Os::Windows => {}
        }
        dirs.extend(version_dirs(&home.join(".nvm/versions/node"), "bin"));
    }
    let mut seen: Vec<PathBuf> = Vec::with_capacity(dirs.len());
    for d in dirs {
        if !seen.contains(&d) {
            seen.push(d);
        }
    }
    seen
}

/// Sub-directories of `parent` (a version manager's install root), newest version first, each
/// joined with `suffix`. Empty when the parent does not exist.
pub fn version_dirs(parent: &Path, suffix: &str) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(parent) else { return Vec::new() };
    let mut names: Vec<String> = read
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
    names
        .into_iter()
        .map(|n| if suffix.is_empty() { parent.join(n) } else { parent.join(n).join(suffix) })
        .collect()
}

fn version_key(name: &str) -> Vec<u64> {
    name.trim_start_matches('v').split(|c: char| !c.is_ascii_digit()).filter_map(|p| p.parse().ok()).collect()
}

/// The JavaScript entry an npm `.cmd` shim runs (`"%dp0%\node_modules\@openai\codex\bin\codex.js"`),
/// resolved next to the shim. Rust's `Command` runs `.cmd` files through `cmd.exe` and rejects
/// arguments containing quotes or newlines (prompts have both), so the shim must be unwrapped.
pub fn npm_shim_target_in(content: &str, shim_dir: &Path) -> Option<PathBuf> {
    let re = regex::Regex::new(r#"%~?dp0%?\\([^"\r\n]+?\.[cm]?js)""#).ok()?;
    let caps = re.captures(content)?;
    let rel = caps.get(1)?.as_str().replace('\\', "/");
    Some(rel.split('/').filter(|s| !s.is_empty()).fold(shim_dir.to_path_buf(), |acc, part| acc.join(part)))
}

/// Read a `.cmd`/`.bat` shim and return its JavaScript entry, or `None` for anything else.
pub fn npm_shim_js(shim: &Path) -> Option<PathBuf> {
    let ext = shim.extension()?.to_string_lossy().to_ascii_lowercase();
    if ext != "cmd" && ext != "bat" {
        return None;
    }
    let content = std::fs::read_to_string(shim).ok()?;
    npm_shim_target_in(&content, shim.parent()?)
}

/// Package caches a sandboxed CLI may need to write to (npm/npx installs inside the sandbox).
pub fn cache_roots(home: &Path, os: Os) -> Vec<PathBuf> {
    match os {
        Os::Windows => ["AppData\\Local\\npm-cache", "AppData\\Roaming\\npm", ".cargo\\registry", ".bun\\install\\cache"].iter().map(|r| home.join(r)).collect(),
        Os::MacOs => [".npm", ".cache", ".cargo/registry", ".bun/install/cache", "Library/Caches"].iter().map(|r| home.join(r)).collect(),
        Os::Linux => [".npm", ".cache", ".cargo/registry", ".bun/install/cache"].iter().map(|r| home.join(r)).collect(),
    }
}

/// Where projects and blueprint builds go unless the user picked another folder in Settings.
pub fn default_workspace_root() -> Option<PathBuf> {
    home().map(|h| h.join("CubeCode"))
}

/// A relative path with `/` separators, whatever the host uses (paths shown to the webview and
/// concatenated in TypeScript must not carry `\`).
pub fn to_slash(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .filter(|s| !s.is_empty() && s != "/" && s != "\\")
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn home_prefers_home_then_userprofile_then_homedrive() {
        let get = |k: &str| match k {
            "HOME" => Some(OsString::from("/home/a")),
            "USERPROFILE" => Some(OsString::from("C:\\Users\\b")),
            _ => None,
        };
        assert_eq!(home_from(get), Some(PathBuf::from("/home/a")));
        let get = |k: &str| match k {
            "HOME" => Some(OsString::from("")),
            "USERPROFILE" => Some(OsString::from("C:\\Users\\b")),
            _ => None,
        };
        assert_eq!(home_from(get), Some(PathBuf::from("C:\\Users\\b")));
        let get = |k: &str| match k {
            "HOMEDRIVE" => Some(OsString::from("D:")),
            "HOMEPATH" => Some(OsString::from("\\Users\\c")),
            _ => None,
        };
        assert_eq!(home_from(get), Some(PathBuf::from("D:\\Users\\c")));
        assert_eq!(home_from(|_| None), None);
    }

    #[test]
    fn exe_candidates_windows_order_and_unix_bare() {
        assert_eq!(exe_candidates_for("claude", true), vec!["claude.exe", "claude.cmd", "claude.bat"]);
        assert_eq!(exe_candidates_for("claude", false), vec!["claude"]);
        assert_eq!(exe_candidates_for("agent.exe", true), vec!["agent.exe"]);
    }

    #[test]
    fn user_bin_dirs_windows_uses_appdata_npm_and_node_installs() {
        let e = env(&[("PATH", "C:\\Windows\\system32"), ("APPDATA", "C:\\Users\\b\\AppData\\Roaming"), ("LOCALAPPDATA", "C:\\Users\\b\\AppData\\Local"), ("ProgramFiles", "C:\\Program Files")]);
        let dirs = user_bin_dirs_for(&e, Some(Path::new("C:\\Users\\b")), Os::Windows);
        // joins use the host separator; compare with everything normalised to `\`
        let has = |s: &str| dirs.iter().any(|d| d.to_string_lossy().replace('/', "\\") == s);
        assert!(has("C:\\Users\\b\\AppData\\Roaming\\npm"), "{dirs:?}");
        assert!(has("C:\\Program Files\\nodejs"));
        assert!(has("C:\\Users\\b\\AppData\\Local\\Programs\\nodejs"));
        assert!(!dirs.iter().any(|d| d.starts_with("/opt/homebrew/bin")));
    }

    #[test]
    fn user_bin_dirs_unix_keeps_path_first_then_fixed_then_home() {
        let e = env(&[("PATH", "/custom/bin:/usr/bin")]);
        let dirs = user_bin_dirs_for(&e, Some(Path::new("/home/a")), Os::Linux);
        assert_eq!(dirs[0], PathBuf::from("/custom/bin"));
        assert!(dirs.contains(&PathBuf::from("/snap/bin")));
        assert!(dirs.contains(&PathBuf::from("/home/a/.local/bin")));
        assert_eq!(dirs.iter().filter(|d| **d == PathBuf::from("/usr/bin")).count(), 1, "deduplicated");
    }

    #[test]
    fn version_dirs_newest_first() {
        let root = std::env::temp_dir().join(format!("silent-paths-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for v in ["v20.1.0", "v22.3.0", "v9.0.0"] {
            std::fs::create_dir_all(root.join(".nvm/versions/node").join(v).join("bin")).unwrap();
        }
        let dirs = user_bin_dirs_for(&env(&[]), Some(&root), Os::Linux);
        let nvm: Vec<String> = dirs.iter().filter(|d| d.to_string_lossy().contains(".nvm")).map(|d| d.to_string_lossy().into_owned()).collect();
        assert_eq!(nvm.len(), 3);
        assert!(nvm[0].contains("v22.3.0"), "{nvm:?}");
        assert!(nvm[2].contains("v9.0.0"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn npm_shim_target_parses_the_real_cmd_shim() {
        let shim = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js\" %*\r\n";
        let js = npm_shim_target_in(shim, Path::new("C:\\Users\\b\\AppData\\Roaming\\npm")).unwrap();
        assert_eq!(js, Path::new("C:\\Users\\b\\AppData\\Roaming\\npm").join("node_modules").join("@openai").join("codex").join("bin").join("codex.js"));
        assert!(npm_shim_target_in("@echo off\r\nnode something", Path::new("x")).is_none());
    }

    #[test]
    fn to_slash_and_temp_dir_have_no_backslashes_or_trailing_separator() {
        assert_eq!(to_slash(Path::new("a/b/c.png")), "a/b/c.png");
        assert_eq!(trim_trailing_separator("C:\\Temp\\"), "C:\\Temp");
        assert_eq!(trim_trailing_separator("/tmp/"), "/tmp");
        assert_eq!(trim_trailing_separator("/"), "/");
        assert!(!temp_dir_str().ends_with('/') || temp_dir_str() == "/");
    }

    #[test]
    fn cache_roots_per_os() {
        assert!(cache_roots(Path::new("/Users/a"), Os::MacOs).iter().any(|p| p.ends_with("Library/Caches")));
        assert!(!cache_roots(Path::new("/home/a"), Os::Linux).iter().any(|p| p.to_string_lossy().contains("Library")));
        assert!(cache_roots(Path::new("C:\\Users\\a"), Os::Windows).iter().any(|p| p.to_string_lossy().contains("npm-cache")));
    }
}
