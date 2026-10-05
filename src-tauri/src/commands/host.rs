//! Host load for the load guard (Faz 3): the webview polls this and caps concurrent AI sessions when the
//! machine is starved (four CLIs plus a build pushed the host into swap on 2026-09-30).

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostLoad {
    pub load1: f64,
    pub cpus: u32,
    pub swap_used_pct: Option<f64>,
    /// Share of CPU time idle over a ~1 s sample (2026-10-05): macOS load averages sit near the core count while half
    /// the CPU is idle, so load1 alone throttled orchestrations to one task for hours.
    pub cpu_idle_pct: Option<f64>,
    /// 1 normal · 2 warn · 4 critical (macOS `kern.memorystatus_vm_pressure_level`; Linux derived from MemAvailable).
    pub mem_pressure: Option<u8>,
}

/// `{ 1.23 4.56 7.89 }` (macOS sysctl vm.loadavg) or `1.23 4.56 7.89 1/234 5678` (/proc/loadavg).
pub fn parse_load1(text: &str) -> Option<f64> {
    // Locales with a decimal comma (tr_TR) print `{ 59,25 94,45 … }` — seen in the installed app on 2026-09-30.
    text.split(|c: char| c.is_whitespace() || c == '{' || c == '}').find(|t| !t.is_empty())?.replace(',', ".").parse().ok()
}

/// macOS `sysctl -n vm.swapusage`: `total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)`.
pub fn parse_swap_pct_macos(text: &str) -> Option<f64> {
    fn val(text: &str, key: &str) -> Option<f64> {
        let i = text.find(key)? + key.len();
        let rest = text[i..].trim_start_matches([' ', '=']).trim_start();
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect::<String>().replace(',', ".");
        let unit = rest[num.len()..].chars().next().unwrap_or('M');
        let n: f64 = num.parse().ok()?;
        Some(match unit {
            'K' => n / 1024.0,
            'G' => n * 1024.0,
            _ => n,
        })
    }
    let total = val(text, "total")?;
    let used = val(text, "used")?;
    if total <= 0.0 {
        return Some(0.0);
    }
    Some((used / total * 100.0).clamp(0.0, 100.0))
}

/// Linux /proc/meminfo: SwapTotal / SwapFree lines.
pub fn parse_swap_pct_linux(text: &str) -> Option<f64> {
    fn kb(text: &str, key: &str) -> Option<f64> {
        text.lines().find(|l| l.starts_with(key))?.split_whitespace().nth(1)?.parse().ok()
    }
    let total = kb(text, "SwapTotal:")?;
    let free = kb(text, "SwapFree:")?;
    if total <= 0.0 {
        return Some(0.0);
    }
    Some(((total - free) / total * 100.0).clamp(0.0, 100.0))
}

/// `top -l 2 -n 0 -s 1` output: the LAST "CPU usage: … NN.NN% idle" line (the first sample is since boot).
/// Decimal commas (tr_TR) are accepted.
pub fn parse_cpu_idle_top(text: &str) -> Option<f64> {
    let line = text.lines().filter(|l| l.contains("CPU usage")).last()?;
    let idle_at = line.find("% idle")?;
    let head = &line[..idle_at];
    let num: String = head.chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect::<String>().chars().rev().collect();
    let v: f64 = num.replace(',', ".").parse().ok()?;
    Some(v.clamp(0.0, 100.0))
}

/// Linux /proc/stat aggregate `cpu ` line → (idle + iowait, total of the first 8 fields).
pub fn parse_proc_stat_cpu(text: &str) -> Option<(u64, u64)> {
    let line = text.lines().find(|l| l.starts_with("cpu "))?;
    let f: Vec<u64> = line.split_whitespace().skip(1).take(8).filter_map(|x| x.parse().ok()).collect();
    if f.len() < 5 {
        return None;
    }
    let idle = f[3] + f[4];
    let total: u64 = f.iter().sum();
    Some((idle, total))
}

/// Idle % between two /proc/stat samples; None when no time passed.
pub fn idle_pct_between(a: (u64, u64), b: (u64, u64)) -> Option<f64> {
    let dt = b.1.checked_sub(a.1)?;
    if dt == 0 {
        return None;
    }
    let di = b.0.saturating_sub(a.0);
    Some((di as f64 / dt as f64 * 100.0).clamp(0.0, 100.0))
}

/// Linux memory pressure from /proc/meminfo: MemAvailable/MemTotal < 5 % → 4 (critical), < 15 % → 2 (warn), else 1.
pub fn pressure_from_meminfo(text: &str) -> Option<u8> {
    fn kb(text: &str, key: &str) -> Option<f64> {
        text.lines().find(|l| l.starts_with(key))?.split_whitespace().nth(1)?.parse().ok()
    }
    let total = kb(text, "MemTotal:")?;
    let avail = kb(text, "MemAvailable:")?;
    if total <= 0.0 {
        return None;
    }
    let pct = avail / total * 100.0;
    Some(if pct < 5.0 { 4 } else if pct < 15.0 { 2 } else { 1 })
}

/// `sysctl -n kern.memorystatus_vm_pressure_level` → 1/2/4.
pub fn parse_pressure_level(text: &str) -> Option<u8> {
    text.trim().parse().ok().filter(|v: &u8| *v >= 1)
}

fn cpu_idle_macos() -> Option<f64> {
    let out = std::process::Command::new("top").args(["-l", "2", "-n", "0", "-s", "1"]).output().ok()?;
    out.status.success().then(|| parse_cpu_idle_top(&String::from_utf8_lossy(&out.stdout))).flatten()
}

