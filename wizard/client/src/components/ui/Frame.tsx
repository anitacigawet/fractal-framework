import type { HTMLAttributes, ReactNode } from "react";

interface FrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  as?: "div" | "section" | "article" | "aside";
}

/**
 * The corner-bracketed panel that's the unifying motif throughout the wizard.
 * Renders four amber corner crops via the .frame class + a <span class="br" />
 * for the bottom two (the design system's chosen convention).
 */
export function Frame({
  children,
  as = "div",
  className = "",
  ...rest
}: FrameProps) {
  const Tag = as;
  return (
    <Tag className={`frame ${className}`.trim()} {...rest}>
      <span className="br" />
      {children}
    </Tag>
  );
}
