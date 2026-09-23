import * as React from "react"
import { cn } from "cn"
import { Cpu, Database, FolderSearch, Palette, RefreshCw, Route, ScrollText, Shield, ShieldCheck, Terminal, Wallet, Brain, KeyRound } from "lucide-react"
import { useSettingsStore } from "@/stores/settings"
import { useProvidersStore } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { useMemoryStore } from "@/stores/memory"
import { GlowCard, KeyValueList, ModelTag, NeonButton, PageHeader, PermissionToggle, ProviderLogo, SectionHeader, TacticalChip } from "@/design-system"
import { COST_MODES, COST_MODE_LABELS, PERMISSION_LABELS, SUBTASK_KINDS, type PermissionKey } from "@/domain"
import { MODELS } from "@/engine/capabilities"
import { KIND_LABEL } from "@/design-system"
import { formatRelative } from "@/lib/format"

const SECTIONS = [
  { id: "connectors", label: "Model connectors", icon: <Cpu /> },
  { id: "cli", label: "CLI integrations", icon: <Terminal /> },
  { id: "routing", label: "Routing defaults", icon: <Route /> },
  { id: "cost", label: "Cost mode", icon: <Wallet /> },
  { id: "theme", label: "Theme", icon: <Palette /> },
  { id: "security", label: "Security", icon: <Shield /> },
  { id: "permissions", label: "Permissions", icon: <ShieldCheck /> },
  { id: "memory", label: "Memory controls", icon: <Brain /> },
  { id: "index", label: "Repo index", icon: <FolderSearch /> },
  { id: "logs", label: "Logs", icon: <ScrollText /> },
]

