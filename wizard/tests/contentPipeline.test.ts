import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberedItems } from "../server/_core/numberedItems";
import { renderSite } from "../server/_core/siteTemplate";
import { buildSiteSpec, injectHtml, validateHtml } from "../server/_core/siteScaffold";
import { injectSlots, validateSlots, type HtmlSlot } from "../server/_core/htmlSlots";
import type { Campaign } from "../shared/types";

const campaign: Campaign = {
  id: "synthetic-content", created_at: 1, updated_at: 1, stage: "preview", title: "Fixture campaign",
  project_name: "Fixture campaign", locale: "", outputs: {
    meta: "1. **Page title**: Fixture title\n2. **Meta description**: Metadata first.\nMetadata continuation.\n3. **Three SEO keywords**: fixtures, testing, civic\n4. **Breaking-news banner**: First update.\nContinued update [NEWS_SOURCE_Page1_Claim].",
    hero: "1. **Headline**: Fixture headline\n2. **Subhead**: Hero first claim.\nHero continued claim [HERO_SOURCE_Page2_Claim].\n\nHero second paragraph [HERO_SOURCE_Page3_Claim].\n3. **Primary call-to-action label**: Read the facts",
    about: "About fixture [ABOUT_SOURCE_Page4_Claim].\n\nAbout second paragraph.",
    key_facts: "1. First fact.\nFact continuation [FACT_SOURCE_Page5_Claim].\n2. Second fact [FACT_SOURCE_Page6_Claim].\n3. Third fact.\nFinal fact continuation [FACT_SOURCE_Page7_Claim].",
    at_stake: "Stakes fixture [STAKES_SOURCE_Page8_Claim].",
    how_to_help: "1. First action.\nAction continuation [ACTION_SOURCE_Page9_Claim].\n2. Second action.\n3. Third action.\n4. Fourth action.\nFinal action continuation [ACTION_SOURCE_Page10_Claim].",
  },
};

function scaffold(): string {
  const spec = buildSiteSpec(campaign);
  return `<!doctype html><html><head><title>{{PROJECT_NAME}}</title></head><body>${spec.tokens.map((slot) => `<div>${slot.placeholder}</div>`).join("")}<footer>{{PROJECT_NAME}}</footer></body></html>`;
}

test("numbered bodies retain physical lines, paragraphs, CRLF, and final-item citations", () => {
  const text = "Preamble\r\n1. **Headline**: First\r\ncontinued [A_Page1_Claim]\r\n\r\nparagraph\r\n2)\r\nLast\r\ncontinued [B_Page2_Claim]";
  assert.deepEqual(parseNumberedItems(text), [
    { number: 1, body: "First\r\ncontinued [A_Page1_Claim]\r\n\r\nparagraph" },
    { number: 2, body: "Last\r\ncontinued [B_Page2_Claim]" },
  ]);
  assert.equal(parseNumberedItems("1. **42 households** are affected.")[0].body, "**42 households** are affected.");
});

test("default and Stitch output both retain multiline claims and their inline citations", () => {
  const spec = buildSiteSpec(campaign);
  const normal = renderSite(campaign);
  assert.equal(validateHtml(scaffold(), spec).ok, true);
  const stitched = injectHtml(scaffold(), spec);
  for (const html of [normal, stitched]) {
    for (const claim of ["Hero continued claim", "Hero second paragraph", "Fact continuation", "Final fact continuation", "Action continuation", "Final action continuation", "Continued update"]) assert.ok(html.includes(claim), claim);
    for (const key of ["HERO_SOURCE_Page2_Claim", "HERO_SOURCE_Page3_Claim", "FACT_SOURCE_Page5_Claim", "FACT_SOURCE_Page7_Claim", "ACTION_SOURCE_Page9_Claim", "ACTION_SOURCE_Page10_Claim", "NEWS_SOURCE_Page1_Claim"]) {
      assert.ok(html.includes(`class="cite-k" title="${key} — source not resolved"`), key);
    }
  }
});

test("every token in a comment fails both validation and injection", () => {
  const spec = buildSiteSpec(campaign);
  const html = `<html><body><!-- ${spec.tokens.map((slot) => slot.placeholder).join(" ")} --></body></html>`;
  const result = validateHtml(html, spec);
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, spec.tokens.length);
  assert.throws(() => injectHtml(html, spec), /Template slot validation failed/);
});

