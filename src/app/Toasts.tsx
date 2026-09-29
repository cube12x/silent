import { useNavigate } from "react-router"
import { X } from "lucide-react"
import { cn } from "cn"
import { useNotifyStore } from "@/stores/notify"

/** Bottom-right stack of global notifications (see stores/notify). */
export function Toasts() {
  const toasts = useNotifyStore((s) => s.toasts)
  const dismiss = useNotifyStore((s) => s.dismiss)
  const navigate = useNavigate()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(420px,90vw)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cn("pointer-events-auto flex items-start gap-2 rounded-md border bg-ink-1 px-3 py-2 text-xs shadow-lg", t.kind === "error" ? "border-danger/50 text-danger" : "border-line text-text-1")}>
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          {t.action && <button type="button" className="shrink-0 underline" onClick={() => { dismiss(t.id); navigate(t.action!.to) }}>{t.action.label}</button>}
          <button type="button" aria-label="close" className="shrink-0 text-text-3 hover:text-text-1" onClick={() => dismiss(t.id)}><X className="size-3" /></button>
        </div>
      ))}
    </div>
  )
}
