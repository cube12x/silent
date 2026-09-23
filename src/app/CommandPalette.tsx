import { useNavigate } from "react-router"
import { Bot, Brain, Cpu, LayoutDashboard, MessageSquare, Plus, Settings2, Smartphone, Zap, Activity } from "lucide-react"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command"
import { useUiStore } from "@/stores/ui"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { useRunsStore } from "@/stores/runs"

export function CommandPalette() {
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
    <CommandDialog open={open} onOpenChange={setOpen} title="Search Silent" description="Jump to chats, agents, sessions and commands" className="border-line bg-ink-1">
      <CommandInput placeholder="Search chats, agents, sessions, commands…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { setOpen(false); openNewSession({ kind: "standard" }) }}><Plus />New chat<CommandShortcut>⌘N</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => { setOpen(false); openNewSession({ kind: "repo-agent" }) }}><Bot />Create repo agent</CommandItem>
          <CommandItem onSelect={() => go("/silent-code")}><Zap />Launch Silent Code</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/")}><LayoutDashboard />Dashboard</CommandItem>
          <CommandItem onSelect={() => go("/runs")}><Activity />Live Monitor</CommandItem>
          <CommandItem onSelect={() => go("/agents")}><Bot />Repo Agents</CommandItem>
          <CommandItem onSelect={() => go("/memory")}><Brain />Memory & Context</CommandItem>
          <CommandItem onSelect={() => go("/phone")}><Smartphone />Phone Link</CommandItem>
          <CommandItem onSelect={() => go("/settings")}><Settings2 />Settings</CommandItem>
        </CommandGroup>
        {chats.length > 0 && (
          <CommandGroup heading="Chats">
            {chats.slice(0, 8).map((c) => (
              <CommandItem key={c.id} value={`chat ${c.title}`} onSelect={() => go(`/chat/${c.id}`)}><MessageSquare />{c.title}</CommandItem>
            ))}
          </CommandGroup>
        )}
        {agents.length > 0 && (
          <CommandGroup heading="Repo agents">
            {agents.map((a) => (
              <CommandItem key={a.id} value={`agent ${a.name}`} onSelect={() => go(`/agents/${a.id}`)}><Bot />{a.name}</CommandItem>
            ))}
          </CommandGroup>
        )}
        {runs.length > 0 && (
          <CommandGroup heading="Sessions">
            {runs.slice(0, 8).map((r) => (
              <CommandItem key={r.id} value={`run ${r.title}`} onSelect={() => go(`/runs/${r.id}`)}><Cpu />{r.title}</CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
