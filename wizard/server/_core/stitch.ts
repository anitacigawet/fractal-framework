// Stitch SDK wrapper + pipeline driver.
//
// Pipeline shape (scaffold-first iterative):
//   Step 0: project.generate(buildInitialPrompt(spec))    → scaffold screen
//   Step 1..N: screen.edit(buildSectionRefinePrompt(spec, sectionName)) for
//              each section in the auto-sequence
//   Validation runs after every Stitch API call: if any required {{TOKEN}}
//   is missing, retry 2x. On the third failure, surface State D in the UI.
//   User-injected edits (Designer textbox) get the same validation gate.
//
// The pipeline runs as a fire-and-forget background task (same pattern as
// production.ts's runProductionPipeline). The Campaign UI polls the run row
// for progress.

import { getCampaign } from "./campaignRepo";
import {
  appendStitchEdit,
  getStitchRun,
  updateStitchRun,
} from "./stitchRepo";
import {
  buildInitialPrompt,
  buildSectionRefinePrompt,
  buildSiteSpec,
  buildUserPrompt,
  injectHtml,
  validateHtml,
  type SiteSpec,
} from "./siteScaffold";
import { resolveStitchApiKey, resolveStitchModel } from "./settings";
import type {
  StitchEdit,
  StitchModelId,
  StitchRun,
} from "../../shared/types";

// ── Auto-sequence definition ────────────────────────────────────────────
// Sections refined in order after the initial scaffold pass. The header is
// excluded because it is part of the initial structural pass.
const AUTO_SECTION_ORDER = [
  "hero",
  "breaking",
  "key_facts",
  "about",
  "at_stake",
  "how_to_help",
  "bibliography",
];

// ── In-memory abort tracking ────────────────────────────────────────────
// Per-run cancel signals. If a run is cancelled, the next step in the
// pipeline checks this map and exits cleanly.
const _cancelled = new Set<string>();

export function markCancelled(runId: string): void {
  _cancelled.add(runId);
}

export function isCancelled(runId: string): boolean {
  return _cancelled.has(runId);
}

export function clearCancelled(runId: string): void {
  _cancelled.delete(runId);
}

// ── SDK lazy loader ─────────────────────────────────────────────────────
// The SDK is dynamic-imported so the wizard doesn't crash on boot if the
// module fails to resolve. Returns the SDK + a fresh client (caller owns
// closing it).

interface SdkBundle {
  StitchToolClient: any;
  Stitch: any;
}

async function loadSdk(): Promise<SdkBundle> {
  const mod = await import("@google/stitch-sdk");
  return {
    StitchToolClient: mod.StitchToolClient,
    Stitch: mod.Stitch,
  };
}

async function createSdkClient(): Promise<{
  client: any;
  sdk: any;
  close: () => Promise<void>;
}> {
  const apiKey = resolveStitchApiKey();
  if (!apiKey) throw new Error("STITCH_API_KEY is not configured");
  const { StitchToolClient, Stitch } = await loadSdk();
  const client = new StitchToolClient({ apiKey });
  const sdk = new Stitch(client);
  return {
    client,
    sdk,
    close: async () => {
      try {
        await client.close();
      } catch {
        // ignore
      }
    },
  };
}

// ── Fetch helper ────────────────────────────────────────────────────────
// Screen.getHtml() returns a download URL; we GET it to retrieve the HTML.

