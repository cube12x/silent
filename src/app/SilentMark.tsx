import { cn } from "cn"

/**
 * Silent's mark: a small, friendly ghost — round head, wavy hem, two big eyes and tiny cheeks.
 * Pocket-monster energy, not a horror ghost. Reads at 16px and 1024px.
 */
export function SilentMark({ size = 24, className, glow, mood = "calm" }: { size?: number; className?: string; glow?: boolean; mood?: "calm" | "busy" | "happy" }) {
  const eye = mood === "happy" ? "M11 15.5c.5-.9 1.5-.9 2 0" : ""
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      style={glow ? { filter: "drop-shadow(0 0 8px color-mix(in oklch, var(--cyan) 55%, transparent))" } : undefined}
      aria-hidden
    >
      <defs>
        <linearGradient id="ghost-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f7fb" />
          <stop offset="1" stopColor="#c9d6e3" />
        </linearGradient>
      </defs>
      {/* body */}
      <path
        d="M16 3.5c-5.6 0-9.5 4.2-9.5 9.8v11.4c0 1.3 1.5 2 2.5 1.2l1.7-1.4c.5-.4 1.2-.4 1.7 0l1.9 1.6c.5.4 1.2.4 1.7 0l1.9-1.6c.5-.4 1.2-.4 1.7 0l1.9 1.6c.5.4 1.2.4 1.7 0l1.7-1.4c1-.8 2.5-.1 2.5 1.2V13.3c0-5.6-3.9-9.8-9.5-9.8z"
        fill="url(#ghost-body)"
        stroke="var(--cyan)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* eyes */}
      {mood === "happy" ? (
        <g fill="none" stroke="#0b1620" strokeWidth="1.6" strokeLinecap="round">
          <path d="M10.6 13.6c.6-1.2 2.2-1.2 2.8 0" />
          <path d="M18.6 13.6c.6-1.2 2.2-1.2 2.8 0" />
        </g>
      ) : (
        <g>
          <ellipse cx="12" cy="13.6" rx="1.9" ry="2.6" fill="#0b1620" />
          <ellipse cx="20" cy="13.6" rx="1.9" ry="2.6" fill="#0b1620" />
          <circle cx="12.7" cy="12.6" r=".7" fill="#fff" />
          <circle cx="20.7" cy="12.6" r=".7" fill="#fff" />
        </g>
      )}
      {/* cheeks */}
      <circle cx="9" cy="17.2" r="1.3" fill="var(--cyan)" opacity=".55" />
      <circle cx="23" cy="17.2" r="1.3" fill="var(--cyan)" opacity=".55" />
      {/* tiny mouth */}
      <path d={eye || "M14.6 17.8c.8.6 2 .6 2.8 0"} fill="none" stroke="#0b1620" strokeWidth="1.1" strokeLinecap="round" />
      {mood === "busy" && <circle cx="26" cy="7" r="2.2" fill="var(--cyan)" className="animate-pulse-soft" />}
    </svg>
  )
}