test("body slots reject hidden, raw-text, attribute, foreign, and incompatible injection contexts", () => {
  const spec = buildSiteSpec(campaign);
  const token = "{{ABOUT_BODY}}";
  const cases = [
    `<div hidden>${token}</div>`, `<div hidden="until-found">${token}</div>`, `<div aria-hidden="true">${token}</div>`,
    `<div style="display: none">${token}</div>`, `<div style="visibility:hidden">${token}</div>`, `<div style="opacity:0">${token}</div>`,
    `<div class="hidden">${token}</div>`, `<div class="sr-only">${token}</div>`,
    `<style>.gone { display:none }</style><div class="gone">${token}</div>`,
    `<div hidden><div>${token}</div></div>`, `<details><summary>Open</summary><div>${token}</div></details>`,
    `<script>${token}</script>`, `<style>${token}</style>`, `<template><div>${token}</div></template>`,
    `<textarea>${token}</textarea>`, `<svg><text>${token}</text></svg>`,
    `<div title="${token}"></div>`, `<p>${token}</p>`, `<span>${token}</span>`, `<div>Surrounding ${token} text</div>`,
  ];
  for (const replacement of cases) {
    const html = scaffold().replace(`<div>${token}</div>`, replacement);
    assert.equal(validateHtml(html, spec).ok, false, replacement);
    assert.throws(() => injectHtml(html, spec), /Template slot validation failed/, replacement);
  }
  spec.tokenByName.get("HERO_SUBHEAD")!.injectionHtml += '<a href="https://example.test/source">Linked source</a>';
  assert.equal(validateHtml(scaffold().replace("<div>{{HERO_SUBHEAD}}</div>", "<a href='/'>{{HERO_SUBHEAD}}</a>"), spec).ok, false);
});

test("missing, duplicate, unknown and parser-discarded tokens fail, while repeated project names and empty locale remain valid", () => {
  const spec = buildSiteSpec(campaign);
  assert.equal(validateHtml(scaffold(), spec).ok, true);
  assert.ok(validateHtml(scaffold().replace("{{FACT_1}}", ""), spec).missing.includes("FACT_1"));
  assert.ok(validateHtml(scaffold().replace("{{FACT_1}}", "{{FACT_1}}{{FACT_1}}"), spec).duplicate.includes("FACT_1"));
  assert.ok(validateHtml(scaffold().replace("</body>", "<div>{{UNKNOWN_SLOT}}</div></body>"), spec).unknown.includes("UNKNOWN_SLOT"));
  assert.equal(validateHtml(scaffold().replace("</body>", "<{{FACT_1}}></{{FACT_1}}></body>"), spec).ok, false);
  assert.ok(validateHtml(scaffold().replace("<div>{{PROJECT_NAME}}</div>", "").replace("<footer>{{PROJECT_NAME}}</footer>", ""), spec).missing.includes("PROJECT_NAME"));
});

test("declared metadata slots are escaped as text and cannot satisfy body roles", () => {
  const slots: HtmlSlot[] = [
    { name: "PAGE_TITLE", placeholder: "{{PAGE_TITLE}}", kind: "title", role: "document_title", required: true, injectionHtml: "A &amp; B &lt;/title&gt;" },
    { name: "PAGE_DESCRIPTION", placeholder: "{{PAGE_DESCRIPTION}}", kind: "label", role: "meta_description", required: true, injectionHtml: "&quot; onload=&quot;fixture &lt;script&gt;" },
  ];
  const html = '<html><head><title>{{PAGE_TITLE}}</title><meta name="description" content="{{PAGE_DESCRIPTION}}"></head><body></body></html>';
  assert.equal(validateSlots(html, slots).ok, true);
  const result = injectSlots(html, slots);
  assert.ok(result.includes("<title>A &amp; B &lt;/title&gt;</title>"));
  assert.ok(result.includes('content="&quot; onload=&quot;fixture <script>"'));
  assert.equal(validateSlots(html.replace('name="description"', 'name="unrelated"'), slots).ok, false);
});

test("DOM injection does not interpret newly injected text as another template slot", () => {
  const spec = buildSiteSpec(campaign);
  spec.tokenByName.get("PROJECT_NAME")!.injectionHtml = "Literal {{FACT_1}} &amp; &lt;em&gt;";
  const html = injectHtml(scaffold(), spec);
  assert.ok(html.includes("Literal {{FACT_1}} &amp; &lt;em&gt;"));
  spec.tokenByName.get("PROJECT_NAME")!.injectionHtml = "Literal {{PROJECT_NAME}}";
  const metadata = injectHtml(scaffold().replace("</head>", '<meta property="og:site_name" content="{{PROJECT_NAME}} {{PROJECT_NAME}}"></head>'), spec);
  assert.ok(metadata.includes('content="Literal {{PROJECT_NAME}} Literal {{PROJECT_NAME}}"'));
});
