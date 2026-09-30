import * as React from "react"
import { Image as ImageIcon, Music, RefreshCw, Sparkles, Wrench } from "lucide-react"
import { NeonButton } from "@/design-system"
import { cn } from "@/lib/utils"
import type { Blueprint } from "@/domain"
import { modelRef } from "@/domain"
import { CATEGORIES, type FileCategoryId, type FileItem } from "@/engine/files/index"
import { useFilesStore } from "@/stores/files"
import { useBlueprintsStore } from "@/stores/blueprints"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { getBackend } from "@/services"
import { useT } from "@/i18n"
import { AtlasAnimPreview } from "./AtlasAnimPreview"
import { TamirciDialog, type TamirciTarget } from "./TamirciDialog"

interface Menu { x: number; y: number; target: TamirciTarget }

/** Dosyalar: what the wired Build contains, by category, with previews; right-click → Tamirci AI. */
export function FilesTab({ bp }: { bp: Blueprint }) {
  const t = useT()
  const builds = bp.nodes.filter((n) => n.data.type === "build" && n.data.folderPath)
  const [buildId, setBuildId] = React.useState(builds[0]?.id ?? "")
  const build = builds.find((b) => b.id === buildId) ?? builds[0]
  const root = build?.data.type === "build" ? build.data.folderPath : ""
  const folder = useFilesStore((s) => (root ? s.byRoot[root] : undefined))
  const load = useFilesStore((s) => s.load)
  const rebuild = useFilesStore((s) => s.rebuild)
  const classify = useFilesStore((s) => s.classify)
  const running = useBlueprintsStore((s) => s.running)
  const providers = useProvidersStore((s) => s.providers)
  const unavailable = useProvidersStore((s) => s.unavailable)
  const models = React.useMemo(() => selectAvailableModels(providers, unavailable), [providers, unavailable])
  const cheap = models.find((m) => /haiku|kimi|flash|mini|nano/i.test(m.id)) ?? models[0]
  const [selected, setSelected] = React.useState<string | null>(null)
  const [menu, setMenu] = React.useState<Menu | null>(null)
  const [target, setTarget] = React.useState<TamirciTarget | null>(null)
  React.useEffect(() => {
    if (root) void load(root)
  }, [root, load])
  React.useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [])
  const tamirciRunning = bp.nodes.some((n) => n.data.type === "ai" && n.data.tamirci && running[n.id])
  if (!build || !root) return <div className="flex flex-1 items-center justify-center text-sm text-text-3">{t("files.noBuild")}</div>
  const index = folder?.index
  const items = index?.items ?? []
  const current = items.find((i) => i.id === selected) ?? null
  const openMenu = (e: React.MouseEvent, target: TamirciTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs">
          <span className="text-text-3">{t("files.build")}</span>
          <select value={build.id} onChange={(e) => setBuildId(e.target.value)} className="rounded-sm border border-line bg-ink-2 px-2 py-1 text-xs text-text-1">
            {builds.map((b) => <option key={b.id} value={b.id}>{b.data.type === "build" ? b.data.title || b.data.folderPath : b.id}</option>)}
          </select>
          <span className="mono truncate text-[11px] text-text-3" title={root}>{root}</span>
          <div className="ml-auto flex items-center gap-2">
            {folder?.stale && <span className="rounded-sm border border-warn/40 px-2 py-0.5 text-[10px] text-warn">{t("files.stale")}</span>}
            {folder?.error && <span className="text-[11px] text-danger">{folder.error}</span>}
            <NeonButton size="sm" variant="outline" onClick={() => void rebuild(root)} disabled={folder?.loading}><RefreshCw />{t("files.refresh")}</NeonButton>
            <NeonButton size="sm" variant="outline" onClick={() => cheap && void classify(root, modelRef(cheap.providerId, cheap.id))} disabled={!cheap || !index || folder?.classifying} title={cheap ? modelRef(cheap.providerId, cheap.id) : ""}><Sparkles />{folder?.classifying ? t("files.classifying") : t("files.classify")}</NeonButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {folder?.loading && !index && <div className="text-sm text-text-3">{t("files.loading")}</div>}
          {index && items.length === 0 && <div className="text-sm text-text-3">{t("files.empty")}</div>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {CATEGORIES.map((cat) => {
              const list = items.filter((i) => i.category === cat)
              if (!list.length) return null
              return (
                <CategoryCard key={cat} cat={cat} items={list} selected={selected} onSelect={setSelected} onMenu={openMenu} />
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-ink-1 p-3 text-xs">
        {current ? (
          <>
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t(`files.categories.${current.category}` as never)}</div>
              <NeonButton size="sm" variant="outline" onClick={() => setTarget({ files: current.files, label: current.title })}><Wrench />{t("files.tamirci.call")}</NeonButton>
            </div>
            <div className="text-sm text-text-1">{current.title}{current.ai ? <span className="ml-1 text-[10px] text-text-3">AI</span> : null}</div>
            {current.notes && <div className="text-[11px] text-text-2">{current.notes}</div>}
            {current.previews.map((p, i) => (
              <div key={i}>
                {p.kind === "atlas" && <AtlasAnimPreview key={`${p.file}|${p.json ?? ""}`} root={root} preview={p} />}
                {p.kind === "image" && <BlobImage root={root} rel={p.file} />}
                {p.kind === "audio" && <BlobAudio root={root} rel={p.file} />}
              </div>
            ))}
            {!current.previews.length && <div className="text-[11px] text-text-3">{t("files.noPreview")}</div>}
            <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("files.files")}</div>
            <ul className="mono flex flex-col gap-0.5 text-[11px] text-text-2">
              {current.files.map((f) => (
                <li key={f} onContextMenu={(e) => openMenu(e, { files: [f], label: f })} className="cursor-context-menu truncate hover:text-text-1" title={f}>{f}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="text-[11px] text-text-3">{t("files.selectHint")}</div>
        )}
        <div className="mt-auto border-t border-line pt-2">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("files.tamirci.report")}</div>
          {tamirciRunning && <div className="text-[11px] text-text-2">{t("files.tamirci.running")}</div>}
          {folder?.lastFix ? (
            <div className="flex flex-col gap-1">
              <pre className="mono max-h-40 overflow-auto rounded-sm border border-line bg-ink-0 p-2 text-[10px] leading-4 whitespace-pre-wrap text-text-2">{folder.lastFix.report?.trim() || "—"}</pre>
              <div className="text-[10px] text-text-3">{t("files.tamirci.changed")} ({folder.lastFix.changed.length})</div>
              <ul className="mono max-h-24 overflow-auto text-[10px] text-text-2">{folder.lastFix.changed.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ) : (
            !tamirciRunning && <div className="text-[11px] text-text-3">{t("files.tamirci.noReport")}</div>
          )}
        </div>
      </div>
      {menu && (
        <div className="fixed z-50 w-48 rounded-sm border border-line bg-ink-2 p-1 text-xs shadow-xl" style={{ left: menu.x, top: menu.y }}>
          <button type="button" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-text-1 hover:bg-ink-3" onClick={() => { setTarget(menu.target); setMenu(null) }}>
            <Wrench className="size-3 text-text-3" />{t("files.tamirci.call")}
          </button>
        </div>
      )}
      {/* keyed by target so every call starts with fresh problem/file fields */}
      <TamirciDialog key={target ? `${target.label}|${target.files.join(",")}` : "closed"} bp={bp} buildNodeId={build.id} root={root} target={target} onClose={() => setTarget(null)} />
    </div>
  )
}

function CategoryCard({ cat, items, selected, onSelect, onMenu }: { cat: FileCategoryId; items: FileItem[]; selected: string | null; onSelect: (id: string) => void; onMenu: (e: React.MouseEvent, target: TamirciTarget) => void }) {
  const t = useT()
  return (
    <div className="rounded-sm border border-line bg-ink-1 p-3" onContextMenu={(e) => onMenu(e, { files: Array.from(new Set(items.flatMap((i) => i.files))).slice(0, 40), label: t(`files.categories.${cat}` as never) })}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t(`files.categories.${cat}` as never)}</div>
        <span className="text-[10px] text-text-3">{t("files.itemsCount", { n: items.length })}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            onContextMenu={(e) => onMenu(e, { files: item.files, label: item.title })}
            className={cn("flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px]", selected === item.id ? "border-text-2 bg-ink-3 text-text-1" : "border-line text-text-2 hover:text-text-1")}
            title={item.files.join("\n")}
          >
            {item.previews[0]?.kind === "audio" ? <Music className="size-3 text-text-3" /> : item.previews[0] ? <ImageIcon className="size-3 text-text-3" /> : null}
            {item.title}
          </button>
        ))}
      </div>
    </div>
  )
}

function useBlobUrl(root: string, rel: string): string | null {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    let alive = true
    void getBackend().then((b) => b.readProjectBlob(root, rel)).then((blob) => alive && setUrl(blob ? `data:${blob.mime};base64,${blob.base64}` : null)).catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [root, rel])
  return url
}

function BlobImage({ root, rel }: { root: string; rel: string }) {
  const url = useBlobUrl(root, rel)
  return url ? <img src={url} alt={rel} className="max-h-60 w-auto max-w-full rounded-sm border border-line [image-rendering:pixelated]" /> : null
}

function BlobAudio({ root, rel }: { root: string; rel: string }) {
  const url = useBlobUrl(root, rel)
  return url ? <audio controls src={url} className="w-full" /> : null
}
