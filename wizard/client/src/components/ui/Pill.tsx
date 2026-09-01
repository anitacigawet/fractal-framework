import type { ReactNode } from "react";

type Tone = "neutral" | "ok" | "warn" | "bad";

interface PillProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

/**
 * Status pill — used for stage labels, auth state, run status, etc.
 * Picks tone from the warm-palette status semantics.
 */
export function Pill({ children, tone = "neutral", className = "" }: PillProps) {
  const toneClass = tone === "neutral" ? "" : tone;
  return (
    <span className={`pill ${toneClass} ${className}`.trim()}>{children}</span>
  );
}
