import * as React from "react"
import { cn } from "cn"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { TerminalLine } from "@/domain"

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

function fmtTime(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
}

/** Virtualized, monospace log view. Follows output while the user is at the bottom. */
export function TerminalView({ lines, className, live, emptyText = "No output yet." }: { lines: TerminalLine[]; className?: string; live?: boolean; emptyText?: string }) {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const [follow, setFollow] = React.useState(true)
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({ count: lines.length, getScrollElement: () => parentRef.current, estimateSize: () => 20, overscan: 20 })

  React.useEffect(() => {
    if (follow && lines.length) virtualizer.scrollToIndex(lines.length - 1, { align: "end" })
  }, [lines.length, follow, virtualizer])

  const onScroll = () => {
    const el = parentRef.current
    if (!el) return
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  return (
    <div className={cn("relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-ink-0", className)}>
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-line bg-ink-1 px-3">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-danger/70" />
          <span className="size-2 rounded-full bg-warn/70" />
          <span className="size-2 rounded-full bg-success/70" />
          <span className="mono ml-2 text-[10px] text-text-3">stdout · stderr</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-3">
          {live && <span className="flex items-center gap-1 text-cyan"><span className="size-1.5 animate-pulse-soft rounded-full bg-cyan" />live</span>}
          <span className="mono">{lines.length} lines</span>
          {!follow && (
            <button type="button" className="rounded border border-line px-1.5 py-0.5 hover:border-cyan/50 hover:text-cyan" onClick={() => { setFollow(true); virtualizer.scrollToIndex(lines.length - 1, { align: "end" }) }}>
              follow
            </button>
          )}
        </div>
      </div>
      <div ref={parentRef} onScroll={onScroll} className="mono min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px] leading-5">
        {lines.length === 0 ? (
          <div className="py-6 text-center text-text-3">{emptyText}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const l = lines[v.index]
              return (
                <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="absolute top-0 left-0 flex w-full gap-3 whitespace-pre-wrap" style={{ transform: `translateY(${v.start}px)` }}>
                  <span className="shrink-0 select-none text-text-3/70">{fmtTime(l.ts)}</span>
                  <span className={cn("min-w-0 break-words", l.stream === "stderr" ? "text-danger" : l.stream === "system" ? "text-cyan/80 italic" : l.text.startsWith("$ ") ? "text-text-1" : "text-text-2")}>{l.text.replace(ANSI, "")}</span>
                </div>
              )
            })}
          </div>
        )}
        {live && <div className="mt-1 flex items-center gap-1 text-cyan"><span>›</span><span className="inline-block h-3.5 w-1.5 animate-blink bg-cyan" /></div>}
      </div>
    </div>
  )
}
