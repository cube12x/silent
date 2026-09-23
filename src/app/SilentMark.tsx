import { cn } from "cn"

/** Silent app mark: a muted "S" cut from a hexagonal plate. */
export function SilentMark({ size = 24, className, glow }: { size?: number; className?: string; glow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 text-cyan", className)} style={glow ? { filter: "drop-shadow(0 0 10px color-mix(in oklch, var(--cyan) 60%, transparent))" } : undefined} aria-hidden>
      <path d="M16 2l12 7v14l-12 7L4 23V9z" fill="var(--ink-2)" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M20.5 11.2c-1-1.2-2.6-1.8-4.4-1.8-2.7 0-4.6 1.4-4.6 3.4 0 4.4 9.4 2.2 9.4 6.9 0 2.2-2 3.7-5 3.7-2.2 0-4-.8-5.2-2.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
