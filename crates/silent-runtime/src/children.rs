//! Registry of CLI children Silent spawned (`<log dir>/children.jsonl`): one line per live child. Normal quit
//! kills what is still listed; the next start reaps whatever a crash or `kill -9` left behind
//! (2026-09-29: an Opus worker kept writing for six minutes after the app had quit).

use std::io::Write;
use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ChildRecord {
    pub pid: u32,
    pub program: String,
    pub run_id: String,
    pub started_ms: u64,
}

pub fn load(path: &Path) -> Vec<ChildRecord> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

fn save(path: &Path, records: &[ChildRecord]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let body: String = records.iter().filter_map(|r| serde_json::to_string(r).ok()).map(|l| l + "\n").collect();
    std::fs::write(path, body)
}

/// Append a live child (best effort; never fails a spawn).
pub fn record(path: &Path, rec: &ChildRecord) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{}", serde_json::to_string(rec).unwrap_or_default())
}

/// Drop a child that exited.
pub fn forget(path: &Path, pid: u32) -> std::io::Result<()> {
    let kept: Vec<ChildRecord> = load(path).into_iter().filter(|r| r.pid != pid).collect();
    save(path, &kept)
}

/// Kill every recorded child that `is_ours` confirms (still alive and still the program we started), then
/// clear the file. Returns how many were killed.
pub fn sweep(path: &Path, is_ours: impl Fn(&ChildRecord) -> bool, kill: impl Fn(&ChildRecord)) -> usize {
    let mut n = 0;
    for rec in load(path) {
        if is_ours(&rec) {
            kill(&rec);
            n += 1;
        }
    }
    let _ = save(path, &[]);
    n
}

/// The command line of a live process, `None` when it is gone (unix `ps`, Windows `tasklist`).
pub fn process_command(pid: u32) -> Option<String> {
    #[cfg(unix)]
    {
        let out = std::process::Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).stdin(Stdio::null()).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return if s.is_empty() { None } else { Some(s) };
    }
    #[cfg(windows)]
    {
        let out = std::process::Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]).stdin(Stdio::null()).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return if s.contains(&format!("\"{pid}\"")) { Some(s) } else { None };
    }
    #[allow(unreachable_code)]
    None
}

/// A recorded child is ours when it is alive and its command line still starts with the program we spawned.
pub fn is_ours(rec: &ChildRecord) -> bool {
    match process_command(rec.pid) {
        Some(cmd) => cmd.starts_with(&rec.program) || cmd.contains(&rec.run_id),
        None => false,
    }
}

/// Terminate a child and everything it started (its process group on unix, the tree on Windows).
pub fn kill_tree(pid: u32) {
    #[cfg(unix)]
    {
        for sig in ["TERM", "KILL"] {
            let _ = std::process::Command::new("kill").args([&format!("-{sig}"), "--", &format!("-{pid}")]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
            let _ = std::process::Command::new("kill").args([&format!("-{sig}"), &pid.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
            if sig == "TERM" {
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("silent-children-{}-{name}.jsonl", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p
    }

    fn rec(pid: u32) -> ChildRecord {
        ChildRecord { pid, program: "/usr/bin/true".into(), run_id: format!("run_{pid}"), started_ms: 1 }
    }

    #[test]
    fn record_forget_roundtrip() {
        let p = tmp("rt");
        record(&p, &rec(1)).unwrap();
        record(&p, &rec(2)).unwrap();
        assert_eq!(load(&p).iter().map(|r| r.pid).collect::<Vec<_>>(), vec![1, 2]);
        forget(&p, 1).unwrap();
        assert_eq!(load(&p), vec![rec(2)]);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn sweep_kills_only_confirmed_children_and_clears_the_file() {
        let p = tmp("sweep");
        record(&p, &rec(10)).unwrap();
        record(&p, &rec(11)).unwrap();
        let killed = std::cell::RefCell::new(Vec::new());
        let n = sweep(&p, |r| r.pid == 11, |r| killed.borrow_mut().push(r.pid));
        assert_eq!(n, 1);
        assert_eq!(*killed.borrow(), vec![11]);
        assert!(load(&p).is_empty());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_dead_pid_is_never_ours() {
        assert!(!is_ours(&ChildRecord { pid: u32::MAX - 7, program: "/x".into(), run_id: "r".into(), started_ms: 0 }));
    }
}
