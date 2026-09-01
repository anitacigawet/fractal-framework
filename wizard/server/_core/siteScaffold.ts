// Stitch token spec + prompt builders + validation + injection.
//
// The model: the wizard never sends real content to Stitch. Instead it
// describes the page's section shape in a text prompt, naming each content
// slot with a literal {{TOKEN}} that Stitch is instructed to place verbatim.
// Stitch returns HTML with those tokens preserved (we validate after every
// generate/edit pass). Once the visual design is final, the wizard injects
// the real content into the tokens — citations, body text, bibliography
// pre-rendered with the Phase A design system classes (.cite, .src-card,
// .tok, .tier, .prose-body) which are then loaded via an injected <style>
// block in the final HTML.
//
// Mirrors siteTemplate.ts's parsing helpers but is built around Stitch's
// text-prompt-driven flow instead of direct HTML emission.

import type { Campaign, CitationSource } from "../../shared/types";
import { loadDesignSystemCss } from "./designSystemCss";

// ─────────────────────────────────────────────────────────────────────────
// Output parsing — duplicated from siteTemplate.ts. Both files own their
// own copies so changes to one don't accidentally affect the other.
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

function parseMeta(
  text: string | undefined,
  fallbackTitle: string
): {
  title: string;
  description: string;
  keywords: string;
  breaking_news?: string;
} {
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

function parseHero(
  text: string | undefined,
  fallbackHeadline: string
): { headline: string; subhead: string; cta_label: string } {
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
// Citation rendering — uses Phase A .cite-* classes from design-system.css.
// renderCitations produces inline hash-citation chips with hover tooltips.
// renderParagraphs splits on blank lines and wraps each para in <p>.
// ─────────────────────────────────────────────────────────────────────────

type CitationMap = Record<string, CitationSource>;

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

function renderBibliography(
  citations: string[],
  citationMap: CitationMap
): string {
  if (citations.length === 0) {
    return `<p class="prose-body" style="font-size:13px;color:var(--ink-4);font-style:italic;">No citations resolved.</p>`;
  }
  const bySource = new Map<
    string,
    { source: CitationSource; ids: string[] }
  >();
  const unresolved: string[] = [];
  for (const id of citations) {
    const src = citationMap[id];
    if (src && src.url) {
      const existing = bySource.get(src.url);
      if (existing) existing.ids.push(id);
      else bySource.set(src.url, { source: src, ids: [id] });
    } else {
      unresolved.push(id);
    }
  }
  const resolved = Array.from(bySource.values())
    .sort((a, b) => a.source.title.localeCompare(b.source.title))
    .map(({ source, ids }, idx) => {
      const slot = String(idx + 1).padStart(2, "0");
      return `<li class="src-card">
  <div class="flex items-baseline gap-3 mb-2 flex-wrap">
    <span class="t-mono" style="color:var(--amber);font-size:11px;letter-spacing:0.1em;">[ S-${slot} ]</span>
  </div>
  <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" class="block t-display" style="font-size:16px;color:var(--ink);margin-bottom:4px;">${escapeHtml(source.title)}</a>
  <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" class="block t-mono" style="font-size:11px;color:var(--ink-3);word-break:break-all;margin-bottom:12px;">${escapeHtml(source.url)}</a>
  <div class="flex flex-wrap gap-0">${ids.map((id) => `<span class="tok">${escapeHtml(id)}</span>`).join("")}</div>
</li>`;
    })
    .join("\n");

  const unresolvedBlock =
    unresolved.length > 0
      ? `<div class="mt-6 pt-6" style="border-top:1px solid var(--rule);">
  <p class="t-mono" style="font-size:11px;color:var(--ink-4);letter-spacing:0.08em;margin-bottom:8px;">${unresolved.length} citation${unresolved.length === 1 ? "" : "s"} did not resolve to a source URL:</p>
  <div class="flex flex-wrap gap-0">${unresolved.map((id) => `<span class="tok">${escapeHtml(id)}</span>`).join("")}</div>
</div>`
      : "";

  return `<ol class="space-y-4" style="list-style:none;padding:0;">${resolved}</ol>${unresolvedBlock}`;
}

// ─────────────────────────────────────────────────────────────────────────
// TokenSpec + SiteSpec
// ─────────────────────────────────────────────────────────────────────────

export type TokenKind =
  | "title"           // short — page/site title or section heading
  | "subhead"         // medium-length inline text
  | "body_short"      // one-paragraph (~50-100 words)
  | "body_paragraph"  // multi-paragraph body (~150-300 words)
  | "label"           // very short (button text, CTA label)
  | "html_block";     // pre-rendered block of HTML (bibliography)

export interface TokenSpec {
  name: string;         // canonical token name without braces
  placeholder: string;  // "{{TOKEN_NAME}}" — what we tell Stitch to preserve
  kind: TokenKind;
  injectionHtml: string;
  promptHint: string;   // for the Stitch prompt: human-readable description
  required: boolean;
}

export interface SectionSpec {
  name: string;
  label: string;
  tokens: string[];       // token names that belong to this section
  description: string;    // for Stitch prompts
  order: number;
}

export interface SiteSpec {
  campaign: Campaign;
  tokens: TokenSpec[];
  tokenByName: Map<string, TokenSpec>;
  sections: SectionSpec[];
  projectName: string;
  locale: string;
  pageTitle: string;
  pageDescription: string;
  pageKeywords: string;
  hasBreakingNews: boolean;
}

/**
 * Build the full token spec + section list for a Campaign. Pulls content
 * from campaign.outputs and parses each into structured fields. The result
 * is what the rest of the Stitch pipeline operates on.
 */
export function buildSiteSpec(campaign: Campaign): SiteSpec {
  const outputs = campaign.outputs ?? {};
  const citationMap: CitationMap = campaign.citation_sources ?? {};
  const projectName = campaign.project_name ?? campaign.title;
  const locale = campaign.locale ?? "";

  const meta = parseMeta(outputs.meta, projectName);
  const hero = parseHero(outputs.hero, meta.title);
  const facts = outputs.key_facts ? parseNumberedItems(outputs.key_facts) : [];
  const actions = outputs.how_to_help ? parseNumberedItems(outputs.how_to_help) : [];
  const allCitations = collectCitations([
    outputs.meta,
    outputs.hero,
    outputs.about,
    outputs.key_facts,
    outputs.at_stake,
    outputs.how_to_help,
  ]);

  const tokens: TokenSpec[] = [];
  const tok = (
    name: string,
    kind: TokenKind,
    injectionHtml: string,
    promptHint: string,
    required = true
  ): TokenSpec => {
    const spec: TokenSpec = {
      name,
      placeholder: `{{${name}}}`,
      kind,
      injectionHtml,
      promptHint,
      required,
    };
    tokens.push(spec);
    return spec;
  };

  // Project header / footer
  tok("PROJECT_NAME", "title", escapeHtml(projectName), `Project / site name: "${projectName}"`);
  tok("LOCALE", "label", escapeHtml(locale), `Locale subtitle: "${locale}"`);

  // Breaking news (optional)
  if (meta.breaking_news) {
    tok(
      "BREAKING_TEXT",
      "subhead",
      renderCitations(meta.breaking_news, citationMap),
      "A single-sentence breaking-news bulletin with embedded source citations."
    );
  }

  // Hero
  tok(
    "HERO_HEADLINE",
    "title",
    escapeHtml(hero.headline),
    `Large hero headline — a single sentence stating the campaign thesis: "${hero.headline.slice(0, 80)}..."`
  );
  tok(
    "HERO_SUBHEAD",
    "subhead",
    renderCitations(hero.subhead, citationMap),
    `Hero subhead — ~30-60 words of context with embedded citation chips.`
  );
  tok(
    "HERO_CTA",
    "label",
    escapeHtml(hero.cta_label),
    `Hero CTA button label: "${hero.cta_label}"`
  );

  // Key facts — exactly 3 cards
  for (let i = 0; i < 3; i++) {
    const item = facts[i];
    tok(
      `FACT_${i + 1}`,
      "body_short",
      item ? renderCitations(item.body, citationMap) : `<em style="color:var(--ink-4);">No fact ${i + 1}</em>`,
      `Key fact #${i + 1} — a single ~40-80 word paragraph with embedded citation chips.`
    );
  }

  // About — multi-paragraph
  tok(
    "ABOUT_BODY",
    "body_paragraph",
    outputs.about
      ? renderParagraphs(outputs.about, citationMap)
      : `<p><em style="color:var(--ink-4);">No about content generated yet.</em></p>`,
    `Long-form about section — ~180-220 words explaining the activism vacuum, multiple paragraphs with embedded citation chips.`
  );

  // At stake — multi-paragraph
  tok(
    "STAKES_BODY",
    "body_paragraph",
    outputs.at_stake
      ? renderParagraphs(outputs.at_stake, citationMap)
      : `<p><em style="color:var(--ink-4);">No "what's at stake" content generated yet.</em></p>`,
    `"What's at stake" body — ~120-180 words on the consequences of inaction, with embedded citation chips. This is the campaign's emotional pivot — design accordingly.`
  );

  // How to help — exactly 4 action cards
  for (let i = 0; i < 4; i++) {
    const item = actions[i];
    tok(
      `ACTION_${i + 1}`,
      "body_short",
      item ? renderCitations(item.body, citationMap) : `<em style="color:var(--ink-4);">No action ${i + 1}</em>`,
      `Action #${i + 1} — a single ~40-80 word imperative-voice paragraph describing one concrete action a reader can take, with embedded citation chips.`
    );
  }

  // Bibliography — pre-rendered HTML block
  tok(
    "BIBLIOGRAPHY",
    "html_block",
    renderBibliography(allCitations, citationMap),
    `Full bibliography — will be replaced with a list of ${Object.keys(citationMap).length || allCitations.length} source cards grouped by source URL.`
  );

  // Sections — used by edit() prompts that target one section at a time
  const sections: SectionSpec[] = [
    {
      name: "header",
      label: "Header & navigation",
      order: 0,
      tokens: ["PROJECT_NAME", "LOCALE"],
      description: "Sticky top navigation bar with the project name and locale subtitle.",
    },
    ...(meta.breaking_news
      ? [
          {
            name: "breaking",
            label: "Breaking-news banner",
            order: 1,
            tokens: ["BREAKING_TEXT"],
            description: "Full-bleed banner with a teletype/alert visual treatment above the hero.",
          },
        ]
      : []),
    {
      name: "hero",
      label: "Hero",
      order: 2,
      tokens: ["HERO_HEADLINE", "HERO_SUBHEAD", "HERO_CTA"],
      description: "Hero section with a large headline, subhead paragraph, and CTA button anchored to #key-facts. Consider an atmospheric wireframe / geometric SVG flourish — this is the page's visual anchor.",
    },
    {
      name: "key_facts",
      label: "Key facts",
      order: 3,
      tokens: ["FACT_1", "FACT_2", "FACT_3"],
      description: "Three numbered fact cards (id='key-facts') in a grid. Each card carries one of the FACT_n tokens. Consider outline-stroke numerals as visual anchors.",
    },
    {
      name: "about",
      label: "About",
      order: 4,
      tokens: ["ABOUT_BODY"],
      description: "Long-form prose section (id='about') with a single column of body text.",
    },
    {
      name: "at_stake",
      label: "What's at stake",
      order: 5,
      tokens: ["STAKES_BODY"],
      description: "Section (id='at-stake') with a heavier emotional treatment — consider a warmer / heat-tinted background and a horizon-line ornament. Body text inside.",
    },
    {
      name: "how_to_help",
      label: "How to help",
      order: 6,
      tokens: ["ACTION_1", "ACTION_2", "ACTION_3", "ACTION_4"],
      description: "Four action cards (id='how-to-help') in a 2x2 grid. Each card carries one of the ACTION_n tokens. Consider distinct wireframe glyphs per card so the four actions are visually distinct even before reading.",
    },
    {
      name: "bibliography",
      label: "Bibliography",
      order: 7,
      tokens: ["BIBLIOGRAPHY"],
      description: "Bibliography section (id='sources') that will hold the bibliography HTML block.",
    },
  ];

  const tokenByName = new Map(tokens.map((t) => [t.name, t]));

  return {
    campaign,
    tokens,
    tokenByName,
    sections,
    projectName,
    locale,
    pageTitle: meta.title,
    pageDescription: meta.description.replace(/<[^>]+>/g, ""),
    pageKeywords: meta.keywords,
    hasBreakingNews: !!meta.breaking_news,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────────────────

const AESTHETIC_DIRECTION = `Aesthetic direction:
- Warm amber on near-black palette. Primary color = amber/orange. Background = warm near-black (NOT pure #000). Accent = sage green reserved only for source-tier badges.
- Outlined / wireframe geometric SVGs as decorative anchors (think wireframe pyramid, contour lines, terminal data panels).
- Mixed typography:
  - Display headlines: 'Space Grotesk', bold, tight letter-spacing.
  - Italic flourish (used sparingly, e.g. project name in nav): 'Newsreader' italic.
  - Body text: 'Inter'.
  - All monospace details (labels, citation chips, section marks): 'JetBrains Mono'.
- Section header pattern: a short mono-caps eyebrow line (e.g. "§ 02 / Key facts") above each section's display heading.
- Frames have subtle four-corner amber "crop marks" (terminal-readout motif).
- The page should feel like a cultural artifact — editorial, atmospheric, restrained — not a startup landing page.
- Mobile-responsive. Self-contained single HTML file. Tailwind via CDN is fine for utility classes.`;

const CITATION_RULES = `CITATION & TOKEN PRESERVATION (critical):
- Every {{TOKEN}} in the prompt MUST appear in the returned HTML, character-for-character, including the double curly braces.
- The wizard will replace each {{TOKEN}} with its real content after generation. Tokens are placeholders — you are designing the chrome around them, NOT writing copy for them.
- Tokens may appear inside text content, inside attributes, inside any element. Place them where the corresponding real content should sit.
- Do NOT paraphrase, summarize, translate, abbreviate, or modify any {{TOKEN}}. Do NOT add or remove tokens. Do NOT write your own copy where a token should go.
- If you cannot fit a token, design the page so the token still appears somewhere reasonable — never drop it.`;

/**
 * The initial structural prompt — generates the full page scaffold with
 * all tokens in their correct sections. Sent via project.generate().
 */
export function buildInitialPrompt(spec: SiteSpec): string {
  const sectionList = spec.sections
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const tokens = s.tokens
        .map((name) => {
          const t = spec.tokenByName.get(name);
          return t ? `      - ${t.placeholder} → ${t.promptHint}` : "";
        })
        .filter(Boolean)
        .join("\n");
      return `  ${s.order + 1}. ${s.label} (section "${s.name}")
     ${s.description}
     Tokens for this section:
${tokens}`;
    })
    .join("\n\n");

  return `Design a single-page advocacy site for the campaign "${spec.projectName}" (${spec.locale}).
Page title: "${spec.pageTitle}"

Sections, in order:

${sectionList}

${AESTHETIC_DIRECTION}

${CITATION_RULES}

DEVICE: desktop-first, mobile-responsive.

Return one complete self-contained HTML page with all the tokens above placed in their proper sections.`;
}

/**
 * Per-section refinement prompt — used by the auto-sequence (steps 2..N
 * after the initial generate()). Sent via screen.edit().
 */
export function buildSectionRefinePrompt(
  spec: SiteSpec,
  sectionName: string
): string {
  const section = spec.sections.find((s) => s.name === sectionName);
  if (!section) throw new Error(`Unknown section: ${sectionName}`);
  const tokens = section.tokens
    .map((name) => spec.tokenByName.get(name)?.placeholder)
    .filter(Boolean)
    .join(", ");

  return `Refine the visual treatment of the "${section.label}" section.

${section.description}

Make it more atmospheric and distinctive while keeping the rest of the page unchanged. Stay within the aesthetic direction (warm amber on near-black, mixed typography, outlined wireframe motifs).

${CITATION_RULES}

The following tokens must appear verbatim in this section after your edit: ${tokens}.`;
}

/**
 * User-injected prompt wrapper — wraps a Designer-textbox prompt with the
 * same token-preservation guardrails so users can't accidentally drop a
 * citation by asking Stitch to "rewrite" something.
 */
export function buildUserPrompt(spec: SiteSpec, userText: string): string {
  return `User design request: ${userText}

${CITATION_RULES}

The following tokens must still appear verbatim in the returned HTML: ${spec.tokens
    .filter((t) => t.required)
    .map((t) => t.placeholder)
    .join(", ")}.`;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  missing: string[];        // token names (not placeholders)
  presentCount: number;
  expectedCount: number;
}

/**
 * Check that every required token appears in the HTML at least once.
 * Returns the list of missing token names for surfacing in the UI.
 */
export function validateHtml(html: string, spec: SiteSpec): ValidationResult {
  const required = spec.tokens.filter((t) => t.required);
  const missing: string[] = [];
  for (const t of required) {
    if (!html.includes(t.placeholder)) {
      missing.push(t.name);
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    presentCount: required.length - missing.length,
    expectedCount: required.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Injection
// ─────────────────────────────────────────────────────────────────────────

/**
 * Replace every {{TOKEN}} in the Stitch HTML with its real content. Also
 * injects the design-system.css contents into the <head> so .cite-* and
 * .src-card classes used by the injected content style consistently, and
 * rewrites nav anchors that Stitch left as placeholder `href="#"` or
 * mis-cased hashes (e.g. `#key_facts` instead of `#key-facts`).
 */
export function injectHtml(html: string, spec: SiteSpec): string {
  let injected = html;

  // 1. Replace every token (including optional ones — no-op if not present)
  for (const t of spec.tokens) {
    // Use a global non-regex replace by splitting + joining to avoid
    // accidental regex interpretation of the placeholder string.
    injected = injected.split(t.placeholder).join(t.injectionHtml);
  }

  // 2. Inject design-system.css into <head> if not already present.
  const css = loadDesignSystemCss();
  if (css && !injected.includes("/* FRACTAL FRAMEWORK WIZARD")) {
    const styleBlock = `<style data-injected="fractal-design-system">\n${css}\n</style>`;
    if (injected.includes("</head>")) {
      injected = injected.replace("</head>", `${styleBlock}\n</head>`);
    } else {
      // No <head> — prepend to the document
      injected = `${styleBlock}\n${injected}`;
    }
  }

  // 3. Rewrite broken nav anchors. Stitch consistently produces nav <a>
  //    tags with placeholder href="#" or mis-spelled hashes that don't
  //    resolve to actual section IDs. Post-processing is more robust than
  //    fighting it in the prompt — we know which section IDs exist and
  //    can fuzzy-match by link text + href.
  injected = rewriteNavAnchors(injected);

  return injected;
}

// Canonical labels Stitch invents → our actual section IDs. Keys are
// uppercased, hyphens / spaces stripped, so a single lookup key normalizes
// "Key Facts", "key-facts", "KEY_FACTS", "key facts" to the same bucket.
//
// Vocabulary intentionally spans multiple issue domains (water, wildfire,
// housing, education, public health, civic engagement) so the rewriter
// doesn't degrade silently on non-water campaigns where Stitch invents
// topic-specific section labels.
const LABEL_TO_SECTION_ID: Record<string, string> = {
  // → about
  STRATEGY: "about", ABOUT: "about", OVERVIEW: "about", CONTEXT: "about",
  VACUUM: "about", BACKGROUND: "about", HISTORY: "about", STORY: "about",
  ORIGIN: "about", LEARN: "about", READ: "about", PRIMER: "about",

  // → key-facts
  FACTS: "key-facts", KEYFACTS: "key-facts", DATA: "key-facts",
  EVIDENCE: "key-facts", METRICS: "key-facts", KEYFINDINGS: "key-facts",
  NUMBERS: "key-facts", STATISTICS: "key-facts", STATS: "key-facts",
  FINDINGS: "key-facts", FACT: "key-facts",

  // → at-stake (consequences, threats)
  STAKES: "at-stake", IMPACT: "at-stake", ATSTAKE: "at-stake",
  IMPACTANALYSIS: "at-stake", CONSEQUENCES: "at-stake",
  WHATSATSTAKE: "at-stake", ECOLOGY: "at-stake", RISK: "at-stake",
  THREAT: "at-stake", THREATS: "at-stake", HARM: "at-stake",
  CRISIS: "at-stake",
  // wildfire
  FUEL: "at-stake", BLAZE: "at-stake", BURN: "at-stake", FLAME: "at-stake",
  // housing
  DISPLACEMENT: "at-stake", EVICTION: "at-stake", TENURE: "at-stake",
  HOMELESSNESS: "at-stake",
  // education
  DROPOUT: "at-stake", ATTAINMENT: "at-stake", ACHIEVEMENT: "at-stake",
  // public health
  OUTBREAK: "at-stake", MORBIDITY: "at-stake", CASES: "at-stake",
  MORTALITY: "at-stake",

  // → how-to-help (action layer)
  ACTION: "how-to-help", ACTIONS: "how-to-help", TAKEACTION: "how-to-help",
  HELP: "how-to-help", HOWTOHELP: "how-to-help", HOWTOHELPER: "how-to-help",
  ENGAGE: "how-to-help", PARTICIPATE: "how-to-help", VECTORS: "how-to-help",
  ADVOCACY: "how-to-help", ADVOCATE: "how-to-help", INTERVENE: "how-to-help",
  DONATE: "how-to-help", FUND: "how-to-help", GIVE: "how-to-help",
  CONTACT: "how-to-help", REACH: "how-to-help", SHARE: "how-to-help",
  AMPLIFY: "how-to-help", VOLUNTEER: "how-to-help", JOIN: "how-to-help",
  SIGN: "how-to-help", PETITION: "how-to-help", VOTE: "how-to-help",
  // wildfire
  EVACUATION: "how-to-help", EVAC: "how-to-help", PREPARE: "how-to-help",
  // housing
  LEASE: "how-to-help", RENT: "how-to-help", AFFORDABILITY: "how-to-help",
  // education
  ENROLLMENT: "how-to-help", TUTORING: "how-to-help", FUNDING: "how-to-help",
  // public health
  VACCINATION: "how-to-help", SCREENING: "how-to-help", ACCESS: "how-to-help",
  // civic engagement
  TURNOUT: "how-to-help", REGISTRATION: "how-to-help", BALLOT: "how-to-help",

  // → sources (bibliography / records)
  SOURCES: "sources", BIBLIOGRAPHY: "sources", REFERENCES: "sources",
  CITATIONS: "sources", ARCHIVE: "sources", DATASOURCES: "sources",
  RECORDS: "sources", DOCUMENTATION: "sources", FOOTNOTES: "sources",
  EVIDENCEBASE: "sources",

};

// Canonical section IDs the rewriter knows about, used by the substring
// fallback. Substring matching is case-insensitive against a normalized
// link-text key.
const KNOWN_SECTION_IDS: ReadonlyArray<{ id: string; substrings: string[] }> = [
  { id: "about", substrings: ["ABOUT", "CONTEXT", "STORY"] },
  { id: "key-facts", substrings: ["FACT", "DATA", "EVIDENCE", "STAT"] },
  { id: "at-stake", substrings: ["STAKE", "IMPACT", "RISK", "THREAT", "CRISIS"] },
  { id: "how-to-help", substrings: ["ACTION", "HELP", "ENGAGE", "DONATE", "JOIN"] },
  { id: "sources", substrings: ["SOURCE", "BIBLIO", "REFERENCE", "CITATION"] },
];

function normalizeLabel(s: string): string {
  return s.replace(/[^A-Za-z]/g, "").toUpperCase();
}

/**
 * Rewrite each `<a href="#something">LABEL</a>` whose hash doesn't already
 * resolve to a section in the DOM. Layered strategy:
 *   1. If `#x` is already a valid section ID, leave it alone.
 *   2. Try LABEL → LABEL_TO_SECTION_ID exact match (issue-agnostic
 *      vocabulary covering water/wildfire/housing/education/public-health/
 *      civic-engagement domains).
 *   3. Try `x` (the hash itself) → LABEL_TO_SECTION_ID or normalized ID
 *      lookup (handles `#key_facts` → `#key-facts`).
 *   4. Substring fallback: scan LABEL for known section-ID substrings.
 *      This catches inventions our exact-map missed.
 *   5. If nothing matches, leave the href as-is — don't break anything we
 *      can't confidently fix.
 */
function rewriteNavAnchors(html: string): string {
  // Snapshot of every id="..." in the document. Conservative regex —
  // catches the common case in Stitch's output. Skips id="" empties.
  const idMatches = html.matchAll(/\sid=["']([a-zA-Z0-9_\-]+)["']/g);
  const validIds = new Set<string>();
  for (const m of idMatches) {
    if (m[1]) validIds.add(m[1]);
  }
  if (validIds.size === 0) return html;

  // Build a normalized-ID lookup so "key_facts" / "KEY-FACTS" → "key-facts"
  const normalizedIdLookup = new Map<string, string>();
  for (const id of validIds) {
    normalizedIdLookup.set(normalizeLabel(id), id);
  }

  // Substring fallback — return the first known section ID whose
  // substring appears in the normalized link-text key.
  function substringFallback(labelKey: string): string | undefined {
    if (!labelKey) return undefined;
    for (const entry of KNOWN_SECTION_IDS) {
      if (!validIds.has(entry.id)) continue;
      for (const sub of entry.substrings) {
        if (labelKey.includes(sub)) return entry.id;
      }
    }
    return undefined;
  }

  // Replace every <a ... href="#..." ...>...</a> opening tag whose href
  // points to an invalid hash.
  return html.replace(
    /(<a\b[^>]*?\bhref=["'])#([^"']*)(["'][^>]*>)([^<]*)(?=<\/a>|<)/g,
    (match, before, currentHash, after, linkText) => {
      // Already valid? Leave alone.
      if (currentHash && validIds.has(currentHash)) return match;

      // Try linkText → canonical mapping first (most reliable signal)
      const labelKey = normalizeLabel(linkText);
      let target: string | undefined = LABEL_TO_SECTION_ID[labelKey];

      // Else try fuzzy hash → id (handles `#key_facts` → `#key-facts`)
      if (!target && currentHash) {
        const hashKey = normalizeLabel(currentHash);
        target =
          normalizedIdLookup.get(hashKey) ?? LABEL_TO_SECTION_ID[hashKey];
      }

      // Else try substring fallback on the link text.
      if (!target) {
        target = substringFallback(labelKey);
      }

      // Found nothing → leave as-is (could be a bare `#` footer link)
      if (!target || !validIds.has(target)) return match;

      return `${before}#${target}${after}${linkText}`;
    }
  );
}
