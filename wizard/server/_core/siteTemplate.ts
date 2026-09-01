// Single-page advocacy site assembly. The "always-free fallback" path —
// when Stitch is unconfigured, fails validation repeatedly, or the user
// just prefers the canonical look. Produces a self-contained HTML string
// styled against the Phase A design system (amber on warm near-black,
// .frame corner-bracket motif, .cite hover tooltips, .src-card
// bibliography, .section-mark eyebrows, .t-display headings).

import type { Campaign, CitationSource } from "../../shared/types";
import { loadDesignSystemCss } from "./designSystemCss";

interface SectionOutputs {
  meta?: string;
  hero?: string;
  about?: string;
  key_facts?: string;
  at_stake?: string;
  how_to_help?: string;
}

type CitationMap = Record<string, CitationSource>;

// ─────────────────────────────────────────────────────────────────────────
// Output parsing
// ─────────────────────────────────────────────────────────────────────────

interface NumberedItem {
  number: number;
  body: string;
}

function parseNumberedItems(text: string): NumberedItem[] {
  const matches = [
    ...text.matchAll(/^\s*(\d+)[.)]\s*([\s\S]*?)(?=^\s*\d+[.)]|$)/gm),
  ];
  return matches.map((m) => {
    let body = m[2].trim();
    body = body.replace(/^\*\*[^*]+\*\*\s*:?\s*/, "");
    return { number: parseInt(m[1], 10), body };
  });
}

function getItem(items: NumberedItem[], n: number): string | undefined {
  return items.find((i) => i.number === n)?.body;
}

interface MetaParsed {
  title: string;
  description: string;
  keywords: string;
  breaking_news?: string;
}

function parseMeta(text: string | undefined, fallbackTitle: string): MetaParsed {
  if (!text) {
    return {
      title: fallbackTitle,
      description: "Source-cited advocacy campaign.",
      keywords: "",
    };
  }
  const items = parseNumberedItems(text);
  return {
    title: getItem(items, 1) || fallbackTitle,
    description: getItem(items, 2) || "Source-cited advocacy campaign.",
    keywords: getItem(items, 3) || "",
    breaking_news: getItem(items, 4),
  };
}

interface HeroParsed {
  headline: string;
  subhead: string;
  cta_label: string;
}

