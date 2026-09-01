import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "amber" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  arrow?: boolean;
}

/**
 * The two button shapes used throughout the wizard:
 *   - "amber": the primary CTA (Space Grotesk uppercase, amber fill).
 *   - "ghost": the secondary/tertiary action (mono caps, outlined).
 */
export function Button({
  children,
  variant = "amber",
  arrow = false,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const base = variant === "amber" ? "btn-amber" : "btn-ghost";
  return (
    <button type={type} className={`${base} ${className}`.trim()} {...rest}>
      {children}
      {arrow && (
        <span className="arrow" aria-hidden="true">
          →
        </span>
      )}
    </button>
  );
}
