import { useNavigate } from "react-router"
import { Workflow, BrainCircuit } from "lucide-react"
import { SilentMark } from "@/app/SilentMark"
import { useSettingsStore } from "@/stores/settings"
import { useT } from "@/i18n"

/** First thing on every launch: Maker (today's Silent) or Mind (MindMirror). Sharp cards; Mind is the only orange thing in Silent. */
export function EntryScreen() {
  const t = useT()
  const navigate = useNavigate()
  const update = useSettingsStore((s) => s.update)
  const choose = (mode: "maker" | "mind") => {
    void update({ mode })
    navigate(mode === "mind" ? "/mind" : "/chat")
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <div className="flex items-center gap-3">
        <SilentMark size={34} />
        <div className="font-heading text-lg font-semibold tracking-[0.24em] uppercase">Silent</div>
      </div>
      <div className="text-[11px] tracking-[0.2em] text-text-3 uppercase">{t("mind.entryTitle")}</div>
      <div className="grid w-full max-w-[760px] grid-cols-2 gap-4">
        <button type="button" data-testid="entry-maker" onClick={() => choose("maker")} className="group flex h-56 flex-col items-start justify-between rounded-none border border-text-1 bg-ink-1 p-6 text-left transition-colors hover:bg-text-1 hover:text-black">
          <Workflow className="size-7" />
          <div>
            <div className="font-heading text-2xl font-semibold tracking-[0.18em] uppercase">{t("mind.maker")}</div>
            <div className="mt-1 text-[12px] text-text-3 group-hover:text-black/70">{t("mind.entryMaker")}</div>
          </div>
        </button>
        <button type="button" data-testid="entry-mind" onClick={() => choose("mind")} className="group flex h-56 flex-col items-start justify-between rounded-none border border-mind bg-mind/10 p-6 text-left text-mind transition-colors hover:bg-mind hover:text-black">
          <BrainCircuit className="size-7" />
          <div>
            <div className="font-heading text-2xl font-semibold tracking-[0.18em] uppercase">{t("mind.mind")}</div>
            <div className="mt-1 text-[12px] text-mind-soft group-hover:text-black/70">{t("mind.entryMind")}</div>
          </div>
        </button>
      </div>
    </div>
  )
}
