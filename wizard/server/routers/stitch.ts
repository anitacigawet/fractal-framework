// tRPC router for Google Stitch generative visual design.
//
// Pattern mirrors production.ts: `start` creates a run row + kicks off a
// fire-and-forget background pipeline; the UI polls `latestForCampaign`
// for progress. Distinct surfaces because Stitch generation is a separate
// concern from content production — the same Campaign can have many
// stitch_runs while sharing one production_runs row.

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getCampaign } from "../_core/campaignRepo";
import {
  createStitchRun,
  getLatestStitchRunForCampaign,
  getStitchRun,
  updateStitchRun,
} from "../_core/stitchRepo";
import {
  applyUserEdit,
  injectAndAudit,
  isCancelled,
  markCancelled,
  pickModelForNewRun,
  runStitchPipeline,
} from "../_core/stitch";
import { resolveStitchApiKey } from "../_core/settings";
import { buildSiteSpec } from "../_core/siteScaffold";

export const stitchRouter = router({
  // The auto-sequence + section labels — UI uses this to render the
  // step-progress list. Keep in sync with AUTO_SECTION_ORDER in stitch.ts.
  stepList: publicProcedure.query(() => [
    { key: "scaffold", label: "Structural scaffold" },
    { key: "hero", label: "Hero" },
    { key: "breaking", label: "Breaking-news banner" },
    { key: "key_facts", label: "Key facts" },
    { key: "about", label: "About" },
    { key: "at_stake", label: "What's at stake" },
    { key: "how_to_help", label: "How to help" },
    { key: "bibliography", label: "Bibliography" },
  ]),

  // Latest run for a campaign — primary UI poll target.
  latestForCampaign: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(({ input }) => getLatestStitchRunForCampaign(input.campaignId)),

  // The token spec for a campaign — used by the UI to show what tokens
  // will be validated. Read-only.
  spec: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
      const spec = buildSiteSpec(campaign);
      return {
        tokenCount: spec.tokens.length,
        requiredTokenCount: spec.tokens.filter((t) => t.required).length,
        sectionCount: spec.sections.length,
      };
    }),

  start: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(async ({ input }) => {
      const apiKey = resolveStitchApiKey();
      if (!apiKey) {
        throw new Error(
          "STITCH_API_KEY is not configured. Set it on the Settings page first."
        );
      }
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
      if (!campaign.outputs || Object.keys(campaign.outputs).length === 0) {
        throw new Error(
          "Run site content production first — Stitch needs the 6 sections to design around."
        );
      }
      const run = await createStitchRun(input.campaignId, pickModelForNewRun());
      void runStitchPipeline(run.id);
      return { id: run.id };
    }),

  // Designer textbox — applies a user prompt as an edit() with the same
  // validation gate. Synchronous; returns the updated run.
  applyUserEdit: publicProcedure
    .input(
      z.object({
        runId: z.string(),
        prompt: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ input }) => {
      return applyUserEdit(input.runId, input.prompt);
    }),

  // Designer textbox used during the auto-sequence — stashes the user's
  // prompt without firing it. The textbox pre-fills with this value when
  // the run reaches `awaiting` so the user can review, edit, then send
  // (no surprise auto-application of mid-generation thoughts).
  queueUserPrompt: publicProcedure
    .input(
      z.object({
        runId: z.string(),
        prompt: z.string().max(1000),
      })
    )
    .mutation(async ({ input }) => {
      const run = await getStitchRun(input.runId);
      if (!run) throw new Error(`Stitch run ${input.runId} not found`);
      return updateStitchRun(input.runId, {
        queued_user_prompt: input.prompt.trim() || undefined,
      });
    }),

  // Cancel an in-flight auto-sequence. Sets a flag the pipeline checks
  // between steps. The run will exit cleanly on the next step boundary.
  cancel: publicProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ input }) => {
      const run = await getStitchRun(input.runId);
      if (!run) throw new Error(`Stitch run ${input.runId} not found`);
      if (run.status === "complete" || run.status === "error") {
        return { cancelled: false as const, reason: "already finished" };
      }
      markCancelled(input.runId);
      // Optimistically update the row so the UI sees the cancellation
      // before the pipeline's next check-in.
      await updateStitchRun(input.runId, {
        progress: "Cancelling at the next step boundary...",
      });
      return { cancelled: true as const };
    }),

  // Check cancellation state — debug surface for the UI.
  cancellationState: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ input }) => ({ cancelled: isCancelled(input.runId) })),

  // Finalize: replace tokens with real content + inject design-system CSS.
  // Transitions the run to "complete" with injected_html populated.
  inject: publicProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ input }) => {
      return injectAndAudit(input.runId);
    }),

  // Preview iframe source. Returns the post-injection HTML when complete,
  // otherwise the latest screen's HTML un-injected (so the user can see the
  // visual evolution mid-sequence). When neither is available, returns null.
  previewHtml: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      const run = await getStitchRun(input.runId);
      if (!run) throw new Error(`Stitch run ${input.runId} not found`);
      if (run.injected_html) {
        return { html: run.injected_html, injected: true as const };
      }
      return { html: null, injected: false as const };
    }),
});
