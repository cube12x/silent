import { useNavigate } from "react-router"
import { Bot, Cpu, MessageSquare, Plus, Settings2, Zap } from "lucide-react"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command"
import { useUiStore } from "@/stores/ui"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { useRunsStore } from "@/stores/runs"
import { useT } from "@/i18n"
import { shortcut } from "@/lib/platform"

export function CommandPalette() {
  const t = useT()
  const open = useUiStore((s) => s.paletteOpen)
  const setOpen = useUiStore((s) => s.setPalette)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const chats = useChatsStore((s) => s.chats)
  const agents = useAgentsStore((s) => s.agents)
  const runs = useRunsStore((s) => s.runs)
  const navigate = useNavigate()
  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("nav.search")} description="" className="border-line bg-ink-1">
      <CommandInput placeholder={`${t("nav.search")}…`} />
      <CommandList>
        <CommandEmpty>—</CommandEmpty>
        <CommandGroup heading={t("common.create")}>
          <CommandItem onSelect={() => { setOpen(false); openNewSession({ kind: "standard" }) }}><Plus />{t("nav.newChat")}<CommandShortcut>{shortcut("N")}</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => { setOpen(false); openNewSession({ kind: "repo-agent" }) }}><Bot />{t("agents.create")}</CommandItem>
          <CommandItem onSelect={() => go("/code")}><Zap />{t("code.newRun")}</CommandItem>
          <CommandItem onSelect={() => go("/settings")}><Settings2 />{t("nav.settings")}</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        {chats.length > 0 && <CommandGroup heading={t("nav.chats")}>{chats.slice(0, 8).map((c) => <CommandItem key={c.id} value={`chat ${c.title}`} onSelect={() => go(`/chat/${c.id}`)}><MessageSquare />{c.title}</CommandItem>)}</CommandGroup>}
        {agents.length > 0 && <CommandGroup heading={t("nav.agents")}>{agents.map((a) => <CommandItem key={a.id} value={`agent ${a.name}`} onSelect={() => go(`/agents/${a.id}`)}><Bot />{a.name}</CommandItem>)}</CommandGroup>}
        {runs.length > 0 && <CommandGroup heading={t("nav.silentCode")}>{runs.slice(0, 8).map((r) => <CommandItem key={r.id} value={`run ${r.title}`} onSelect={() => go(`/code/${r.id}`)}><Cpu />{r.title}</CommandItem>)}</CommandGroup>}
      </CommandList>
    </CommandDialog>
  )
}
