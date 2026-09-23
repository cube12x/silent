import { useNavigate } from "react-router"
import { Bot, Plus } from "lucide-react"
import { useAgentsStore } from "@/stores/agents"
import { useMemoryStore } from "@/stores/memory"
import { useUiStore } from "@/stores/ui"
import { EmptyState, NeonButton, PageHeader, RepoCard } from "@/design-system"
import { useT } from "@/i18n"

export function AgentsScreen() {
  const t = useT()
  const agents = useAgentsStore((s) => s.agents)
  const memory = useMemoryStore((s) => s.entries)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6 p-6">
      <PageHeader eyebrow={t("agents.title")} title={t("agents.subtitle")} description={t("agents.description")} actions={<NeonButton onClick={() => openNewSession({ kind: "repo-agent" })}><Plus />{t("agents.create")}</NeonButton>} />
      {agents.length === 0 ? (
        <EmptyState icon={<Bot />} title={t("agents.empty")} description={t("agents.emptyHint")} action={<NeonButton onClick={() => openNewSession({ kind: "repo-agent" })}>{t("agents.create")}</NeonButton>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {agents.map((a) => <RepoCard key={a.id} agent={a} memoryCount={memory.filter((m) => m.scopeId === a.id).length} statusLabel={t(`agents.status.${a.status}` as const)} onOpen={() => navigate(`/agents/${a.id}`)} />)}
        </div>
      )}
    </div>
  )
}