fn cpu_idle_linux() -> Option<f64> {
    let a = parse_proc_stat_cpu(&std::fs::read_to_string("/proc/stat").ok()?)?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    let b = parse_proc_stat_cpu(&std::fs::read_to_string("/proc/stat").ok()?)?;
    idle_pct_between(a, b)
}

fn sysctl(key: &str) -> Option<String> {
    let out = std::process::Command::new("sysctl").arg("-n").arg(key).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn read_host_load() -> HostLoad {
    let cpus = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1);
    let (load1, swap, idle, pressure) = if cfg!(target_os = "macos") {
        (
            sysctl("vm.loadavg").and_then(|s| parse_load1(&s)),
            sysctl("vm.swapusage").and_then(|s| parse_swap_pct_macos(&s)),
            cpu_idle_macos(),
            sysctl("kern.memorystatus_vm_pressure_level").and_then(|s| parse_pressure_level(&s)),
        )
    } else if cfg!(target_os = "linux") {
        let meminfo = std::fs::read_to_string("/proc/meminfo").ok();
        (
            std::fs::read_to_string("/proc/loadavg").ok().and_then(|s| parse_load1(&s)),
            meminfo.as_deref().and_then(parse_swap_pct_linux),
            cpu_idle_linux(),
            meminfo.as_deref().and_then(pressure_from_meminfo),
        )
    } else {
        (None, None, None, None)
    };
    HostLoad { load1: load1.unwrap_or(0.0), cpus, swap_used_pct: swap, cpu_idle_pct: idle, mem_pressure: pressure }
}

#[tauri::command]
pub async fn host_load() -> HostLoad {
    tokio::task::spawn_blocking(read_host_load).await.unwrap_or(HostLoad { load1: 0.0, cpus: 1, swap_used_pct: None, cpu_idle_pct: None, mem_pressure: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_load_averages_from_both_platforms() {
        assert_eq!(parse_load1("{ 3.52 4.10 4.35 }"), Some(3.52));
        assert_eq!(parse_load1("0.61 0.70 0.75 2/1234 5678\n"), Some(0.61));
        assert_eq!(parse_load1(""), None);
        assert_eq!(parse_load1("{ 59,25 94,45 138,88 }"), Some(59.25));
    }

    #[test]
    fn parses_swap_usage() {
        assert_eq!(parse_swap_pct_macos("total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)"), Some(50.0));
        assert_eq!(parse_swap_pct_macos("total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)"), Some(0.0));
        assert_eq!(parse_swap_pct_macos("total = 1.00G  used = 256.00M  free = 768.00M"), Some(25.0));
        assert_eq!(parse_swap_pct_linux("MemTotal: 100 kB\nSwapTotal:       8000 kB\nSwapFree:        2000 kB\n"), Some(75.0));
        assert_eq!(parse_swap_pct_linux("SwapTotal: 0 kB\nSwapFree: 0 kB\n"), Some(0.0));
    }

    #[test]
    fn reads_the_live_host_without_panicking() {
        let h = read_host_load();
        assert!(h.cpus >= 1);
        assert!(h.load1 >= 0.0);
        if let Some(idle) = h.cpu_idle_pct {
            assert!((0.0..=100.0).contains(&idle), "{idle}");
        }
        if let Some(p) = h.mem_pressure {
            assert!(p >= 1, "{p}");
        }
    }

    #[test]
    fn parses_cpu_idle_from_top_taking_the_last_sample() {
        let two = "Processes: 600 total\nCPU usage: 3.10% user, 2.00% sys, 94.90% idle \nPhysMem: 7G used\n\nProcesses: 600 total\nCPU usage: 22.14% user, 25.71% sys, 52.14% idle \n";
        assert_eq!(parse_cpu_idle_top(two), Some(52.14));
        // tr_TR decimal comma
        assert_eq!(parse_cpu_idle_top("CPU usage: 10,5% user, 4,25% sys, 85,25% idle"), Some(85.25));
        assert_eq!(parse_cpu_idle_top("no cpu line here"), None);
    }

    #[test]
    fn parses_proc_stat_aggregate_cpu_line() {
        let text = "cpu  100 5 50 800 40 0 5 0 0 0\ncpu0 50 2 25 400 20 0 2 0 0 0\nintr 1 2 3\n";
        // idle = idle + iowait = 800 + 40; total = sum of the first 8 fields = 1000
        assert_eq!(parse_proc_stat_cpu(text), Some((840, 1000)));
        assert_eq!(parse_proc_stat_cpu("cpu0 1 2 3 4\n"), None);
        assert_eq!(idle_pct_between((840, 1000), (1340, 2000)), Some(50.0));
        assert_eq!(idle_pct_between((10, 10), (10, 10)), None);
    }

    #[test]
    fn memory_pressure_from_meminfo_thresholds() {
        let mk = |avail: u64| format!("MemTotal:       1000000 kB\nMemFree: 1 kB\nMemAvailable:   {avail} kB\n");
        assert_eq!(pressure_from_meminfo(&mk(40_000)), Some(4));
        assert_eq!(pressure_from_meminfo(&mk(100_000)), Some(2));
        assert_eq!(pressure_from_meminfo(&mk(500_000)), Some(1));
        assert_eq!(pressure_from_meminfo("MemTotal: 0 kB\n"), None);
        assert_eq!(parse_pressure_level("2\n"), Some(2));
        assert_eq!(parse_pressure_level("junk"), None);
    }

    #[test]
    fn host_load_serialises_the_new_fields_in_camel_case() {
        let h = HostLoad { load1: 1.0, cpus: 6, swap_used_pct: None, cpu_idle_pct: Some(52.0), mem_pressure: Some(2) };
        let json = serde_json::to_string(&h).unwrap();
        assert!(json.contains("\"cpuIdlePct\":52.0"), "{json}");
        assert!(json.contains("\"memPressure\":2"), "{json}");
    }
}
