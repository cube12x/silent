import { cn } from "cn"
import { Switch } from "@/components/ui/switch"
import { TacticalChip } from "./TacticalChip"

export function PermissionToggle({ label, description, checked, onCheckedChange, danger, locked, className }: { label: string; description?: string; checked: boolean; onCheckedChange?: (v: boolean) => void; danger?: boolean; locked?: boolean; className?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-ink-2/50 px-3 py-2.5 transition-colors hover:border-line-strong", locked && "cursor-not-allowed opacity-70", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-text-1">
          {label}
          {danger && <TacticalChip tone="danger" size="xs">high risk</TacticalChip>}
          {locked && <TacticalChip tone="neutral" size="xs">locked</TacticalChip>}
        </div>
        {description && <div className="text-xs text-text-3">{description}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={locked} className={cn(checked && (danger ? "data-[state=checked]:bg-danger" : "data-[state=checked]:bg-cyan"))} />
    </label>
  )
}
