import * as React from "react"
import { getBackend } from "@/services"
import type { FilePreview } from "@/engine/files/index"
import { useT } from "@/i18n"

interface Frame { x: number; y: number; w: number; h: number }

/** Plays one animation of a sprite atlas (PNG + JSON) on a canvas, nearest-neighbour, integer-scaled. */
export function AtlasAnimPreview({ root, preview }: { root: string; preview: FilePreview }) {
  const t = useT()
  const anims = React.useMemo(() => Object.keys(preview.anims ?? {}), [preview])
  const [picked, setAnim] = React.useState<string | null>(null)
  // The parent keys this component by preview, so a stale pick only happens when anims change under us: fall back to the first.
  const anim = picked && anims.includes(picked) ? picked : (anims[0] ?? "")
  const [fps, setFps] = React.useState(8)
  const [image, setImage] = React.useState<HTMLImageElement | null>(null)
  const [frames, setFrames] = React.useState<Record<string, Frame>>({})
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    let alive = true
    void (async () => {
      const backend = await getBackend()
      const [blob, json] = await Promise.all([backend.readProjectBlob(root, preview.file), preview.json ? backend.readProjectFile(root, preview.json, 512 * 1024) : Promise.resolve(null)])
      if (!alive || !blob) return
      const img = new Image()
      img.onload = () => alive && setImage(img)
      img.src = `data:${blob.mime};base64,${blob.base64}`
      if (json) {
        try {
          const raw = JSON.parse(json) as { frames?: Array<{ name: string; x: number; y: number; w: number; h: number }> }
          const map: Record<string, Frame> = {}
          for (const f of raw.frames ?? []) map[f.name] = { x: f.x, y: f.y, w: f.w, h: f.h }
          if (alive) setFrames(map)
        } catch {
          /* no frames → whole image */
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [root, preview.file, preview.json])
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    const names = (preview.anims?.[anim] ?? []).filter((n) => frames[n])
    const list: Frame[] = names.length ? names.map((n) => frames[n]) : [{ x: 0, y: 0, w: image.width, h: image.height }]
    const maxW = Math.max(...list.map((f) => f.w))
    const maxH = Math.max(...list.map((f) => f.h))
    const scale = Math.max(1, Math.min(Math.floor(200 / maxH), Math.floor(280 / maxW), 6))
    canvas.width = maxW * scale
    canvas.height = maxH * scale
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    let i = 0
    let last = 0
    let raf = 0
    const tick = (now: number) => {
      if (now - last >= 1000 / fps) {
        last = now
        const f = list[i % list.length]
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, f.x, f.y, f.w, f.h, Math.floor((maxW - f.w) / 2) * scale, (maxH - f.h) * scale, f.w * scale, f.h * scale)
        i += 1
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [image, frames, anim, fps, preview.anims])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-center rounded-sm border border-line bg-ink-0 p-3" style={{ backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.04) 75%), linear-gradient(45deg, rgba(255,255,255,.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.04) 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0, 8px 8px" }}>
        <canvas ref={canvasRef} className="[image-rendering:pixelated]" />
      </div>
      {anims.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {anims.map((a) => (
            <button key={a} type="button" onClick={() => setAnim(a)} className={a === anim ? "rounded-sm border border-text-2 bg-ink-3 px-2 py-0.5 text-[11px] text-text-1" : "rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-3 hover:text-text-1"}>
              {a} <span className="text-text-3">{preview.anims?.[a]?.length ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-[11px] text-text-3">
        {t("files.speed")} <input type="range" min={2} max={24} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-32" /> {fps} fps
      </label>
    </div>
  )
}
