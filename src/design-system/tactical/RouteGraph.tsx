import { cn } from "cn"
import type { ProviderId, RoutingDecision, Subtask, WorkerState } from "@/domain"
import { PROVIDERS } from "@/providers/registry"
import { ModelLogo } from "./ModelLogo"

function labelFor(ref: string, labels?: Record<string, string>): { name: string; short: string; color: string } {
  const [provider, ...rest] = ref.split(":")
  const info = PROVIDERS[provider as ProviderId]
  const name = labels?.[ref] ?? (rest.join(":") || info?.name || ref)
  return { name, short: name.length > 14 ? `${name.slice(0, 13)}…` : name, color: info?.color ?? "var(--text-3)" }
}

const KIND_LABEL: Record<Subtask["kind"], string> = {
  architecture: "Architecture",
  backend: "Backend",
  frontend: "Frontend",
  algorithm: "Algorithm",
  tests: "Tests",
  review: "Review",
  integration: "Integration",
  docs: "Docs",
}

const STATE_COLOR: Partial<Record<WorkerState, string>> = {
  completed: "var(--success)",
  failed: "var(--danger)",
  blocked: "var(--warn)",
  waiting: "var(--text-3)",
}

/**
 * Task → Model routing graph. Left column = subtasks (in plan order), right column = the models they
 * route to. Edges animate while the subtask is active. Pure SVG, scales with its container.
 */
export function RouteGraph({ plan, routing, className, onSelectSubtask, selectedSubtaskId, height, labels, kindLabels }: { plan: Subtask[]; routing: RoutingDecision[]; className?: string; onSelectSubtask?: (id: string) => void; selectedSubtaskId?: string; height?: number; labels?: Record<string, string>; kindLabels?: Record<Subtask["kind"], string> }) {
  const models = Array.from(new Set(routing.map((r) => r.primaryModelId).filter(Boolean)))
  const rowH = 44
  const H = height ?? Math.max(plan.length, models.length) * rowH + 24
  const W = 640
  const leftX = 16
  const rightX = W - 16
  const leftW = 220
  const rightW = 180
  const ty = (i: number, n: number) => 12 + (H - 24) * ((i + 0.5) / Math.max(n, 1))

  return (
    <div className={cn("relative w-full overflow-hidden", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ minHeight: H }}>
        <defs>
          <linearGradient id="rg-edge" x1="0" x2="1">
            <stop offset="0" stopColor="var(--cyan)" stopOpacity="0.15" />
            <stop offset="1" stopColor="var(--cyan)" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        {plan.map((s, i) => {
          const r = routing.find((x) => x.subtaskId === s.id)
          const mi = models.indexOf(r?.primaryModelId ?? "")
          if (mi < 0) return null
          const y1 = ty(i, plan.length)
          const y2 = ty(mi, models.length)
          const x1 = leftX + leftW
          const x2 = rightX - rightW
          const mid = (x1 + x2) / 2
          const active = ["planning", "thinking", "coding", "testing", "reviewing"].includes(s.state)
          const color = STATE_COLOR[s.state] ?? (active ? "var(--cyan)" : "url(#rg-edge)")
          return (
            <path
              key={s.id}
              d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
              fill="none"
              stroke={color}
              strokeWidth={selectedSubtaskId === s.id ? 2.5 : 1.5}
              strokeDasharray={active ? "6 6" : undefined}
              className={cn(active && "animate-flow")}
              opacity={s.state === "waiting" ? 0.45 : 0.9}
            />
          )
        })}
        {plan.map((s, i) => {
          const y = ty(i, plan.length)
          const r = routing.find((x) => x.subtaskId === s.id)
          const model = r?.primaryModelId ? labelFor(r.primaryModelId, labels) : undefined
          const active = ["planning", "thinking", "coding", "testing", "reviewing"].includes(s.state)
          const stroke = STATE_COLOR[s.state] ?? (active ? "var(--cyan)" : "var(--line-strong)")
          return (
            <g key={s.id} transform={`translate(${leftX},${y - 16})`} className={cn(onSelectSubtask && "cursor-pointer")} onClick={() => onSelectSubtask?.(s.id)}>
              <rect width={leftW} height={32} rx={8} fill="var(--ink-2)" stroke={selectedSubtaskId === s.id ? "var(--cyan)" : stroke} strokeWidth={selectedSubtaskId === s.id ? 1.5 : 1} />
              <circle cx={14} cy={16} r={3.5} fill={stroke} className={cn(active && "animate-pulse-soft")} />
              <text x={26} y={20} fontSize={12} fontWeight={600} fill="var(--text-1)" fontFamily="var(--font-sans)">
                {(kindLabels ?? KIND_LABEL)[s.kind]}
              </text>
              <text x={leftW - 10} y={20} fontSize={10} textAnchor="end" fill="var(--text-3)" fontFamily="var(--font-mono)">
                {model ? model.short : "—"}
              </text>
            </g>
          )
        })}
        {models.map((id, i) => {
          const y = ty(i, models.length)
          const model = labelFor(id, labels)
          const color = model.color
          const count = routing.filter((r) => r.primaryModelId === id).length
          return (
            <g key={id} transform={`translate(${rightX - rightW},${y - 16})`}>
              <rect width={rightW} height={32} rx={8} fill="var(--ink-2)" stroke={color} strokeOpacity={0.5} />
              <text x={38} y={20} fontSize={12} fontWeight={600} fill="var(--text-1)" fontFamily="var(--font-sans)">
                {model.name}
              </text>
              <text x={rightW - 10} y={20} fontSize={10} textAnchor="end" fill="var(--text-3)" fontFamily="var(--font-mono)">
                ×{count}
              </text>
            </g>
          )
        })}
      </svg>
      {/* logos overlay (HTML so they get the glow filter) */}
      {models.map((id, i) => {
        const top = ((ty(i, models.length) - 16) / H) * 100
        return (
          <div key={id} className="pointer-events-none absolute" style={{ right: `${((16 + rightW - 8) / W) * 100}%`, top: `${top}%`, transform: "translate(0,3px)" }}>
            <ModelLogo modelRef={id} size={14} plain className="!size-6" />
          </div>
        )
      })}
    </div>
  )
}

export { KIND_LABEL }
