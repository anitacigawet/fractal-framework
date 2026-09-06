import type { CSSProperties } from "react";

// Scripts support generated layouts (including Tailwind's CDN), but the
// document must never acquire the wizard's origin, forms or top navigation.
export function SitePreview({ html, title, style }: {
  html: string;
  title: string;
  style?: CSSProperties;
}) {
  return <iframe
    title={title}
    srcDoc={html}
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
    referrerPolicy="no-referrer"
    style={style}
  />;
}
