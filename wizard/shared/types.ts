// Shared types between the wizard client and server.

export type Stage =
  | "intake"
  | "research"
  | "source_curation"
  | "production"
  | "preview"
  | "complete";

export interface TierExamples {
  tier_1: string;
  tier_2: string;
  tier_3: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Campaign {
  id: string;
  created_at: number;
  updated_at: number;
  stage: Stage;
  title: string;

  // Intake chat history (Phase 3).
  messages?: Message[];

  // Locked at intake-complete (Phase 3, second sub-commit).
  project_name?: string;
  project_mission?: string;
  locale?: string;
  issue_type?: string;
  tier_examples?: TierExamples;

  // Populated during Part 2 (Phases 4-7).
  notebook_id?: string;
  sources?: Source[];
  curated_source_ids?: string[];
  outputs?: Record<string, string>;
  // Maps each hash citation used on the site (e.g.
  // "WRRC_Mohave_County_Page20_AquiferDeficit") to the actual notebook source
  // it refers to. Populated by the production pipeline's source-resolution
  // step. The site template uses this to render citations as clickable links
  // with hover-tooltips showing the source title.
  citation_sources?: Record<string, CitationSource>;
}

export interface CitationSource {
  title: string;
  url: string;
}

export interface Source {
  id: string;
  url: string;
  title: string;
  snippet?: string;
  recommended_tier: 1 | 2 | 3 | 4;
  recommendation_note: string;
  user_decision: "accept" | "reject" | "pending";
}

// Issue-type taxonomy — shared between the intake LLM (which is told to pick
// from this list in its system prompt) and the wizard UI (which renders it
// as the dropdown in the Lock Campaign review panel). Keeping it as `string`
// on Campaign itself avoids hard-coupling — the LLM may suggest values outside
// the list, and the user can edit freely.
export const ISSUE_TYPES = [
  "water",
  "wildfire",
  "educational_equity",
  "housing",
  "public_health",
  "civic_engagement",
  "opioid_response",
  "rural_economic_revitalization",
  "other",
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

// Shape returned by intake.proposeLock and accepted by intake.lock — the
// structured Campaign fields extracted from the chat history. The user can
// edit these before confirming.
export interface CampaignLockProposal {
  project_name: string;
  project_mission: string;
  locale: string;
  issue_type: string;
  tier_examples: TierExamples;
}

// The Vacuum Identifier persona's JSON output for a per-location framework
// run. Extends CampaignLockProposal with rationale + source_summary so the
// user can see WHY the framework picked this vacuum and which sources it
// drew from. The wizard strips the extra fields before calling
// campaigns.createFromProposal (which accepts only the CampaignLockProposal
// shape).
export interface FrameworkRunProposal extends CampaignLockProposal {
  rationale?: string;
  source_summary?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Stitch types — Phase B (generative per-campaign visual design)
// ─────────────────────────────────────────────────────────────────────────

export type StitchModelId = "GEMINI_3_FLASH" | "GEMINI_3_PRO";

export type StitchRunStatus =
  | "pending"      // queued, not yet started
  | "generating"   // initial structural generate() in flight
  | "refining"    // auto-sequence of edit() calls in flight
  | "awaiting"     // sequence paused — waiting for user input
  | "injecting"    // wizard-side token replacement in flight
  | "auditing"     // final post-injection audit query in flight
  | "complete"     // injected_html ready to preview + download
  | "error";       // unrecoverable — see error field

// One step in a stitch run's edit history. Created on every generate() and
// edit() pass. Records the prompt fired, which Screen it produced, whether
// validation passed, and any missing tokens (for debugging State D).
export interface StitchEdit {
  index: number;                    // 0 = initial generate, 1+ = edits
  source: "auto" | "user";          // auto = wizard-driven sequence; user = textbox
  step: string;                     // e.g. "scaffold", "hero", "bibliography", "user:more atmospheric hero"
  prompt: string;                   // the actual text sent to Stitch
  screen_id: string;                // Stitch's screen ID for this pass
  html_url?: string;                // download URL (fetched lazily)
  image_url?: string;               // screenshot URL (for thumbnails)
  validation_ok: boolean;
  validation_missing: string[];     // tokens that should be present but aren't
  created_at: number;
  duration_ms?: number;             // wall-clock for this pass (Stitch API + validation)
}

export interface StitchRun {
  id: string;
  campaign_id: string;
  created_at: number;
  updated_at: number;
  status: StitchRunStatus;
  progress: string;                 // human-readable for the UI
  current_step?: string;            // matches StitchEdit.step when refining
  model_id: StitchModelId;
  stitch_project_id?: string;
  stitch_design_system_id?: string;
  scaffold_screen_id?: string;      // the very first Screen (from generate())
  current_screen_id?: string;       // latest Screen (after most recent edit())
  edits: StitchEdit[];
  injected_html?: string;           // post-injection HTML ready to serve
  audit_result?: string;            // text returned by the final audit query
  session_url?: string;             // Stitch web URL for "Continue in Stitch ↗"
  // User Designer-textbox prompt typed during the auto-sequence. Stashed
  // here so the user can keep designing in their head while the wizard
  // is mid-generation; the textbox pre-fills with this value the moment
  // the run reaches `awaiting`. Cleared after the user sends it (or
  // clears the textbox manually).
  queued_user_prompt?: string;
  error?: string;
}