async function fetchScreenHtml(screen: any): Promise<string> {
  const url: string = await screen.getHtml();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Stitch download URL returned ${res.status}: ${res.statusText}`
    );
  }
  return await res.text();
}

async function fetchScreenImage(screen: any): Promise<string | undefined> {
  try {
    return await screen.getImage();
  } catch {
    return undefined;
  }
}

// ── Single-pass runner with retry policy ────────────────────────────────
// Runs ONE Stitch API call (generate or edit) and validates the result.
// Retries up to MAX_RETRIES on validation failure, with progressively
// stronger token-preservation reminders appended to the prompt each time.
// On the final failure, throws — caller surfaces State D.

const MAX_RETRIES = 2;

interface PassParams {
  spec: SiteSpec;
  basePrompt: string;
  stepLabel: string;
  source: "auto" | "user";
  modelId: StitchModelId;
}

interface PassResult {
  screen: any;
  html: string;
  imageUrl?: string;
  edit: StitchEdit;
}

async function runInitialPass(
  project: any,
  params: PassParams,
  editIndex: number
): Promise<PassResult> {
  return runPassWithRetry(
    params,
    editIndex,
    async (prompt: string) => project.generate(prompt, "DESKTOP")
  );
}

async function runEditPass(
  screen: any,
  params: PassParams,
  editIndex: number
): Promise<PassResult> {
  return runPassWithRetry(params, editIndex, async (prompt: string) =>
    screen.edit(prompt, "DESKTOP", params.modelId)
  );
}

// Backoff schedule (ms) for retries when Stitch returns RATE_LIMITED.
// Each entry is the wait BEFORE the retry attempt at that index. Index 0 is
// the initial attempt (no wait); 1..3 wait progressively longer. Total
// elapsed wait across all retries is ~65 seconds, which is enough for
// most short rate-limit windows to clear.
const RATE_LIMIT_BACKOFF_MS = [0, 5_000, 15_000, 45_000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runPassWithRetry(
  params: PassParams,
  editIndex: number,
  fire: (prompt: string) => Promise<any>
): Promise<PassResult> {
  let lastErr: Error | null = null;
  let rateLimitedCount = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    const prompt =
      attempt === 0
        ? params.basePrompt
        : `${params.basePrompt}\n\nIMPORTANT (retry ${attempt}): your last response dropped or modified at least one {{TOKEN}}. Every {{TOKEN}} listed above MUST appear in the returned HTML character-for-character, including the double curly braces. Do not paraphrase, summarize, abbreviate, or remove any token.`;
    try {
      const screen = await fire(prompt);
      const html = await fetchScreenHtml(screen);
      const imageUrl = await fetchScreenImage(screen);
      const validation = validateHtml(html, params.spec);
      const edit: StitchEdit = {
        index: editIndex,
        source: params.source,
        step: params.stepLabel,
        prompt,
        screen_id: screen.screenId ?? screen.id ?? "",
        html_url: undefined, // download URL is single-use; we already fetched
        image_url: imageUrl,
        validation_ok: validation.ok,
        validation_missing: validation.missing,
        created_at: Date.now(),
        duration_ms: Date.now() - start,
      };
      if (validation.ok) {
        return { screen, html, imageUrl, edit };
      }
      lastErr = new Error(
        `Validation failed: ${validation.missing.length} token(s) missing — ${validation.missing.slice(0, 5).join(", ")}${validation.missing.length > 5 ? "..." : ""}`
      );
      // Don't return — fall through to retry. Edit is recorded only on success
      // or on final failure (via the throw below).
    } catch (e) {
      const err = e as Error & { code?: string };
      lastErr = err;
      // Auth / permission failures are non-recoverable — fail fast.
      if (err.code === "AUTH_FAILED" || err.code === "PERMISSION_DENIED") {
        break;
      }
      // Rate limit — wait progressively before retrying (5s → 15s → 45s).
      // We bound to MAX_RETRIES+1 total attempts; if we've already retried
      // MAX_RETRIES times the for-loop exits and we throw.
      if (err.code === "RATE_LIMITED") {
        rateLimitedCount += 1;
        const waitIdx = Math.min(rateLimitedCount, RATE_LIMIT_BACKOFF_MS.length - 1);
        const wait = RATE_LIMIT_BACKOFF_MS[waitIdx];
        console.warn(
          `[stitch] rate-limited; waiting ${wait / 1000}s before retry ${rateLimitedCount}`
        );
        if (attempt < MAX_RETRIES) await sleep(wait);
      }
      // Other transient errors (NETWORK_ERROR, UNKNOWN_ERROR, etc.) — fall
      // through to retry immediately.
    }
  }
  throw lastErr ?? new Error("Stitch pass failed after retries");
}

// ── Pipeline driver ─────────────────────────────────────────────────────
// Fire-and-forget. Caller does `void runStitchPipeline(runId)` after
// creating the run row. Mutates the row as it progresses; surfaces errors
// onto the row.

export async function runStitchPipeline(runId: string): Promise<void> {
  let sdkContext: {
    client: any;
    sdk: any;
    close: () => Promise<void>;
  } | null = null;

  const setError = async (message: string) => {
    try {
      await updateStitchRun(runId, {
        status: "error",
        progress: "Failed",
        error: message,
      });
    } catch (e) {
      console.error(`[stitch-run ${runId}] failed to record error:`, e);
    }
  };

  try {
    const run = await getStitchRun(runId);
    if (!run) throw new Error(`Stitch run ${runId} not found`);

    const campaign = await getCampaign(run.campaign_id);
    if (!campaign) throw new Error(`Campaign ${run.campaign_id} not found`);
    if (!campaign.outputs || Object.keys(campaign.outputs).length === 0) {
      throw new Error(
        "Campaign has no production outputs yet — run site content production first."
      );
    }

    const spec = buildSiteSpec(campaign);
    const modelId = run.model_id;

    // Build SDK + project
    await updateStitchRun(runId, {
      status: "generating",
      progress: "Creating Stitch project...",
      current_step: "create_project",
    });

    sdkContext = await createSdkClient();
    const projectResult: any = await sdkContext.client.callTool("create_project", {
      title: `${spec.projectName} — ${campaign.id}`,
    });
    // Stitch's MCP server returns the resource name like "projects/12345..."
    // in the `name` field — the SDK's high-level project(id) expects the
    // bare ID (no prefix). Strip it. Also accept the wrapped shape
    // (projectId/id/project_id) for forward-compatibility.
    const rawName: string | undefined =
      projectResult?.name ??
      projectResult?.projectName ??
      projectResult?.project?.name;
    const projectId: string | undefined =
      projectResult?.projectId ??
      projectResult?.project_id ??
      (rawName ? rawName.replace(/^projects\//, "") : undefined) ??
      projectResult?.id;
    if (!projectId) {
      throw new Error(
        `Stitch create_project did not return a project ID: ${JSON.stringify(
          projectResult
        )}`
      );
    }
    const project = sdkContext.sdk.project(projectId);

    await updateStitchRun(runId, {
      stitch_project_id: projectId,
      session_url: `https://stitch.withgoogle.com/projects/${projectId}`,
      progress: "Generating initial structural scaffold...",
      current_step: "scaffold",
    });

    if (isCancelled(runId)) throw new Error("Cancelled by user");

    // ── Step 0: initial generate() ───────────────────────────────────────
    const scaffoldResult = await runInitialPass(
      project,
      {
        spec,
        basePrompt: buildInitialPrompt(spec),
        stepLabel: "scaffold",
        source: "auto",
        modelId,
      },
      0
    );
    await appendStitchEdit(runId, scaffoldResult.edit);
    await updateStitchRun(runId, {
      scaffold_screen_id: scaffoldResult.edit.screen_id,
      current_screen_id: scaffoldResult.edit.screen_id,
    });

    if (isCancelled(runId)) throw new Error("Cancelled by user");

    // ── Steps 1..N: per-section refinement ───────────────────────────────
    await updateStitchRun(runId, {
      status: "refining",
      progress: "Refining sections...",
    });

    // Filter section list to those that actually exist in the spec
    // (breaking only present if hasBreakingNews; etc.)
    const sectionsInSpec = new Set(spec.sections.map((s) => s.name));
    const targetSections = AUTO_SECTION_ORDER.filter((n) =>
      sectionsInSpec.has(n)
    );

    let currentScreen: any = scaffoldResult.screen;
    let editIndex = 1;
    const skippedSections: string[] = [];

    for (const sectionName of targetSections) {
      if (isCancelled(runId)) throw new Error("Cancelled by user");
      const section = spec.sections.find((s) => s.name === sectionName)!;
      await updateStitchRun(runId, {
        current_step: sectionName,
        progress: `Refining ${section.label}...`,
      });

      try {
        const refineResult = await runEditPass(
          currentScreen,
          {
            spec,
            basePrompt: buildSectionRefinePrompt(spec, sectionName),
            stepLabel: sectionName,
            source: "auto",
            modelId,
          },
          editIndex
        );
        await appendStitchEdit(runId, refineResult.edit);
        await updateStitchRun(runId, {
          current_screen_id: refineResult.edit.screen_id,
        });
        currentScreen = refineResult.screen;
      } catch (e) {
        // One flaky refinement pass shouldn't kill the whole run. Record a
        // synthetic failed-edit (so the UI shows the skip) and continue with
        // the last successful screen. The user can re-target the section
        // via the Designer textbox after the sequence completes.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[stitch-run ${runId}] section "${sectionName}" failed; skipping: ${msg}`
        );
        skippedSections.push(sectionName);
        const failedEdit: StitchEdit = {
          index: editIndex,
          source: "auto",
          step: `failed:${sectionName}`,
          prompt: buildSectionRefinePrompt(spec, sectionName),
          screen_id: "",
          validation_ok: false,
          validation_missing: [msg.slice(0, 200)],
          created_at: Date.now(),
        };
        await appendStitchEdit(runId, failedEdit);
      }
      editIndex += 1;
    }

    // ── Awaiting state — user can inject Designer-textbox prompts or
    //    trigger inject() to finalize. We don't auto-inject so the user has
    //    a chance to refine before locking in.
    const awaitingProgress =
      skippedSections.length > 0
        ? `Auto-sequence finished. ${
            targetSections.length - skippedSections.length
          }/${targetSections.length} section refinements applied; ${
            skippedSections.length
          } skipped (${skippedSections.join(
            ", "
          )}). The remaining design is usable — refine further or inject.`
        : "Auto-sequence complete. Refine further or inject final content.";
    await updateStitchRun(runId, {
      status: "awaiting",
      current_step: undefined,
      progress: awaitingProgress,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[stitch-run ${runId}] error:`, message);
    await setError(message);
  } finally {
    if (sdkContext) await sdkContext.close();
    clearCancelled(runId);
  }
}

// ── User-injected edit (Designer textbox) ───────────────────────────────
// Runs one edit() pass with user text, validated. Synchronous from the
// caller's perspective — returns the new run state when done.

export async function applyUserEdit(
  runId: string,
  userText: string
): Promise<StitchRun> {
  const run = await getStitchRun(runId);
  if (!run) throw new Error(`Stitch run ${runId} not found`);
  if (run.status === "generating" || run.status === "refining") {
    throw new Error(
      "The auto-sequence is still running. Wait for it to finish or cancel before injecting your own prompt."
    );
  }
  if (!run.current_screen_id) {
    throw new Error("No screen to edit yet — scaffold step has not completed.");
  }
  const campaign = await getCampaign(run.campaign_id);
  if (!campaign) throw new Error(`Campaign ${run.campaign_id} not found`);
  const spec = buildSiteSpec(campaign);

  const sdkContext = await createSdkClient();
  try {
    const project = sdkContext.sdk.project(run.stitch_project_id);
    const screen = await project.getScreen(run.current_screen_id);

    await updateStitchRun(runId, {
      status: "refining",
      progress: `Applying your prompt...`,
      current_step: `user:${userText.slice(0, 40)}`,
    });

    const result = await runEditPass(
      screen,
      {
        spec,
        basePrompt: buildUserPrompt(spec, userText),
        stepLabel: `user:${userText.slice(0, 80)}`,
        source: "user",
        modelId: run.model_id,
      },
      run.edits.length
    );
    await appendStitchEdit(runId, result.edit);
    const updated = await updateStitchRun(runId, {
      current_screen_id: result.edit.screen_id,
      status: "awaiting",
      current_step: undefined,
      progress: "Your prompt applied. Refine further or inject final content.",
      // Clear any queued prompt — we just consumed (a version of) it.
      queued_user_prompt: undefined,
    });
    return updated;
  } finally {
    await sdkContext.close();
  }
}

// ── Inject + audit ──────────────────────────────────────────────────────
// Wizard-side token injection (no Stitch call). Optionally runs a final
// audit query against Stitch on the FINAL HTML to verify each section's
// content occupies its expected slot. The audit is observability-only —
// failure does not block the run from completing.

export async function injectAndAudit(runId: string): Promise<StitchRun> {
  const run = await getStitchRun(runId);
  if (!run) throw new Error(`Stitch run ${runId} not found`);
  if (!run.current_screen_id) {
    throw new Error("No screen to inject — scaffold step has not completed.");
  }
  const campaign = await getCampaign(run.campaign_id);
  if (!campaign) throw new Error(`Campaign ${run.campaign_id} not found`);
  const spec = buildSiteSpec(campaign);

  await updateStitchRun(runId, {
    status: "injecting",
    progress: "Injecting content into the design...",
    // Backfill session_url for runs created before that field was wired
    session_url:
      run.session_url ??
      (run.stitch_project_id
        ? `https://stitch.withgoogle.com/projects/${run.stitch_project_id}`
        : undefined),
  });

  // Re-fetch the latest screen's HTML so we have the most recent visual.
  const sdkContext = await createSdkClient();
  let injected: string;
  let auditResult: string | undefined;
  try {
    const project = sdkContext.sdk.project(run.stitch_project_id);
    const screen = await project.getScreen(run.current_screen_id);
    const html = await fetchScreenHtml(screen);
    const validation = validateHtml(html, spec);
    if (!validation.ok) {
      throw new Error(
        `Pre-injection validation failed: ${validation.missing.length} token(s) missing.`
      );
    }
    injected = injectHtml(html, spec);
  } finally {
    await sdkContext.close();
  }

  // Audit step — non-blocking. We don't make another Stitch call here for
  // simplicity; in a future revision this can run a Stitch query on the
  // FINAL HTML to verify section-slot mapping.
  auditResult = `Local audit: ${spec.tokens.length} tokens resolved, ${
    spec.tokens.filter((t) => t.required).length
  } required tokens validated before injection.`;

  return updateStitchRun(runId, {
    status: "complete",
    progress: "Site design complete.",
    current_step: undefined,
    injected_html: injected,
    audit_result: auditResult,
  });
}

// ── Resolved model — picked at run-creation time so a settings change
//    mid-run doesn't switch models on us.
export function pickModelForNewRun(): StitchModelId {
  return resolveStitchModel();
}
