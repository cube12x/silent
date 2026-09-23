import * as React from "react"
import { cn } from "cn"
import { Bell, QrCode, Radio, Send, Smartphone, Wifi, WifiOff, Zap, Activity, ShieldCheck } from "lucide-react"
import { usePhoneStore } from "@/stores/phone"
import { useRunsStore } from "@/stores/runs"
import { GlowCard, KeyValueList, NeonButton, PageHeader, PermissionToggle, RunStatusBadge, SectionHeader, TacticalChip, ProgressBar } from "@/design-system"
import { formatRelative } from "@/lib/format"

/** Deterministic pseudo-QR: a visual placeholder for the pairing payload. */
function FakeQr({ seed }: { seed: string }) {
  const n = 21
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const cells: boolean[] = []
  for (let i = 0; i < n * n; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5
    cells.push((h >>> 0) % 3 === 0)
  }
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="size-44 rounded-lg bg-text-1 p-2" shapeRendering="crispEdges">
      {cells.map((on, i) => {
        const x = i % n
        const y = Math.floor(i / n)
        const f = finder(x, y)
        const fx = x % (n - 7) < 7 ? x % (n - 7) : x
        const fy = y % (n - 7) < 7 ? y % (n - 7) : y
        const ring = f && (fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4))
        return (f ? ring : on) ? <rect key={i} x={x} y={y} width={1} height={1} fill="#050607" /> : null
      })}
    </svg>
  )
}

