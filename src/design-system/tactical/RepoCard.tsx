import { cn } from "cn"
import { FolderGit2, GitBranch, Brain, ShieldCheck } from "lucide-react"
import type { RepoAgent } from "@/domain"
import { GlowCard } from "./GlowCard"
import { ModelLogo, ModelTag } from "./ModelLogo"
import { TacticalChip } from "./TacticalChip"
import { shortPath, formatRelative } from "@/lib/format"

const STATUS_TONE: Record<RepoAgent["status"], "neutral" | "cyan" | "warn" | "danger"> = { idle: "neutral", working: "cyan", blocked: "warn", error: "danger" }

export function RepoCard({ agent, onOpen, className, memoryCount }: { agent: RepoAgent; onOpen?: () => void; className?: string; memoryCount?: number }) {
  const perms = Object.entries(agent.permissions).filter(([, v]) => v).length
  return (
    <GlowCard interactive onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen?.()} className={cn("flex flex-col gap-3", className)} active={agent.status === "working"}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ModelLogo modelId={agent.primaryModelId} size={18} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-heading text-sm font-semibold text-text-1">{agent.name}</div>
            <div className="mono flex items-center gap-1 truncate text-[11px] text-text-3"><FolderGit2 className="size-3" />{shortPath(agent.repoPath, 2)}</div>
          </div>
        </div>
        <TacticalChip tone={STATUS_TONE[agent.status]} dot pulse={agent.status === "working"} size="xs">{agent.status}</TacticalChip>
      </div>
      <p className="line-clamp-2 text-xs text-text-2">{agent.gatewayProfile.summary}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-3">
        <ModelTag modelId={agent.primaryModelId} size="xs" />
        <span className="flex items-center gap-1"><GitBranch className="size-3" />{agent.fallbackModelIds.length} fallback</span>
        <span className="flex items-center gap-1"><Brain className="size-3" />{memoryCount ?? agent.memoryCount} memories</span>
        <span className="flex items-center gap-1"><ShieldCheck className="size-3" />{perms}/8 perms</span>
        <span className="ml-auto">{formatRelative(agent.updatedAt)}</span>
      </div>
    </GlowCard>
  )
}
