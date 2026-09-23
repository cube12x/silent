import * as React from "react"
import { cn } from "cn"
import { Brain, Pin, PinOff, Plus, Search, Trash2, Smartphone, FolderGit2, User, Cpu } from "lucide-react"
import { useMemoryStore } from "@/stores/memory"
import { EmptyState, GlowCard, MemoryTag, NeonButton, PageHeader, Stat, TacticalChip } from "@/design-system"
import { MEMORY_LAYERS, MEMORY_LAYER_LABELS, type MemoryLayer } from "@/domain"
import { formatRelative } from "@/lib/format"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const LAYER_ICON: Record<MemoryLayer, React.ReactNode> = { user: <User />, repo: <FolderGit2 />, session: <Cpu />, daily: <Smartphone /> }
const LAYER_DESC: Record<MemoryLayer, string> = {
  user: "Preferences, workflow habits, preferred models.",
  repo: "Architecture facts, codebase rules, decisions, bug history, conventions.",
  session: "Task history, failures, successful outputs, chosen routing.",
  daily: "Notes and reminders from the phone; temporary context snippets.",
}

export function MemoryScreen() {
  const entries = useMemoryStore((s) => s.entries)
  const togglePin = useMemoryStore((s) => s.togglePin)
  const remove = useMemoryStore((s) => s.remove)
  const add = useMemoryStore((s) => s.add)
  const counts = React.useMemo(() => {
    const out: Record<MemoryLayer, number> = { user: 0, repo: 0, session: 0, daily: 0 }
    for (const e of entries) out[e.layer] += 1
    return out
  }, [entries])
  const [layer, setLayer] = React.useState<MemoryLayer | "all">("all")
  const [tag, setTag] = React.useState<string | null>(null)
  const [pinnedOnly, setPinnedOnly] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [adding, setAdding] = React.useState(false)
  const [form, setForm] = React.useState({ layer: "user" as MemoryLayer, title: "", body: "", tags: "" })

  const tags = Array.from(new Set(entries.flatMap((e) => e.tags))).sort()
  const list = entries.filter((e) => (layer === "all" || e.layer === layer) && (!tag || e.tags.includes(tag)) && (!pinnedOnly || e.pinned) && (!q || `${e.title} ${e.body} ${e.scopeLabel ?? ""}`.toLowerCase().includes(q.toLowerCase())))

  const submit = async () => {
    if (!form.title.trim()) return
    await add({ layer: form.layer, title: form.title.trim(), body: form.body.trim(), tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean), source: "manual", pinned: false })
    setAdding(false)
    setForm({ layer: "user", title: "", body: "", tags: "" })
  }

  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader eyebrow="Memory & context" title="Four layers of context." description="Silent keeps what it learns about you, each repository, each session, and what arrives from your phone. Workers receive the relevant slice with every job." actions={<NeonButton onClick={() => setAdding(true)}><Plus />Add memory</NeonButton>} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {MEMORY_LAYERS.map((l) => (
          <button key={l} type="button" onClick={() => setLayer(layer === l ? "all" : l)} className="text-left">
            <Stat label={MEMORY_LAYER_LABELS[l]} value={counts[l]} hint={LAYER_DESC[l]} icon={LAYER_ICON[l]} tone={layer === l ? "cyan" : "default"} className="h-full" />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories…" className="h-8 w-64 border-line bg-ink-2 pl-8 text-xs" />
        </div>
        <button type="button" onClick={() => setPinnedOnly((v) => !v)} className={cn("flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs", pinnedOnly ? "border-cyan/50 text-cyan" : "border-line text-text-2")}><Pin className="size-3" />Pinned</button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" onClick={() => setTag(null)} className={cn("h-7 rounded-md border px-2 text-[11px]", !tag ? "border-cyan/50 text-cyan" : "border-line text-text-3")}>all tags</button>
        {tags.map((t) => (
          <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} className={cn("rounded-md", tag === t && "ring-1 ring-cyan")}><MemoryTag tag={t} /></button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Brain />} title="No memories match" description="Adjust filters or add a memory." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((m) => (
            <GlowCard key={m.id} tone={m.pinned ? "cyan" : "default"} className="group flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <TacticalChip size="xs" tone={m.layer === "user" ? "violet" : m.layer === "repo" ? "cyan" : m.layer === "session" ? "blue" : "success"}>{MEMORY_LAYER_LABELS[m.layer].replace(" Memory", "").replace(" / Phone Context", "")}</TacticalChip>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" onClick={() => void togglePin(m.id)} className="flex size-6 items-center justify-center rounded-md text-text-3 hover:bg-ink-3 hover:text-cyan" aria-label="Pin">{m.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</button>
                  <button type="button" onClick={() => void remove(m.id)} className="flex size-6 items-center justify-center rounded-md text-text-3 hover:bg-danger/10 hover:text-danger" aria-label="Delete"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
              <div className="font-heading text-sm font-semibold">{m.title}</div>
              <p className="line-clamp-4 text-xs text-text-2">{m.body}</p>
              <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                {m.tags.map((t) => <MemoryTag key={t} tag={t} layer={m.layer} />)}
                <span className="ml-auto text-[10px] text-text-3">{m.scopeLabel ? `${m.scopeLabel} · ` : ""}{formatRelative(m.createdAt)}</span>
              </div>
              <div className="mono truncate text-[10px] text-text-3/70">src: {m.source}</div>
            </GlowCard>
          ))}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="border-line bg-ink-1">
          <DialogHeader><DialogTitle className="font-heading">Add memory</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-1.5">{MEMORY_LAYERS.map((l) => <button key={l} type="button" onClick={() => setForm((f) => ({ ...f, layer: l }))} className={cn("h-7 rounded-md border px-2 text-[11px]", form.layer === l ? "border-cyan/50 text-cyan" : "border-line text-text-2")}>{MEMORY_LAYER_LABELS[l]}</button>)}</div>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" className="border-line bg-ink-2" />
            <Textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="What should Silent remember?" rows={4} className="border-line bg-ink-2" />
            <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="tags, comma separated" className="border-line bg-ink-2" />
            <div className="flex justify-end gap-2"><NeonButton variant="ghost" onClick={() => setAdding(false)}>Cancel</NeonButton><NeonButton onClick={submit} disabled={!form.title.trim()}>Save</NeonButton></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
