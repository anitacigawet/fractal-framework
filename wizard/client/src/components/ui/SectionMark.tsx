import type { ReactNode } from "react";

interface SectionMarkProps {
  children: ReactNode;
  className?: string;
}

/**
 * The mono-caps eyebrow with the leading 28px amber rule.
 * Used above every major section heading.
 */
export function SectionMark({ children, className = "" }: SectionMarkProps) {
  return <div className={`section-mark ${className}`.trim()}>{children}</div>;
}