function Select<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cn("h-8 rounded-md border border-line bg-ink-2 px-2 text-xs text-text-1 outline-none focus:border-cyan/50", className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function SettingsScreen() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const providers = useProvidersStore((s) => s.providers)
  const detected = useProvidersStore((s) => s.detected)
  const detecting = useProvidersStore((s) => s.detecting)
  const lastDetectedAt = useProvidersStore((s) => s.lastDetectedAt)
  const detect = useProvidersStore((s) => s.detect)
  const setEnabled = useProvidersStore((s) => s.setEnabled)
  const runs = useRunsStore((s) => s.runs)
  const memoryCount = useMemoryStore((s) => s.entries.length)
  const [section, setSection] = React.useState("connectors")
  const modelOptions = MODELS.map((m) => ({ value: m.id, label: m.displayName }))
  const codex = providers.find((p) => p.id === "codex")!
  const codexDetected = detected.find((d) => d.id === "codex")

  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader eyebrow="Settings" title="Model management & infrastructure." description="Connect CLIs and providers, set routing defaults, choose a cost strategy and lock down what agents may do." />
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-0.5 lg:sticky lg:top-6 lg:self-start">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors [&_svg]:size-4", section === s.id ? "bg-cyan/[0.08] text-text-1 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--cyan)_30%,transparent)] [&_svg]:text-cyan" : "text-text-2 hover:bg-ink-3/60 [&_svg]:text-text-3")}>
              {s.icon}{s.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          {section === "connectors" && (
            <>
              <GlowCard tone="cyan" className="flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <ProviderLogo provider="codex" size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-heading text-base font-semibold">Codex CLI <TacticalChip size="xs" tone="cyan">core infrastructure</TacticalChip> <TacticalChip size="xs" tone={codex.status === "connected" ? "success" : codex.status === "disabled" ? "neutral" : "danger"} dot>{codex.status}</TacticalChip></div>
                    <p className="mt-1 text-xs text-text-2">{codex.description}</p>
                  </div>
                  <NeonButton variant="outline" size="sm" onClick={() => void detect()} disabled={detecting}><RefreshCw className={cn(detecting && "animate-spin")} />Run doctor</NeonButton>
                </div>
                <KeyValueList columns={2} items={[{ label: "Binary", value: codexDetected?.path ?? "not found on PATH", mono: true }, { label: "Version", value: codexDetected?.version ?? "—", mono: true }, { label: "Invocation", value: "codex -a never -s <sandbox> [-C repo] exec --json", mono: true }, { label: "Sandbox cap", value: "workspace-write (danger-full-access disabled)", mono: true }, { label: "Streaming", value: "JSONL → Tauri Channel → RuntimeEvent", mono: true }, { label: "Checked", value: lastDetectedAt ? formatRelative(lastDetectedAt) : "never" }]} />
                <PermissionToggle label="Enable Codex" description="When disabled, Codex-routed subtasks fall back to other models." checked={codex.enabled} onCheckedChange={(v) => void setEnabled("codex", v)} />
              </GlowCard>
              <GlowCard className="flex flex-col gap-3">
                <SectionHeader eyebrow="Providers" title="Installed model connectors" description="Non-Codex providers are simulated in this build: they produce realistic event streams so routing, monitoring and fallback can be exercised end-to-end." />
                <div className="grid gap-2 md:grid-cols-2">
                  {providers.filter((p) => p.id !== "codex").map((p) => {
                    const d = detected.find((x) => x.id === p.id)
                    return (
                      <div key={p.id} className="flex items-center gap-3 rounded-lg border border-line bg-ink-2/50 px-3 py-2.5">
                        <ProviderLogo provider={p.id} size={14} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium">{p.name}<TacticalChip size="xs">{p.kind}</TacticalChip></div>
                          <div className="mono truncate text-[10px] text-text-3">{d?.installed ? `${d.version} · ${d.path}` : p.cliBinary ? `${p.cliBinary}: not installed` : "API key not configured"}</div>
                        </div>
                        <TacticalChip size="xs" tone={p.status === "simulated" ? "violet" : p.status === "connected" ? "success" : "neutral"} dot>{p.status}</TacticalChip>
                        <PermissionToggle label="" checked={p.enabled} onCheckedChange={(v) => void setEnabled(p.id, v)} className="border-0 bg-transparent p-0 hover:border-0" />
                      </div>
                    )
                  })}
                </div>
              </GlowCard>
            </>
          )}

          {section === "cli" && (
            <GlowCard className="flex flex-col gap-4">
              <SectionHeader eyebrow="CLI integrations" title="Terminal-driven execution" description="Silent runs AI tools as child processes with piped stdout/stderr, bounded buffers, timeouts and process-group kill." />
              <div className="grid gap-3 md:grid-cols-3">
                {detected.length ? detected.map((d) => (
                  <div key={d.id} className={cn("rounded-lg border p-3", d.installed ? "border-success/30" : "border-line")}>
                    <div className="mono flex items-center gap-2 text-sm">{d.binary}<TacticalChip size="xs" tone={d.installed ? "success" : "neutral"}>{d.installed ? "found" : "missing"}</TacticalChip></div>
                    <div className="mono mt-1 truncate text-[10px] text-text-3">{d.installed ? `${d.version ?? ""} ${d.path ?? ""}` : d.error ?? "not on PATH"}</div>
                    <div className="mt-2 text-[11px] text-text-2">{d.id === "codex" ? "Executes for real: chat turns, ephemeral subtasks, `exec review`." : "Detected but not wired for execution yet — runs simulated."}</div>
                  </div>
                )) : <div className="text-xs text-text-3">Run the doctor from Model connectors.</div>}
              </div>
              <KeyValueList items={[{ label: "Approval policy", value: "-a never (non-interactive)", mono: true }, { label: "Redaction", value: "sk-, ghp_, github_pat_, AKIA, Bearer, AIza", mono: true }, { label: "Line cap", value: "4 MiB per line · 5000 lines kept per subtask", mono: true }, { label: "Timeout", value: "10 min per exec, SIGTERM → SIGKILL after 3 s", mono: true }]} />
            </GlowCard>
          )}

          {section === "routing" && (
            <GlowCard className="flex flex-col gap-4">
              <SectionHeader eyebrow="Routing" title="Default primary & fallback" description="Used for new chats and as an affinity bonus in Silent Code routing." />
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5"><span className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Default primary</span><Select value={settings.defaultPrimaryModelId} options={modelOptions} onChange={(v) => void update({ defaultPrimaryModelId: v })} /><ModelTag modelId={settings.defaultPrimaryModelId} size="xs" /></label>
                <label className="flex flex-col gap-1.5"><span className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Default fallback</span><Select value={settings.defaultFallbackModelId} options={modelOptions} onChange={(v) => void update({ defaultFallbackModelId: v })} /><ModelTag modelId={settings.defaultFallbackModelId} size="xs" /></label>
              </div>
              <div>
                <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Per-kind overrides (pin a model for a subtask kind)</div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {SUBTASK_KINDS.map((k) => (
                    <label key={k} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">
                      {KIND_LABEL[k]}
                      <Select value={settings.routingOverrides[k] ?? ""} options={[{ value: "", label: "auto" }, ...modelOptions]} onChange={(v) => void update((s) => ({ ...s, routingOverrides: { ...s.routingOverrides, [k]: v || undefined } }))} className="w-32" />
                    </label>
                  ))}
                </div>
              </div>
            </GlowCard>
          )}

          {section === "cost" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow="Cost strategy" title="Cost mode" description="Weights capability vs. price vs. locality in the router." />
              <div className="grid gap-2 md:grid-cols-2">
                {COST_MODES.map((c) => (
                  <button key={c} type="button" onClick={() => void update({ costMode: c })} className={cn("flex flex-col gap-1 rounded-lg border p-3 text-left", settings.costMode === c ? "border-violet/50 bg-violet/[0.08]" : "border-line hover:border-line-strong")}>
                    <span className="text-sm font-medium">{COST_MODE_LABELS[c]}</span>
                    <span className="text-[11px] text-text-3">{{ economy: "Cheapest capable model wins; frontier tiers avoided.", balanced: "Capability first, price second.", "max-quality": "Best capability regardless of price.", "local-first": "Prefer local/free models; cloud only when needed.", "zero-api": "Only free/local models. Paid providers are never called." }[c]}</span>
                  </button>
                ))}
              </div>
            </GlowCard>
          )}

          {section === "theme" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow="Theme" title="Appearance" description="Silent is dark-only by design." />
              <div className="grid gap-2 md:grid-cols-2">
                {(["obsidian", "graphite"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => void update({ theme: t })} className={cn("flex items-center gap-3 rounded-lg border p-3 text-left", settings.theme === t ? "border-cyan/50" : "border-line")}>
                    <span className={cn("size-8 rounded-md border border-line", t === "obsidian" ? "bg-[#050607]" : "bg-[#0b0c0e]")} />
                    <span><span className="block text-sm font-medium capitalize">{t}</span><span className="block text-[11px] text-text-3">{t === "obsidian" ? "Deep black, electric cyan" : "Softer graphite, sky accent"}</span></span>
                  </button>
                ))}
              </div>
              <PermissionToggle label="Reduce motion" description="Disable shimmer, pulse and panel transitions" checked={settings.reducedMotion} onCheckedChange={(v) => void update({ reducedMotion: v })} />
            </GlowCard>
          )}

          {section === "security" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow="Security" title="Execution safety" />
              <PermissionToggle label="Allow danger-full-access sandbox" description="Permanently disabled in v1. Codex never runs outside workspace-write." checked={false} locked danger />
              <PermissionToggle label="Redact secrets in terminal output" description="Masks API keys and tokens before they reach the UI or the database" checked={settings.security.redactSecrets} onCheckedChange={(v) => void update((s) => ({ ...s, security: { ...s.security, redactSecrets: v } }))} />
              <PermissionToggle label="Require approval for git push" description="Even when an agent has git push, Silent asks first" checked={settings.security.requireApprovalForGitPush} onCheckedChange={(v) => void update((s) => ({ ...s, security: { ...s.security, requireApprovalForGitPush: v } }))} />
              <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-xs text-text-2"><KeyRound className="size-3.5 text-text-3" />Credentials: Codex uses its own login (<span className="mono">codex login</span>). API keys for other providers are not stored in v1; a SecureStore seam exists for the OS keychain.</div>
            </GlowCard>
          )}

          {section === "permissions" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow="Permissions" title="Defaults for new repo agents" description="Gateway prompts refine these; git push can never be enabled by a prompt." />
              <div className="grid gap-2 md:grid-cols-2">
                {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map((k) => (
                  <PermissionToggle key={k} label={PERMISSION_LABELS[k]} checked={settings.defaultPermissions[k]} danger={k === "gitPush" || k === "network"} onCheckedChange={(v) => void update((s) => ({ ...s, defaultPermissions: { ...s.defaultPermissions, [k]: v } }))} />
                ))}
              </div>
            </GlowCard>
          )}

          {section === "memory" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow="Memory" title="Memory controls" description={`${memoryCount} entries stored locally in SQLite.`} />
              <PermissionToggle label="Auto-capture session memory" description="Record routing outcomes, failures and summaries per run" checked={settings.memory.autoCaptureSession} onCheckedChange={(v) => void update((s) => ({ ...s, memory: { ...s.memory, autoCaptureSession: v } }))} />
              <PermissionToggle label="Auto-capture repo memory" description="Let review workers write architecture facts and conventions" checked={settings.memory.autoCaptureRepo} onCheckedChange={(v) => void update((s) => ({ ...s, memory: { ...s.memory, autoCaptureRepo: v } }))} />
              <label className="flex items-center justify-between rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">Retention (days)<input type="number" min={7} max={3650} value={settings.memory.retentionDays} onChange={(e) => void update((s) => ({ ...s, memory: { ...s.memory, retentionDays: Number(e.target.value) } }))} className="mono h-7 w-20 rounded-md border border-line bg-ink-2 px-2 text-xs" /></label>
            </GlowCard>
          )}

          {section === "index" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow="Repo index" title="Repository indexing" description="Planned: local embeddings so workers get semantic context. Disabled in v1." />
              <PermissionToggle label="Enable repo index" checked={settings.repoIndex.enabled} onCheckedChange={(v) => void update((s) => ({ ...s, repoIndex: { ...s.repoIndex, enabled: v } }))} />
              <KeyValueList items={[{ label: "Max files", value: settings.repoIndex.maxFiles, mono: true }, { label: "Ignore", value: settings.repoIndex.ignoreGlobs.join(", "), mono: true }]} />
            </GlowCard>
          )}

          {section === "logs" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow="Logs" title="Diagnostics" />
              <label className="flex items-center justify-between rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">Log level<Select value={settings.logs.level} options={[{ value: "error", label: "error" }, { value: "warn", label: "warn" }, { value: "info", label: "info" }, { value: "debug", label: "debug" }]} onChange={(v) => void update((s) => ({ ...s, logs: { ...s.logs, level: v } }))} /></label>
              <label className="flex items-center justify-between rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">Terminal lines kept per subtask<input type="number" value={settings.logs.keepTerminalLines} onChange={(e) => void update((s) => ({ ...s, logs: { ...s.logs, keepTerminalLines: Number(e.target.value) } }))} className="mono h-7 w-24 rounded-md border border-line bg-ink-2 px-2 text-xs" /></label>
              <KeyValueList items={[{ label: "Runs stored", value: runs.length }, { label: "Database", value: "sqlite:silent.db (app data dir)", mono: true }, { label: "Settings", value: "settings.json (tauri-plugin-store)", mono: true }]} />
              <div className="flex items-center gap-2 text-xs text-text-3"><Database className="size-3.5" />Logs are written by tauri-plugin-log to the platform log directory.</div>
            </GlowCard>
          )}
        </div>
      </div>
    </div>
  )
}
