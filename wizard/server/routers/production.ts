import { z } from "zod";

import { router, publicProcedure } from "../_core/trpc";
import { runBridge } from "../_core/bridge";
import {
  TRUST_SERVER_PERSONA_PATH,
  WIZARD_QUERIES_DIR,
  readBridgeOutputBody,
  campaignVarArgs,
  writeTmpPrompt,
  parseJsonLoose,
} from "../_core/bridgeUtils";
import { resolve } from "path";
import { getCampaign, updateCampaign } from "../_core/campaignRepo";
import {
  createProductionRun,
  getProductionRun,
  getLatestProductionRunForCampaign,
  updateProductionRun,
} from "../_core/productionRepo";
import type { CitationSource } from "../../shared/types";

// ─────────────────────────────────────────────────────────────────────────
// The six site-section queries the wizard runs against the Campaign's
// notebook (the per-location notebook from Pick-for-me, already populated
// with fresh research sources). Order matters — the UI shows them in this
// order as they complete.
// ─────────────────────────────────────────────────────────────────────────

export const WIZARD_QUERIES = [
  { key: "meta", file: "01_meta.md", label: "Page metadata" },
  { key: "hero", file: "02_hero.md", label: "Hero section" },
  { key: "about", file: "03_about.md", label: "About this campaign" },
  { key: "key_facts", file: "04_key_facts.md", label: "Key facts" },
  { key: "at_stake", file: "05_at_stake.md", label: "What's at stake" },
  { key: "how_to_help", file: "06_how_to_help.md", label: "How you can help" },
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Background pipeline — runs one Campaign's production phase
// ─────────────────────────────────────────────────────────────────────────

async function runProductionPipeline(runId: string): Promise<void> {
  const setError = async (message: string) => {
    try {
      await updateProductionRun(runId, {
        status: "error",
        progress: "Failed",
        error: message,
      });
    } catch (e) {
      console.error(`[production-run ${runId}] failed to record error:`, e);
    }
  };

  try {
    const run = await getProductionRun(runId);
    if (!run) throw new Error(`Production run ${runId} not found`);

    const campaign = await getCampaign(run.campaign_id);
    if (!campaign) throw new Error(`Campaign ${run.campaign_id} not found`);
    if (!campaign.notebook_id) {
      throw new Error(
        "This campaign has no notebook attached. The Pick-for-me flow normally links one; if this campaign was created without it, production needs a manual notebook setup (not yet supported)."
      );
    }
    if (!campaign.project_name || !campaign.project_mission || !campaign.locale) {
      throw new Error(
        "Campaign is missing locked fields (project_name / project_mission / locale). Lock the campaign first."
      );
    }

    const notebookId = campaign.notebook_id;
    const perRunCounty = `_production_${campaign.id}`;
    const varArgs = campaignVarArgs({
      PROJECT_NAME: campaign.project_name,
      PROJECT_MISSION: campaign.project_mission,
      LOCALE: campaign.locale,
      TIER_1_EXAMPLES: campaign.tier_examples?.tier_1,
      TIER_2_EXAMPLES: campaign.tier_examples?.tier_2,
      TIER_3_EXAMPLES: campaign.tier_examples?.tier_3,
    });

    // ── STEP 1: Reconfigure the notebook with the Trust Server persona ───
    // Pick-for-me left the Vacuum Identifier persona installed; we now swap
    // to the canonical Trust Server persona (queries/_persona.md) so the
    // site-section queries inherit hash-citation discipline + the Campaign's
    // own project framing.
    await updateProductionRun(runId, {
      status: "configuring",
      progress: "Configuring Trust Server persona on the notebook...",
    });

    const personaResult = await runBridge({
      args: [
        "phase-b",
        "--county",
        perRunCounty,
        "--notebook-id",
        notebookId,
        "--persona-path",
        TRUST_SERVER_PERSONA_PATH,
        ...varArgs,
      ],
      timeoutMs: 90_000,
    });
    if (personaResult.exitCode !== 0) {
      throw new Error(
        `Persona configuration failed (exit ${personaResult.exitCode}):\n${
          personaResult.stderr || personaResult.stdout
        }`
      );
    }

    // ── STEP 2: Run each site-section query in sequence ──────────────────
    await updateProductionRun(runId, {
      status: "generating",
      progress: "Generating site sections...",
    });

    const accumulated: Record<string, string> = {};

    for (const q of WIZARD_QUERIES) {
      await updateProductionRun(runId, {
        current_query: q.key,
        progress: `Generating ${q.label}...`,
      });

      const promptPath = resolve(WIZARD_QUERIES_DIR, q.file);
      const queryResult = await runBridge({
        args: [
          "query",
          "--county",
          perRunCounty,
          "--notebook-id",
          notebookId,
          "--prompt-path",
          promptPath,
          "--output-name",
          q.key,
          ...varArgs,
        ],
        timeoutMs: 240_000, // 4 min per section — generous
      });
      if (queryResult.exitCode !== 0) {
        throw new Error(
          `Query "${q.label}" failed (exit ${queryResult.exitCode}):\n${
            queryResult.stderr || queryResult.stdout
          }`
        );
      }

      const body = readBridgeOutputBody(perRunCounty, q.key);
      accumulated[q.key] = body;

      await updateProductionRun(runId, {
        outputs: { ...accumulated },
      });
    }

    // ── STEP 3: Resolve hash citations to actual source URLs ─────────────
    // Asks the notebook to map each unique citation it used to one of its
    // imported sources. Fuzzy-matches the LLM's descriptions to the actual
    // source titles (from `list-sources`) so we get URL-bearing entries the
    // template can render as hoverable / clickable links.
    await updateProductionRun(runId, {
      current_query: undefined,
      progress: "Resolving hash citations to source URLs...",
    });
    const citationSources = await resolveCitationSources(
      notebookId,
      perRunCounty,
      accumulated
    );

    // ── STEP 4: Persist outputs + citation map onto the Campaign ─────────
    await updateCampaign(campaign.id, {
      outputs: accumulated,
      citation_sources: citationSources,
      stage: "preview",
    });

    await updateProductionRun(runId, {
      status: "complete",
      progress: `Complete. ${Object.keys(citationSources).length} citations linked to sources.`,
      current_query: undefined,
      outputs: accumulated,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[production-run ${runId}] error:`, message);
    await setError(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Citation → source URL resolution
// ─────────────────────────────────────────────────────────────────────────

interface NotebookSource {
  id: string;
  title: string;
  url: string;
}

const TIER_TAGS = new Set(["TIER_1", "TIER_2", "TIER_3", "TIER_4"]);

// Patterns in source titles that suggest a NotebookLM-generated synthesis
// rather than an external primary source. NotebookLM Deep Research can
// auto-import its own synthesis report as a source, and downstream queries can
// then cite it, producing a self-referencing chain that does not survive
// editorial review.
//
// Heuristic: a NotebookLM-generated source has NO URL (real web sources do)
// AND its title fits one of these synthesis-y phrasings. We exclude any
// matching source from the citation-resolution pool, so even if such a
// source exists in the notebook, no citation chip on the generated site
// will resolve to it. The site will still render the citation as a bare
// chip without a tooltip URL — visually flagging that the resolution failed.
const SYNTHESIS_TITLE_PATTERNS: RegExp[] = [
  /\b(deep|fast)\s+research\b/i,
  /\bresearch\s+report\b/i,
  /\bresearch\s+summary\b/i,
  /\bresearch\s+overview\b/i,
  /\bsynthes(is|ized)\b/i,
  /\bdeep\s+dive\b/i,
  /^(report|summary|overview)\s*[-:]/i,
  /\bgenerated\s+(by|via)\b/i,
];

function looksLikeNotebookLmSynthesis(s: NotebookSource): boolean {
  // Real external sources should have a URL. NotebookLM-generated
  // synthesis sources don't.
  if (s.url && s.url.trim().length > 0) return false;
  if (!s.title) return false;
  return SYNTHESIS_TITLE_PATTERNS.some((re) => re.test(s.title));
}

async function resolveCitationSources(
  notebookId: string,
  perRunCounty: string,
  contentOutputs: Record<string, string>
): Promise<Record<string, CitationSource>> {
  // 1. List sources in the notebook
  const listResult = await runBridge({
    args: ["list-sources", "--notebook-id", notebookId],
    timeoutMs: 60_000,
  });
  if (listResult.exitCode !== 0) {
    console.warn(
      `[citation-resolve] list-sources failed (exit ${listResult.exitCode}); citations will render without URLs.\n${listResult.stderr || listResult.stdout}`
    );
    return {};
  }
  let sources: NotebookSource[];
  try {
    sources = JSON.parse(listResult.stdout) as NotebookSource[];
  } catch {
    console.warn(
      `[citation-resolve] list-sources output not parseable JSON; skipping URL resolution.`
    );
    return {};
  }
  if (!Array.isArray(sources) || sources.length === 0) return {};

  // Filter out any sources that look like NotebookLM-generated synthesis
  // (URL-less + synthesis-y title). See SYNTHESIS_TITLE_PATTERNS above.
  // These get excluded from the citation-resolution pool so generated-site
  // bibliography entries never link to NotebookLM's own summary.
  const filteredOut: NotebookSource[] = [];
  sources = sources.filter((s) => {
    if (looksLikeNotebookLmSynthesis(s)) {
      filteredOut.push(s);
      return false;
    }
    return true;
  });
  if (filteredOut.length > 0) {
    console.warn(
      `[citation-resolve] excluded ${filteredOut.length} source(s) that look like NotebookLM-generated synthesis (URL-less + synthesis-y title): ${filteredOut
        .map((s) => `"${s.title}"`)
        .join(", ")}`
    );
  }
  if (sources.length === 0) return {};

  // 2. Collect unique citations from outputs (excluding tier tags)
  const citationRe = /\[([A-Z][A-Za-z0-9_\-:.]+)\]/g;
  const uniqueCitations = new Set<string>();
  for (const text of Object.values(contentOutputs)) {
    let m: RegExpExecArray | null;
    const re = new RegExp(citationRe);
    while ((m = re.exec(text)) !== null) {
      if (!TIER_TAGS.has(m[1])) uniqueCitations.add(m[1]);
    }
  }
  if (uniqueCitations.size === 0) return {};
  const citationsList = Array.from(uniqueCitations);

  // 3. Ask the LLM to map each citation to a source title
  const sourcesList = sources
    .filter((s) => s.title)
    .map((s, i) => `${i + 1}. "${s.title}"`)
    .join("\n");
  const promptBody = `In the 6 site-section responses you generated above, here are every UNIQUE hash citation you used:

${citationsList.map((c, i) => `${i + 1}. [${c}]`).join("\n")}

And here are the sources currently in this notebook:

${sourcesList}

For each citation, identify which of these sources it refers to.

Output ONLY valid JSON in this exact shape:

{
  "CITATION_KEY_1": "source title (verbatim, or a recognizable substring)",
  "CITATION_KEY_2": "..."
}

Where CITATION_KEY is the citation text without the brackets (e.g., "WRRC_Mohave_County_Page20_AquiferDeficit"), and the value is the source title from the list above (or a substring that uniquely identifies it). I will fuzzy-match.

Skip TIER_1/TIER_2/TIER_3/TIER_4 — those are tier tags, not citation sources.

If a citation cannot be confidently matched to any source in the list, omit it.

No preamble. No markdown fences. Just the JSON object.`;

  const promptPath = writeTmpPrompt("resolve_citations", promptBody);
  const queryResult = await runBridge({
    args: [
      "query",
      "--county",
      perRunCounty,
      "--notebook-id",
      notebookId,
      "--prompt-path",
      promptPath,
      "--output-name",
      "resolve_citations",
    ],
    timeoutMs: 240_000,
  });
  if (queryResult.exitCode !== 0) {
    console.warn(
      `[citation-resolve] query failed (exit ${queryResult.exitCode}); citations will render without URLs.\n${queryResult.stderr || queryResult.stdout}`
    );
    return {};
  }

  let mapping: Record<string, string>;
  try {
    const body = readBridgeOutputBody(perRunCounty, "resolve_citations");
    mapping = parseJsonLoose(body) as Record<string, string>;
  } catch (e) {
    console.warn(
      `[citation-resolve] LLM response not parseable JSON; skipping URL resolution.`,
      e
    );
    return {};
  }

  // 4. Fuzzy-match each description to a real source, build the result
  const result: Record<string, CitationSource> = {};
  for (const [citationId, description] of Object.entries(mapping)) {
    if (typeof description !== "string" || !description) continue;
    const matched = findBestSourceMatch(description, sources);
    if (matched) {
      result[citationId] = { title: matched.title, url: matched.url };
    }
  }
  console.log(
    `[citation-resolve] linked ${Object.keys(result).length}/${citationsList.length} citations to source URLs`
  );
  return result;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

function findBestSourceMatch(
  description: string,
  sources: NotebookSource[]
): NotebookSource | null {
  const descTokens = tokenize(description);
  let best: { src: NotebookSource; score: number } | null = null;
  for (const src of sources) {
    if (!src.title || !src.url) continue;
    const srcTokens = tokenize(src.title);
    let score = 0;
    for (const t of descTokens) {
      if (srcTokens.has(t)) score++;
    }
    if (best === null || score > best.score) {
      best = { src, score };
    }
  }
  // Require at least 2 overlapping significant tokens to count as a match.
  // Lower threshold catches more but with more false positives.
  if (best && best.score >= 2) return best.src;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────

export const productionRouter = router({
  // The ordered list of queries the pipeline will run, for UI rendering of
  // progress (the frontend shows each section as it completes).
  queryList: publicProcedure.query(() =>
    WIZARD_QUERIES.map((q) => ({ key: q.key, label: q.label }))
  ),

  // Kick off a production run. Returns the run_id; the frontend polls
  // `latestForCampaign` (or `get`) for progress + outputs.
  start: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
      if (!campaign.notebook_id) {
        throw new Error(
          "This campaign has no notebook attached. Production needs one — create the campaign via Pick-for-me, or attach a notebook manually (not yet supported)."
        );
      }

      const run = await createProductionRun(input.campaignId);
      void runProductionPipeline(run.id);
      return { id: run.id };
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getProductionRun(input.id)),

  // Convenience: poll the latest run for a campaign (the Campaign overview
  // page uses this so it doesn't need to track run IDs separately).
  latestForCampaign: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(({ input }) => getLatestProductionRunForCampaign(input.campaignId)),

  // Returns the assembled HTML for a Campaign. The frontend's preview iframe
  // uses this via srcDoc. The HTTP /api/download route below serves the same
  // bytes for download.
  previewHtml: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
      // Lazy import to avoid pulling the template module into the bundle
      // unless a preview is requested.
      const { renderSite } = await import("../_core/siteTemplate");
      return { html: renderSite(campaign) };
    }),

  // Backfill citation→URL mappings for a Campaign that already has outputs
  // but was produced before the source-resolution step existed. Runs the
  // same resolveCitationSources logic without re-running the 6 content
  // queries. Useful for re-using existing production runs after a template
  // update.
  resolveCitations: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
      if (!campaign.notebook_id) {
        throw new Error("Campaign has no notebook attached.");
      }
      if (!campaign.outputs || Object.keys(campaign.outputs).length === 0) {
        throw new Error(
          "Campaign has no production outputs yet — run production first."
        );
      }
      const perRunCounty = `_production_${campaign.id}`;
      const citation_sources = await resolveCitationSources(
        campaign.notebook_id,
        perRunCounty,
        campaign.outputs
      );
      await updateCampaign(campaign.id, { citation_sources });
      return {
        linkedCount: Object.keys(citation_sources).length,
        citation_sources,
      };
    }),
});
