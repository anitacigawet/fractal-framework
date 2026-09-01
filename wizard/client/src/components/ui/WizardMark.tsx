/**
 * The Fractal Framework triangle mark — three nested chevrons echoing the
 * generated site's inverted-pyramid hero glyph. Used in the top nav.
 */
export function WizardMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 4 L18 4 L10 18 Z"
        style={{ stroke: "var(--amber)" }}
        strokeWidth="1.25"
      />
      <path
        d="M5 8 L15 8"
        style={{ stroke: "var(--amber)", opacity: 0.5 }}
        strokeWidth="0.8"
      />
      <path
        d="M7 12 L13 12"
        style={{ stroke: "var(--amber)", opacity: 0.3 }}
        strokeWidth="0.8"
      />
    </svg>
  );
}