export function PhoneLinkScreen() {
  const phone = usePhoneStore()
  const runs = useRunsStore((s) => s.runs)
  const [now, setNow] = React.useState(() => Date.now())
  const cancelPairing = phone.cancelPairing
  const expiresAt = phone.pairingExpiresAt
  React.useEffect(() => {
    if (phone.status !== "pairing") return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (expiresAt && n >= expiresAt) cancelPairing()
    }, 1000)
    return () => clearInterval(t)
  }, [phone.status, expiresAt, cancelPairing])
  const remaining = expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0
  const connected = phone.status === "connected"

  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader eyebrow="Phone link · mobile bridge" title="Command Silent from your pocket." description="With the Silent APK installed and this PC open, the phone connects to this desktop instance over the LAN. Send prompts, launch Silent Code, watch models work, get completion notifications." actions={<TacticalChip tone={connected ? "success" : phone.status === "pairing" ? "warn" : "neutral"} dot pulse={phone.status === "pairing"}>{connected ? "connected" : phone.status}</TacticalChip>} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-6">
          <GlowCard tone={connected ? "success" : phone.status === "pairing" ? "cyan" : "default"} className="flex flex-col items-center gap-4 text-center">
            <div className={cn("flex size-14 items-center justify-center rounded-2xl border", connected ? "border-success/50 text-success" : "border-line text-text-2")}>{connected ? <Wifi className="size-6" /> : <WifiOff className="size-6" />}</div>
            <div>
              <div className="font-heading text-base font-semibold">{connected ? `${phone.devices[0]?.name} linked` : phone.status === "pairing" ? "Scan with the Silent app" : "No phone connected"}</div>
              <div className="text-xs text-text-3">{connected ? "Encrypted LAN session · remote prompts enabled" : phone.status === "pairing" ? `Code expires in ${remaining}s` : "Start pairing to show a QR code and one-time code."}</div>
            </div>
            {phone.status === "pairing" && (
              <>
                <FakeQr seed={phone.pairingCode ?? "silent"} />
                <div className="mono text-2xl tracking-[0.3em] text-cyan text-glow">{phone.pairingCode}</div>
                <div className="flex gap-2">
                  <NeonButton variant="outline" onClick={phone.cancelPairing}>Cancel</NeonButton>
                  <NeonButton onClick={phone.simulatePaired}><Smartphone />Simulate phone scan</NeonButton>
                </div>
              </>
            )}
            {phone.status === "disconnected" && <NeonButton onClick={phone.startPairing}><QrCode />Start pairing</NeonButton>}
            {connected && <NeonButton variant="outline" onClick={phone.disconnect}>Disconnect</NeonButton>}
          </GlowCard>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Devices" title="Paired devices" />
            {phone.devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line bg-ink-2/60 px-3 py-2">
                <Smartphone className="size-4 text-text-2" />
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{d.name}</div><div className="text-[11px] text-text-3">{d.platform} · last seen {formatRelative(d.lastSeen)}</div></div>
                <TacticalChip size="xs" tone={d.trusted ? "success" : "warn"}><ShieldCheck className="size-3" />{d.trusted ? "trusted" : "untrusted"}</TacticalChip>
              </div>
            ))}
            <PermissionToggle label="Completion notifications" description="Push a notification to the phone when a run finishes or blocks" checked={phone.notificationsEnabled} onCheckedChange={phone.setNotifications} />
          </GlowCard>
        </div>

        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { icon: <Send />, title: "Remote prompt", desc: "Type on the phone, execute on the PC. Prompts land in a chat or in Silent Code." },
              { icon: <Zap />, title: "Launch Silent Code", desc: "Pick a repo agent and a model pool from the phone; the desktop orchestrates." },
              { icon: <Activity />, title: "Session monitor", desc: "Per-model status cards and progress, mirrored live over the bridge." },
            ].map((c) => (
              <GlowCard key={c.title} className="flex flex-col gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg border border-line bg-ink-2 text-cyan [&_svg]:size-4">{c.icon}</span>
                <div className="font-heading text-sm font-semibold">{c.title}</div>
                <div className="text-xs text-text-2">{c.desc}</div>
              </GlowCard>
            ))}
          </div>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Remote monitor" title="Sessions visible to the phone" description="Mirrors the desktop run list; the phone receives the same status stream." />
            <ul className="flex flex-col gap-2">
              {runs.slice(0, 4).map((r) => {
                const pct = r.plan.length ? Math.round(r.plan.reduce((n, s) => n + s.progress, 0) / r.plan.length) : 0
                return (
                  <li key={r.id} className="rounded-lg border border-line bg-ink-2/60 px-3 py-2">
                    <div className="flex items-center gap-2"><Radio className={cn("size-3.5", r.status === "running" ? "animate-pulse-soft text-cyan" : "text-text-3")} /><span className="min-w-0 flex-1 truncate text-sm">{r.title}</span><RunStatusBadge status={r.status} size="xs" /></div>
                    <ProgressBar value={pct} active={r.status === "running"} className="mt-2" size="sm" />
                  </li>
                )
              })}
            </ul>
          </GlowCard>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Bridge" title="Recent remote events" />
            <ul className="flex flex-col divide-y divide-line">
              {phone.recentEvents.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2">
                  <span className="flex size-6 items-center justify-center rounded-md border border-line bg-ink-2 text-text-2 [&_svg]:size-3">{e.kind === "prompt" ? <Send /> : e.kind === "launch" ? <Zap /> : e.kind === "notification" ? <Bell /> : <Radio />}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm">{e.title}</div>{e.detail && <div className="truncate text-[11px] text-text-3">{e.detail}</div>}</div>
                  <span className="mono text-[10px] text-text-3">{formatRelative(e.at)}</span>
                </li>
              ))}
            </ul>
          </GlowCard>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Architecture" title="How the bridge will work" />
            <KeyValueList items={[{ label: "Transport", value: "WebSocket over LAN, mTLS after pairing", mono: true }, { label: "Pairing", value: "QR + one-time code, 120 s TTL", mono: true }, { label: "Desktop hook", value: "src-tauri/src/bridge.rs (trait, no-op in v1)", mono: true }, { label: "Event stream", value: "same RunEvent bus the UI consumes", mono: true }]} />
          </GlowCard>
        </div>
      </div>
    </div>
  )
}
