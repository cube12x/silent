import { cn } from "cn"

/**
 * Silent's mark: a classic arcade ghost silhouette in black — dome head, three-scallop hem, two big
 * eyes. Drawn with a thin light outline so it reads on black backgrounds at 16px and on the app icon.
 */
export function SilentMark({ size = 24, className, mood = "calm" }: { size?: number; className?: string; glow?: boolean; mood?: "calm" | "busy" | "happy" }) {
  const look = mood === "busy" ? 1.2 : 0
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      {/* body: dome + straight sides + three scallops */}
      <path
        d="M6 15.5C6 9.7 10.5 5 16 5s10 4.7 10 10.5V27l-3.33-3-3.34 3L16 24l-3.33 3-3.34-3L6 27z"
        fill="#000"
        stroke="var(--text-1)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* eyes */}
      <ellipse cx="12.2" cy="14.5" rx="2.6" ry="3.2" fill="var(--text-1)" />
      <ellipse cx="19.8" cy="14.5" rx="2.6" ry="3.2" fill="var(--text-1)" />
      <circle cx={12.9 + look} cy="15.2" r="1.35" fill="#000" />
      <circle cx={20.5 + look} cy="15.2" r="1.35" fill="#000" />
    </svg>
  )
}
