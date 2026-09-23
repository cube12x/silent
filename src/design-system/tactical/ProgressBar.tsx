import { cn } from "cn"

export function ProgressBar({ value, active, tone = "cyan", className, size = "md" }: { value: number; active?: boolean; tone?: "cyan" | "success" | "danger" | "warn" | "violet"; className?: string; size?: "sm" | "md" | "lg" }) {
  const v = Math.max(0, Math.min(100, value))
  const color = { cyan: "bg-text-1", success: "bg-success", danger: "bg-danger", warn: "bg-warn", violet: "bg-text-2" }[tone]
  return (
    <div className={cn("relative w-full overflow-hidden rounded-full bg-ink-4/80", size === "sm" ? "h-1" : size === "lg" ? "h-2.5" : "h-1.5", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", color)} style={{ width: `${v}%` }} />
      {active && <div className="shimmer-bar absolute inset-0" />}
    </div>
  )
}