function parseHero(
  text: string | undefined,
  fallbackHeadline: string
): HeroParsed {
  if (!text) {
    return {
      headline: fallbackHeadline,
      subhead: "",
      cta_label: "Take action",
    };
  }
  const items = parseNumberedItems(text);
  return {
    headline: getItem(items, 1) || fallbackHeadline,
    subhead: getItem(items, 2) || "",
    cta_label: getItem(items, 3) || "Take action",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Citations — uses Phase A .cite-* classes from design-system.css
// ─────────────────────────────────────────────────────────────────────────

const CITATION_RE = /\[([A-Z][A-Za-z0-9_\-:.]+)\]/g;
const TIER_TAGS = new Set(["TIER_1", "TIER_2", "TIER_3", "TIER_4"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderCitations(text: string, citationMap?: CitationMap): string {
  const escaped = escapeHtml(text);
  return escaped.replace(CITATION_RE, (_full, id) => {
    if (TIER_TAGS.has(id)) {
      return `<span class="tier">${id}</span>`;
    }
    const source = citationMap?.[id];
    if (source) {
      return `<a class="cite" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><span class="cite-k">${escapeHtml(id)}</span><span class="cite-c"><span class="cite-c-label">Source · click to open</span><span class="cite-c-title">${escapeHtml(source.title)}</span><span class="cite-c-url">${escapeHtml(source.url)}</span><span class="cite-c-key">${escapeHtml(id)}</span></span></a>`;
    }
    return `<span class="cite-k" title="${escapeHtml(id)} — source not resolved">${escapeHtml(id)}</span>`;
  });
}

function renderParagraphs(text: string, citationMap?: CitationMap): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${renderCitations(p, citationMap)}</p>`)
    .join("\n");
}

function collectCitations(texts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    let m: RegExpExecArray | null;
    const re = new RegExp(CITATION_RE);
    while ((m = re.exec(t)) !== null) {
      if (!TIER_TAGS.has(m[1])) seen.add(m[1]);
    }
  }
  return Array.from(seen).sort();
}

// ─────────────────────────────────────────────────────────────────────────
// Section renderers — Phase A visual idioms throughout
// ─────────────────────────────────────────────────────────────────────────

function renderBreakingNews(
  banner: string | undefined,
  citationMap?: CitationMap
): string {
  if (!banner) return "";
  return `
    <div class="relative z-50" style="background: var(--bg-0); border-bottom: 1px solid oklch(0.45 0.10 55 / 0.5);">
      <div class="max-w-6xl mx-auto px-6 py-2.5 flex items-center gap-3 text-[12px]">
        <span class="flex items-center gap-2 t-mono" style="color: var(--amber); letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; font-size: 10.5px; flex-shrink: 0;">
          <span class="inline-block relative" style="width: 14px; height: 14px; border: 1px solid var(--amber); display: inline-flex; align-items: center; justify-content: center;">
            <span class="pulse-dot"></span>
          </span>
          Breaking
        </span>
        <span class="t-mono" style="color: var(--ink-4); letter-spacing: 0.12em; font-size: 10px;">//</span>
        <span style="color: var(--ink-2); line-height: 1.5;">${renderCitations(banner, citationMap)}</span>
      </div>
    </div>
  `;
}

function renderTopNav(projectName: string, locale: string): string {
  return `
    <header class="nav-bar sticky top-0 z-40">
      <div class="max-w-6xl mx-auto px-6 py-3 flex items-center gap-5">
        <a href="#top" class="flex items-center gap-2.5 no-underline" style="color: var(--ink);">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M2 4 L18 4 L10 18 Z" stroke="currentColor" stroke-width="1.25" style="stroke: var(--amber);" />
            <path d="M5 8 L15 8" stroke="currentColor" stroke-width="0.8" style="stroke: var(--amber); opacity: 0.5;" />
            <path d="M7 12 L13 12" stroke="currentColor" stroke-width="0.8" style="stroke: var(--amber); opacity: 0.3;" />
          </svg>
          <span class="t-flourish" style="font-size: 19px; color: var(--ink);">${escapeHtml(projectName)}</span>
        </a>
        ${locale ? `<span class="hidden md:inline-block t-mono" style="color: var(--ink-4); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;">${escapeHtml(locale)}</span>` : ""}
        <div class="flex-1"></div>
        <nav class="hidden md:flex gap-6">
          <a href="#key-facts" class="nav-link">Facts</a>
          <a href="#about" class="nav-link">About</a>
          <a href="#at-stake" class="nav-link">Stakes</a>
          <a href="#how-to-help" class="nav-link cta">Take Action →</a>
          <a href="#sources" class="nav-link">Sources</a>
        </nav>
      </div>
    </header>
  `;
}

function renderHero(
  hero: HeroParsed,
  locale: string,
  citationMap?: CitationMap
): string {
  return `
    <a id="top" style="position: absolute; top: 0;"></a>
    <section class="relative overflow-hidden" style="border-bottom: 1px solid var(--rule);">
      <div class="max-w-4xl mx-auto px-6 pt-16 md:pt-24 pb-20 md:pb-28">
        <div class="section-mark mb-6">§ 00 / Exigence${locale ? ` · ${escapeHtml(locale)}` : ""}</div>
        <h1 class="t-display mb-8" style="font-size: clamp(36px, 5.6vw, 64px); line-height: 1.0; color: var(--ink);">${escapeHtml(hero.headline)}</h1>
        ${hero.subhead ? `<div class="prose-body mb-10" style="max-width: 56ch;">${renderCitations(hero.subhead, citationMap)}</div>` : ""}
        <a href="#key-facts" class="btn-amber">
          ${escapeHtml(hero.cta_label)}
          <span class="arrow" aria-hidden="true">→</span>
        </a>
      </div>
      <div class="hash-rule"></div>
    </section>
  `;
}

function renderKeyFacts(
  text: string | undefined,
  citationMap?: CitationMap
): string {
  const items = text ? parseNumberedItems(text) : [];
  const intro = `
    <div class="flex items-end justify-between mb-12 flex-wrap gap-6">
      <div>
        <div class="section-mark mb-3">§ 02 / Key facts</div>
        <h2 class="t-display" style="font-size: clamp(28px, 4vw, 48px); color: var(--ink);">By the data, in three lines.</h2>
      </div>
      <p class="t-mono" style="color: var(--ink-3); font-size: 11px; letter-spacing: 0.04em; max-width: 320px; line-height: 1.6;">
        ↪ Hover any <span style="color: var(--amber);">[citation]</span> chip for its source. Click to open the document.
      </p>
    </div>
  `;
  if (items.length === 0) {
    return `
      <section id="key-facts" style="border-bottom: 1px solid var(--rule); background: oklch(0.145 0.013 60 / 0.4);">
        <div class="max-w-6xl mx-auto px-6 py-20 md:py-24">
          ${intro}
          <p class="prose-body" style="color: var(--ink-4); font-style: italic;">No key facts generated yet.</p>
        </div>
      </section>
    `;
  }
  const cards = items
    .slice(0, 3)
    .map(
      (item, idx) => `
      <article class="frame relative p-7" style="padding-top: 32px;">
        <span class="br"></span>
        <div class="flex items-start justify-between mb-6">
          <span class="big-num">${String(idx + 1).padStart(2, "0")}</span>
          <span class="t-mono" style="color: var(--ink-4); font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase;">Fact</span>
        </div>
        <div class="prose-body" style="font-size: 14px; line-height: 1.65;">${renderCitations(item.body, citationMap)}</div>
      </article>
    `
    )
    .join("\n");
  return `
    <section id="key-facts" style="border-bottom: 1px solid var(--rule); background: oklch(0.145 0.013 60 / 0.4);">
      <div class="max-w-6xl mx-auto px-6 py-20 md:py-24">
        ${intro}
        <div class="grid md:grid-cols-3 gap-6 md:gap-7">${cards}</div>
      </div>
    </section>
  `;
}

function renderAbout(
  text: string | undefined,
  citationMap?: CitationMap
): string {
  const body = text
    ? renderParagraphs(text, citationMap)
    : `<p style="color: var(--ink-4); font-style: italic;">No "about" content generated yet.</p>`;
  return `
    <section id="about" class="relative" style="border-bottom: 1px solid var(--rule);">
      <div class="max-w-3xl mx-auto px-6 py-20 md:py-28">
        <div class="section-mark mb-3">§ 03 / About</div>
        <h2 class="t-display mb-8" style="font-size: clamp(28px, 4vw, 44px); color: var(--ink); letter-spacing: -0.02em;">The vacuum we're addressing.</h2>
        <div class="prose-body">${body}</div>
      </div>
    </section>
  `;
}

function renderAtStake(
  text: string | undefined,
  citationMap?: CitationMap
): string {
  const body = text
    ? renderParagraphs(text, citationMap)
    : `<p style="color: var(--ink-4); font-style: italic;">No "what's at stake" content generated yet.</p>`;
  return `
    <section id="at-stake" class="relative overflow-hidden" style="border-bottom: 1px solid var(--rule); background: linear-gradient(180deg, oklch(0.18 0.04 30 / 0.35) 0%, oklch(0.135 0.012 60) 80%);">
      <div class="max-w-3xl mx-auto px-6 py-20 md:py-28 relative">
        <div class="section-mark mb-3" style="color: var(--heat);">
          <span style="display:inline-block; width: 28px; height: 1px; background: var(--heat); margin-right: 12px; vertical-align: middle;"></span>
          § 05 / What's at stake
        </div>
        <h2 class="t-display mb-8" style="font-size: clamp(28px, 4vw, 44px); color: var(--ink); letter-spacing: -0.02em;">If the vacuum stays unaddressed.</h2>
        <div class="prose-body">${body}</div>
      </div>
    </section>
  `;
}

const ACTION_GLYPHS: string[] = [
  // triangle — advocacy / amplification
  `<path d="M21 5 L37 33 L5 33 Z"/><path d="M21 5 L21 33" style="opacity: 0.4;"/><path d="M13 19 L29 19" style="opacity: 0.4;"/>`,
  // hexagon — petition / collective signature
  `<path d="M21 4 L36 13 L36 29 L21 38 L6 29 L6 13 Z"/><circle cx="21" cy="21" r="3" style="fill: var(--amber); stroke: none;"/>`,
  // square with corners — institution
  `<rect x="6" y="6" width="30" height="30"/><line x1="6" y1="14" x2="36" y2="14"/><line x1="14" y1="14" x2="14" y2="36"/><line x1="28" y1="14" x2="28" y2="36"/><line x1="6" y1="28" x2="36" y2="28"/>`,
  // droplet/circle with ring — conservation
  `<circle cx="21" cy="21" r="14"/><circle cx="21" cy="21" r="9" style="opacity: 0.55;"/><path d="M21 11 Q 14 21 21 28 Q 28 21 21 11 Z" style="fill: var(--amber); opacity: 0.18;"/>`,
];

function renderHowToHelp(
  text: string | undefined,
  citationMap?: CitationMap
): string {
  const items = text ? parseNumberedItems(text) : [];
  const intro = `
    <div class="flex items-end justify-between mb-12 flex-wrap gap-6">
      <div>
        <div class="section-mark mb-3">§ 07 / Take action</div>
        <h2 class="t-display" style="font-size: clamp(28px, 4vw, 48px); color: var(--ink);">How you can help.</h2>
        <p class="t-mono mt-3" style="color: var(--ink-3); font-size: 11px; letter-spacing: 0.04em;">↪ Source-cited actions specific to this vacuum.</p>
      </div>
    </div>
  `;
  if (items.length === 0) {
    return `
      <section id="how-to-help" style="border-bottom: 1px solid var(--rule); background: oklch(0.145 0.013 60 / 0.4);">
        <div class="max-w-6xl mx-auto px-6 py-20 md:py-24">
          ${intro}
          <p class="prose-body" style="color: var(--ink-4); font-style: italic;">No actions generated yet.</p>
        </div>
      </section>
    `;
  }
  const cards = items
    .slice(0, 4)
    .map(
      (item, idx) => `
      <article class="frame relative p-7">
        <span class="br"></span>
        <div class="flex items-start gap-5 mb-5">
          <svg width="42" height="42" viewBox="0 0 42 42" class="shrink-0" aria-hidden="true">
            <g class="glyph">${ACTION_GLYPHS[idx] ?? ACTION_GLYPHS[0]}</g>
          </svg>
          <div>
            <div class="t-mono" style="color: var(--ink-4); font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase;">Action ${String(idx + 1).padStart(2, "0")}</div>
          </div>
        </div>
        <div class="prose-body" style="font-size: 14px; line-height: 1.65;">${renderCitations(item.body, citationMap)}</div>
      </article>
    `
    )
    .join("\n");
  return `
    <section id="how-to-help" style="border-bottom: 1px solid var(--rule); background: oklch(0.145 0.013 60 / 0.4);">
      <div class="max-w-6xl mx-auto px-6 py-20 md:py-24">
        ${intro}
        <div class="grid md:grid-cols-2 gap-6 md:gap-7">${cards}</div>
      </div>
    </section>
  `;
}

function renderSourcesIndex(
  citations: string[],
  citationMap?: CitationMap
): string {
  const intro = `
    <div class="section-mark mb-3">§ 08 / Bibliography</div>
    <h2 class="t-display mb-3" style="font-size: clamp(24px, 3.4vw, 36px); color: var(--ink);">Sources, in full.</h2>
    <p class="prose-body mb-10" style="font-size: 14px; max-width: 60ch;">
      Every factual claim on this page carries a hash citation traceable to a source document the campaign's NotebookLM notebook ingested. Hover any citation chip inline to see its source; click to open. The full list below is grouped by source.
    </p>
  `;
  if (citations.length === 0) {
    return `
      <section id="sources" style="border-bottom: 1px solid var(--rule);">
        <div class="max-w-5xl mx-auto px-6 py-20 md:py-24">
          ${intro}
          <p class="prose-body" style="color: var(--ink-4); font-style: italic;">No citations resolved.</p>
        </div>
      </section>
    `;
  }

  const bySource = new Map<
    string,
    { source: CitationSource; ids: string[] }
  >();
  const unresolved: string[] = [];
  for (const id of citations) {
    const src = citationMap?.[id];
    if (src && src.url) {
      const existing = bySource.get(src.url);
      if (existing) existing.ids.push(id);
      else bySource.set(src.url, { source: src, ids: [id] });
    } else {
      unresolved.push(id);
    }
  }

  const resolvedEntries = Array.from(bySource.values())
    .sort((a, b) => a.source.title.localeCompare(b.source.title))
    .map(({ source, ids }, idx) => {
      const slot = String(idx + 1).padStart(2, "0");
      return `<li class="src-card">
        <div class="flex items-baseline gap-3 mb-2 flex-wrap">
          <span class="t-mono" style="color: var(--amber); font-size: 11px; letter-spacing: 0.1em;">[ S-${slot} ]</span>
        </div>
        <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" class="block t-display" style="font-size: 16px; color: var(--ink); margin-bottom: 4px;">${escapeHtml(source.title)}</a>
        <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" class="block t-mono" style="font-size: 11px; color: var(--ink-3); word-break: break-all; margin-bottom: 12px;">${escapeHtml(source.url)}</a>
        <div class="flex flex-wrap gap-0">${ids.map((id) => `<span class="tok">${escapeHtml(id)}</span>`).join("")}</div>
      </li>`;
    })
    .join("\n");

  const unresolvedBlock =
    unresolved.length > 0
      ? `<div class="mt-6 pt-6" style="border-top: 1px solid var(--rule);">
          <p class="t-mono" style="font-size: 11px; color: var(--ink-4); letter-spacing: 0.08em; margin-bottom: 8px;">${unresolved.length} citation${unresolved.length === 1 ? "" : "s"} did not resolve to a source URL:</p>
          <div class="flex flex-wrap gap-0">${unresolved.map((id) => `<span class="tok">${escapeHtml(id)}</span>`).join("")}</div>
        </div>`
      : "";

  return `
    <section id="sources" style="border-bottom: 1px solid var(--rule);">
      <div class="max-w-5xl mx-auto px-6 py-20 md:py-24">
        ${intro}
        <ol class="space-y-4" style="list-style: none; padding: 0;">${resolvedEntries}</ol>
        ${unresolvedBlock}
      </div>
    </section>
  `;
}

function renderFooter(projectName: string, locale: string): string {
  return `
    <footer style="background: var(--bg-0);">
      <div class="max-w-6xl mx-auto px-6 py-12">
        <div class="flex items-start gap-8 flex-wrap">
          <div class="flex items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M2 4 L18 4 L10 18 Z" style="stroke: var(--amber); stroke-width: 1.25; fill: none;" />
            </svg>
            <span class="t-flourish" style="font-size: 17px; color: var(--ink);">${escapeHtml(projectName)}</span>
          </div>
          ${locale ? `<div class="t-mono" style="color: var(--ink-4); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;">${escapeHtml(locale)}</div>` : ""}
          <div class="flex-1"></div>
          <a href="#top" class="nav-link">↑ Top</a>
        </div>
        <div class="hash-rule my-6"></div>
        <p class="t-mono" style="color: var(--ink-4); font-size: 10.5px; line-height: 1.7; max-width: 70ch;">
          // Generated by the Fractal Framework Wizard. Every factual claim
          on this page carries a hash citation traceable to the source
          documents ingested into the campaign's NotebookLM notebook.
        </p>
      </div>
    </footer>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level renderer
// ─────────────────────────────────────────────────────────────────────────

export function renderSite(campaign: Campaign): string {
  const outputs = (campaign.outputs ?? {}) as SectionOutputs;
  const citationMap: CitationMap = campaign.citation_sources ?? {};

  const projectName = campaign.project_name ?? campaign.title;
  const locale = campaign.locale ?? "";

  const meta = parseMeta(outputs.meta, projectName);
  const hero = parseHero(outputs.hero, meta.title);

  const allCitations = collectCitations([
    outputs.meta,
    outputs.hero,
    outputs.about,
    outputs.key_facts,
    outputs.at_stake,
    outputs.how_to_help,
  ]);

  const designSystemCss = loadDesignSystemCss();

  return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description.replace(/<[^>]+>/g, ""))}" />
    ${meta.keywords ? `<meta name="keywords" content="${escapeHtml(meta.keywords)}" />` : ""}
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@1,6..72,400;1,6..72,500&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <style data-injected="fractal-design-system">
${designSystemCss}
    </style>
  </head>
  <body class="antialiased">
    ${renderBreakingNews(meta.breaking_news, citationMap)}
    ${renderTopNav(projectName, locale)}
    ${renderHero(hero, locale, citationMap)}
    ${renderKeyFacts(outputs.key_facts, citationMap)}
    ${renderAbout(outputs.about, citationMap)}
    ${renderAtStake(outputs.at_stake, citationMap)}
    ${renderHowToHelp(outputs.how_to_help, citationMap)}
    ${renderSourcesIndex(allCitations, citationMap)}
    ${renderFooter(projectName, locale)}
  </body>
</html>`;
}
