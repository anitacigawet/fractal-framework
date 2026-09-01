import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getActiveProvider } from "../_core/llmProvider";
import { getIntakeSystemPrompt } from "../_core/methodology";
import {
  appendIntakeMessages,
  getCampaign,
  updateCampaign,
} from "../_core/campaignRepo";
import type { Message } from "../../shared/types";

// ─────────────────────────────────────────────────────────────────────────
// Lock Campaign extraction (used by Phase 3c — the chat-driven intake path
// on /campaign/:id/intake). The Pick-for-me path on Home uses a different
// pipeline via server/routers/bridge.ts — see startFrameworkRun there.
// ─────────────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Based on our conversation so far, please extract a Campaign object as JSON.

Output ONLY valid JSON in this exact shape:

{
  "project_name": "...",
  "project_mission": "...",
  "locale": "...",
  "issue_type": "water" | "wildfire" | "educational_equity" | "housing" | "public_health" | "civic_engagement" | "opioid_response" | "rural_economic_revitalization" | "other",
  "tier_examples": {
    "tier_1": "...",
    "tier_2": "...",
    "tier_3": "..."
  }
}

Field guidance:
- project_name: short and evocative (for example, "Protect Cedar Creek"). 2-4 words.
- project_mission: one paragraph (2-3 sentences) naming the specific regulatory/accountability vacuum and what the campaign exists to do about it.
- locale: the specific place — county, basin, district, etc.
- issue_type: pick the closest match from the enum.
- tier_examples: per Tier 1/2/3, the kinds of orgs or documents that would constitute the strongest, secondary, and investigative-journalism evidence FOR THIS SPECIFIC ISSUE (e.g., for water: USGS reports + state water-agency data + watchdog journalism).

If a field is unclear from the conversation, make your best inference. Keep values concise.

No preamble. No markdown fences. Just the JSON object.`;

// Some LLMs ignore "no markdown fences" — strip them defensively before parse.
function parseLockProposal(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  return JSON.parse(cleaned);
}

const lockProposalSchema = z.object({
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

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────

export const intakeRouter = router({
  sendMessage: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        text: z.string().min(1).max(8000),
      })
    )
    .mutation(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);

      const userMsg: Message = { role: "user", content: input.text };
      const history = campaign.messages ?? [];
      const withUser = [...history, userMsg];

      const provider = getActiveProvider();
      const result = await provider.invoke({
        messages: [
          { role: "system", content: getIntakeSystemPrompt() },
          ...withUser,
        ],
      });

      const assistantMsg: Message = { role: "assistant", content: result.text };
      const updated = await appendIntakeMessages(input.campaignId, [
        userMsg,
        assistantMsg,
      ]);

      return {
        reply: assistantMsg,
        campaign: updated,
      };
    }),

  greet: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
      if ((campaign.messages?.length ?? 0) > 0) {
        return { reply: campaign.messages![0], campaign };
      }

      const provider = getActiveProvider();
      const result = await provider.invoke({
        messages: [
          { role: "system", content: getIntakeSystemPrompt() },
          {
            role: "user",
            content: `Working title for this campaign: "${campaign.title}". Greet me and ask your first orienting question.`,
          },
        ],
      });

      const assistantMsg: Message = { role: "assistant", content: result.text };
      const updated = await appendIntakeMessages(input.campaignId, [
        assistantMsg,
      ]);

      return { reply: assistantMsg, campaign: updated };
    }),

  proposeLock: publicProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
      if ((campaign.messages?.length ?? 0) < 2) {
        throw new Error(
          "Have at least one back-and-forth with the guide before locking."
        );
      }

      const provider = getActiveProvider();
      const result = await provider.invoke({
        messages: [
          { role: "system", content: getIntakeSystemPrompt() },
          ...(campaign.messages ?? []),
          { role: "user", content: EXTRACTION_PROMPT },
        ],
      });

      let parsed: unknown;
      try {
        parsed = parseLockProposal(result.text);
      } catch {
        throw new Error(
          `LLM did not return parseable JSON. Try clarifying the conversation further, then try again.\n\nRaw response:\n${result.text}`
        );
      }

      const validated = lockProposalSchema.safeParse(parsed);
      if (!validated.success) {
        const missing = validated.error.issues
          .map((i) => i.path.join("."))
          .join(", ");
        throw new Error(
          `LLM JSON missing or invalid fields: ${missing}.\n\nRaw response:\n${result.text}`
        );
      }

      return validated.data;
    }),

  lock: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        proposal: lockProposalSchema,
      })
    )
    .mutation(async ({ input }) => {
      const campaign = await getCampaign(input.campaignId);
      if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);

      return updateCampaign(input.campaignId, {
        project_name: input.proposal.project_name,
        project_mission: input.proposal.project_mission,
        locale: input.proposal.locale,
        issue_type: input.proposal.issue_type,
        tier_examples: input.proposal.tier_examples,
        stage: "research",
      });
    }),
});
