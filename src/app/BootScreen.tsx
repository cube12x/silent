import { SilentMark } from "./SilentMark"
import { useT } from "@/i18n"

export function BootScreen({ error }: { error?: string }) {
  const t = useT()
  return (
    <div className="grid-bg flex h-screen w-screen items-center justify-center bg-ink-0">
      <div className="flex flex-col items-center gap-4">
        <SilentMark size={64} glow mood="busy" />
        <div className="font-heading text-lg font-semibold tracking-[0.3em] text-text-1 uppercase">Silent</div>
        {error ? (
          <div className="max-w-md rounded-lg border border-danger/40 bg-danger/10 p-3 text-center text-xs text-danger">{error}</div>
        ) : (
          <div className="mono flex items-center gap-2 text-[11px] text-text-3"><span className="size-1.5 animate-pulse-soft rounded-full bg-cyan" />{t("boot.init")}</div>
        )}
      </div>
    </div>
  )
}
