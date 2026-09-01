import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  updateCampaign,
} from "../_core/campaignRepo";
import { getFrameworkRun } from "../_core/frameworkRepo";

const proposalSchema = z.object({
  project_name: z.string().min(1),
  project_mission: z.string().min(1),
  locale: z.string().min(1),
  issue_type: z.string().min(1),
  tier_examples: z.object({
    tier_1: z.string().min(1),
    tier_2: z.string().min(1),
    tier_3: z.string().min(1),
  }),
});

export const campaignsRouter = router({
  list: publicProcedure.query(() => listCampaigns()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getCampaign(input.id)),

  create: publicProcedure
    .input(z.object({ title: z.string().min(1).max(120) }))
    .mutation(({ input }) => createCampaign(input.title)),

  // Used by the "Pick for me" flow on Home: creates a Campaign with the locked
  // fields applied immediately and stage set to "research", skipping the
  // intake chat entirely. Title is taken from proposal.project_name.
  //
  // If frameworkRunId is provided, the per-location notebook_id from that run
  // is also copied onto the Campaign, so the production phase can reuse the
  // already-researched notebook rather than running research a second time.
  createFromProposal: publicProcedure
    .input(
      z.object({
        proposal: proposalSchema,
        frameworkRunId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      let notebookId: string | undefined;
      if (input.frameworkRunId) {
        const run = await getFrameworkRun(input.frameworkRunId);
        if (run?.notebook_id) notebookId = run.notebook_id;
      }
      const created = await createCampaign(input.proposal.project_name);
      return updateCampaign(created.id, {
        project_name: input.proposal.project_name,
        project_mission: input.proposal.project_mission,
        locale: input.proposal.locale,
        issue_type: input.proposal.issue_type,
        tier_examples: input.proposal.tier_examples,
        notebook_id: notebookId,
        stage: "research",
      });
    }),

  // Generic update for fields filled by later phases (title rename, stage
  // bump, project_name/mission lock, etc.). Phase-specific mutations live
  // in their own routers.
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        patch: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ input }) =>
      updateCampaign(input.id, input.patch as Record<string, unknown>)
    ),
});
