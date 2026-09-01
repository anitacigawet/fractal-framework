import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../server/_core/router";
import type { Campaign, CampaignLockProposal, Message, StitchRun } from "../../../shared/types";

const now = Date.now();
const DEMO_CAMPAIGN_ID = "cedar-county-demo";

let frameworkStartedAt = 0;
let frameworkLocation = "Cedar County";
let productionStartedAt = 0;
let stitchStartedAt = 0;
let campaign: Campaign | null = null;

const settings = {
  activeProvider: "gemini",
  activeProviderFromEnv: false,
  providers: [
    { id: "gemini", displayName: "Google Gemini", model: "showroom", modelFromEnv: false, hasKey: false, keyFromEnv: false },
    { id: "openai", displayName: "OpenAI", model: "showroom", modelFromEnv: false, hasKey: false, keyFromEnv: false },
    { id: "deepseek", displayName: "DeepSeek", model: "showroom", modelFromEnv: false, hasKey: false, keyFromEnv: false },
  ],
  frameworkNotebookId: "showroom-framework",
  frameworkNotebookIdFromEnv: false,
  stitch: {
    hasKey: true,
    keyFromEnv: false,
    model: "GEMINI_3_FLASH",
    modelFromEnv: false,
    availableModels: ["GEMINI_3_FLASH", "GEMINI_3_PRO"],
    disclaimerDismissed: true,
  },
};

const proposal = {
  project_name: "Connect Cedar",
  project_mission:
    "Help families understand and improve the fictional county’s after-school transit gap.",
  locale: "Cedar County (fictional demonstration)",
  issue_type: "civic_engagement",
  tier_examples: {
    tier_1: "Fictional county transit plan and school-board minutes",
    tier_2: "Fictional regional reporting and university mobility study",
    tier_3: "Community organization interviews, clearly attributed",
  },
  rationale:
    "The demonstration research found a narrow, solvable gap: existing routes end before many after-school programs finish, while no public campaign currently joins the school and transit records into one readable case.",
  source_summary:
    "Five fictional placeholder records are represented: a county route schedule, two school-board minutes, a regional mobility study, and a community survey. No real-world claims are made in showroom mode.",
};

const queryList = [
  { key: "meta", label: "Page metadata" },
  { key: "hero", label: "Hero section" },
  { key: "about", label: "About this campaign" },
  { key: "key_facts", label: "Key facts" },
  { key: "at_stake", label: "What's at stake" },
  { key: "how_to_help", label: "How you can help" },
];

const outputs = {
  meta: "Title: Connect Cedar\nDescription: A fictional, source-cited campaign demonstration.",
  hero: "After-school opportunity should not end when the last bus leaves. [CEDAR_ROUTE_SCHEDULE_DEMO]",
  about: "Connect Cedar joins placeholder school and transit records into one readable case for a coordinated late route. [CEDAR_BOARD_MINUTES_DEMO]",
  key_facts: "Three fictional schools end activities after the placeholder route’s final departure. [CEDAR_MOBILITY_STUDY_DEMO]",
  at_stake: "Without a workable ride home, students can be excluded from tutoring, clubs, and school events. [CEDAR_COMMUNITY_SURVEY_DEMO]",
  how_to_help: "Review the demonstration evidence, ask what a pilot would require, and invite both agencies to one public planning session.",
};

const previewHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f5f0e7;color:#17231d}
  .demo{padding:10px 24px;background:#1e4c3a;color:#e8fff3;font:600 12px/1.4 ui-monospace,monospace;text-align:center}
  header{min-height:430px;padding:64px clamp(28px,8vw,110px);background:linear-gradient(135deg,#102f26,#245e46);color:#fff;display:flex;flex-direction:column;justify-content:end}
  .eyebrow{font:700 12px/1 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#b7e6cf}
  h1{font:800 clamp(48px,9vw,104px)/.88 Georgia,serif;margin:18px 0 24px;max-width:9ch}
  header p{font-size:20px;max-width:650px;line-height:1.5;color:#d7eee3}
  main{max-width:1040px;margin:auto;padding:70px 28px}section{padding:42px 0;border-top:1px solid #b8c4ba}
  h2{font:700 36px/1.05 Georgia,serif;margin:0 0 18px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  .fact{background:#fff;border:1px solid #c9d2ca;padding:24px;min-height:170px}.fact b{display:block;font-size:34px;color:#1e4c3a;margin-bottom:12px}
  p{font-size:17px;line-height:1.7}.cite{display:inline-block;padding:3px 7px;border-radius:999px;background:#dcebe2;color:#1e4c3a;font:700 10px/1.2 ui-monospace,monospace}
  .action{background:#e6b95f;padding:34px;border-radius:4px}footer{padding:30px;text-align:center;color:#5d6e63;font-size:13px}
  @media(max-width:700px){.grid{grid-template-columns:1fr}header{min-height:360px}h1{font-size:54px}}
</style></head><body>
<div class="demo">FICTIONAL SHOWROOM DATA · NO LIVE RESEARCH OR CLAIMS</div>
<header><div class="eyebrow">Connect Cedar · civic demonstration</div><h1>A later bus can open a longer day.</h1><p>A source-cited campaign prototype showing how a community can make one overlooked local barrier visible.</p></header>
<main>
<section><div class="eyebrow">The case</div><h2>Programs continue. The placeholder route does not.</h2><p>In this fictional example, after-school programs at three schools end after the final county departure. <span class="cite">CEDAR_ROUTE_SCHEDULE_DEMO</span> The campaign turns separate records into one question: what would a small late-route pilot require?</p></section>
<section><div class="grid"><div class="fact"><b>3</b>fictional schools included in the pilot area</div><div class="fact"><b>42 min</b>placeholder gap between activities and the final bus</div><div class="fact"><b>1 route</b>proposed for a reversible semester test</div></div></section>
<section><div class="eyebrow">Why it matters</div><h2>Transportation is part of access.</h2><p>A program is not equally available when a student has no safe way home. <span class="cite">CEDAR_COMMUNITY_SURVEY_DEMO</span> The proposed response is deliberately narrow: test one coordinated route, publish the ridership evidence, and decide from the results.</p></section>
<section class="action"><div class="eyebrow">A practical next step</div><h2>Put the school and transit planners in the same room.</h2><p>Review the demonstration records, agree on a proof threshold, and publish what the pilot learns.</p></section>
</main><footer>Generated by the Fractal Framework showroom · all names and data on this page are fictional.</footer>
</body></html>`;

function makeCampaign(input?: Partial<Campaign>): Campaign {
  return {
    id: DEMO_CAMPAIGN_ID,
    created_at: now,
    updated_at: Date.now(),
    stage: "research",
    title: "Connect Cedar",
    project_name: proposal.project_name,
    project_mission: proposal.project_mission,
    locale: proposal.locale,
    issue_type: proposal.issue_type,
    tier_examples: proposal.tier_examples,
    notebook_id: "showroom-research-notebook",
    messages: [],
    ...input,
  };
}

function frameworkRun() {
  const elapsed = Date.now() - frameworkStartedAt;
  const complete = elapsed >= 2600;
  const status = complete ? "complete" : elapsed < 900 ? "translating" : elapsed < 1800 ? "researching" : "identifying";
  const progress = complete
    ? "Proposal ready for review."
    : status === "translating"
      ? "Translating the location into a research question…"
      : status === "researching"
        ? "Reading the fictional source packet…"
        : "Comparing candidate local gaps…";
  return {
    id: "framework-demo-001",
    status,
    location: frameworkLocation,
    mode: "fast" as const,
    progress,
    research_query: `Which bounded, evidence-supported civic gap in ${frameworkLocation} could a small public campaign address?`,
    proposal: complete ? JSON.stringify(proposal) : undefined,
  };
}

function productionRun() {
  if (!productionStartedAt) return null;
  const complete = Date.now() - productionStartedAt >= 2800;
  if (complete && campaign) {
    campaign = { ...campaign, stage: "preview", outputs, updated_at: Date.now() };
  }
  return {
    id: "production-demo-001",
    campaign_id: DEMO_CAMPAIGN_ID,
    status: complete ? "complete" : "generating",
    progress: complete ? "Six cited site sections are ready." : "Generating source-cited site sections…",
    current_query: complete ? undefined : "key_facts",
    outputs: complete ? outputs : { meta: outputs.meta, hero: outputs.hero },
  };
}

function stitchRun(): StitchRun | null {
  if (!stitchStartedAt) return null;
  const complete = Date.now() - stitchStartedAt >= 2200;
  const edits = queryList.map((step, index) => ({
    index,
    source: "auto" as const,
    step: step.key,
    prompt: `Design the ${step.label.toLowerCase()} while preserving every citation token.`,
    screen_id: `showroom-screen-${index}`,
    validation_ok: true,
    validation_missing: [],
    created_at: now + index,
    duration_ms: 420,
  }));
  return {
    id: "stitch-demo-001",
    campaign_id: DEMO_CAMPAIGN_ID,
    created_at: now,
    updated_at: Date.now(),
    status: complete ? "complete" : "refining",
    progress: complete ? "Visual design complete." : "Refining the campaign sections…",
    current_step: complete ? undefined : "key_facts",
    model_id: "GEMINI_3_FLASH",
    current_screen_id: "showroom-screen-final",
    edits: complete ? edits : edits.slice(0, 3),
    injected_html: complete ? previewHtml : undefined,
    audit_result: complete ? "Citation-preservation audit passed: all fictional demonstration tokens remain present." : undefined,
  };
}

async function handle(path: string, input: any): Promise<any> {
  switch (path) {
    case "settings.get": return settings;
    case "settings.runHealthCheck": return {
      checks: [
        { key: "showroom", label: "Showroom adapter", status: "ok", message: "External services are intentionally disconnected." },
      ],
      overall: "ok",
      ranAt: new Date().toISOString(),
    };
    case "settings.validateProvider": return { ok: true, sample: "showroom" };
    case "settings.validateStitch": return { ok: true, projectCount: 1 };
    case "settings.setActiveProvider":
    case "settings.setProviderKey":
    case "settings.setProviderModel":
    case "settings.setStitchApiKey":
    case "settings.setStitchModel":
    case "settings.setStitchDisclaimerDismissed": return settings;

    case "campaigns.list": return campaign ? [campaign] : [];
    case "campaigns.get": return campaign?.id === input.id ? campaign : null;
    case "campaigns.createFromProposal":
      campaign = makeCampaign();
      return campaign;
    case "campaigns.create":
      campaign = makeCampaign({
        title: input.title,
        project_name: undefined,
        project_mission: undefined,
        locale: undefined,
        issue_type: undefined,
        tier_examples: undefined,
        notebook_id: undefined,
        stage: "intake",
      });
      return campaign;

    case "bridge.startFrameworkRun":
      frameworkStartedAt = Date.now();
      frameworkLocation = input.location;
      return { id: "framework-demo-001" };
    case "bridge.getFrameworkRun": return frameworkRun();
    case "bridge.status": return { ok: true, exitCode: 0, stdout: "Showroom adapter: external bridge disconnected", stderr: "", durationMs: 0, bridgeDir: "browser" };
    case "bridge.setupFrameworkNotebook": return { notebookId: "showroom-framework" };
    case "bridge.clearFrameworkNotebook": return { cleared: true };
    case "bridge.startReauth": return { spawned: false, note: "Showroom mode has no external account." };
    case "bridge.confirmReauth": return { confirmed: true, exitCode: 0, output: "Showroom mode" };

    case "intake.greet":
      if (campaign) campaign = { ...campaign, messages: [{ role: "assistant", content: "What local change do you want this campaign to make visible? This is a fictional showroom conversation." }] };
      return campaign;
    case "intake.sendMessage": {
      if (!campaign) return null;
      const messages: Message[] = [
        ...(campaign.messages ?? []),
        { role: "user", content: input.text },
        { role: "assistant", content: "That gives the campaign a concrete public question. I would frame it around one measurable pilot and keep every factual claim attached to the placeholder source packet." },
      ];
      campaign = { ...campaign, messages };
      return campaign;
    }
    case "intake.proposeLock": return proposal as CampaignLockProposal;
    case "intake.lock":
      campaign = makeCampaign({ ...(campaign ?? {}), ...input.proposal, stage: "research" });
      return campaign;

    case "production.queryList": return queryList;
    case "production.latestForCampaign": return productionRun();
    case "production.start":
      productionStartedAt = Date.now();
      return { id: "production-demo-001" };
    case "production.previewHtml": return { html: previewHtml };
    case "production.resolveCitations": return { linkedCount: 4 };

    case "stitch.stepList": return [
      { key: "scaffold", label: "Structural scaffold" },
      { key: "hero", label: "Hero" },
      { key: "key_facts", label: "Key facts" },
      { key: "about", label: "About" },
      { key: "at_stake", label: "What's at stake" },
      { key: "how_to_help", label: "How to help" },
    ];
    case "stitch.latestForCampaign": return stitchRun();
    case "stitch.start":
      stitchStartedAt = Date.now();
      return { id: "stitch-demo-001" };
    case "stitch.previewHtml": return { html: previewHtml, injected: true };
    case "stitch.cancel": return { cancelled: true };
    case "stitch.inject": return stitchRun();
    case "stitch.applyUserEdit":
    case "stitch.queueUserPrompt": return stitchRun();
    default: throw new Error(`Showroom adapter does not implement ${path}`);
  }
}

export function createDemoLink(): TRPCLink<AppRouter> {
  return () => ({ op }) =>
    observable((observer) => {
      const timer = window.setTimeout(() => {
        void handle(op.path, op.input)
          .then((data) => {
            observer.next({ result: { data } } as any);
            observer.complete();
          })
          .catch((error) => observer.error(error));
      }, op.type === "mutation" ? 420 : 80);
      return () => window.clearTimeout(timer);
    });
}
