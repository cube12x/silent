import { useNavigate } from "react-router"
import { Bot, Plus } from "lucide-react"
import { useAgentsStore } from "@/stores/agents"
import { useMemoryStore } from "@/stores/memory"
import { useUiStore } from "@/stores/ui"
import { EmptyState, NeonButton, PageHeader, RepoCard } from "@/design-system"

export function RepoAgentsScreen() {
  const agents = useAgentsStore((s) => s.agents)
  const countForScope = useMemoryStore((s) => s.countForScope)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader eyebrow="Repo agents" title="Specialised agents, bound to code." description="Each agent binds a local repository to a model, a Gateway-derived behaviour profile, explicit permissions and its own memory." actions={<NeonButton onClick={() => openNewSession({ kind: "repo-agent" })}><Plus />Create repo agent</NeonButton>} />
      {agents.length === 0 ? (
        <EmptyState icon={<Bot />} title="No repo agents yet" description="Create one to give Silent a persistent, repo-aware specialist." action={<NeonButton onClick={() => openNewSession({ kind: "repo-agent" })}>Create repo agent</NeonButton>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {agents.map((a) => <RepoCard key={a.id} agent={a} memoryCount={countForScope(a.id)} onOpen={() => navigate(`/agents/${a.id}`)} />)}
        </div>
      )}
    </div>
  )
}
