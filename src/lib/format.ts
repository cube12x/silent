export function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return "<$0.01"
  return `$${value.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const s = Math.round(diff / 1000)
  if (s < 5) return "just now"
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

export function shortPath(path: string, keep = 2): string {
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= keep) return path
  return `…/${parts.slice(-keep).join("/")}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
