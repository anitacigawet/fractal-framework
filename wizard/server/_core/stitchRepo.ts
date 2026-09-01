// Stitch-run persistence. Each row in `stitch_runs` is one Campaign's
// generative-visual-design lifecycle via Google Stitch: project creation,
// initial scaffold generate(), iterative edit() refinements (auto + user),
// validation, post-injection HTML, and final audit.
//
// Mirrors productionRepo.ts's pattern: row<->struct converter, create/get/
// update helpers, latest-for-campaign lookup.

import { nanoid } from "nanoid";
import { getDb, persist } from "./db";
import type {
  StitchEdit,
  StitchModelId,
  StitchRun,
  StitchRunStatus,
} from "../../shared/types";

interface StitchRunRow {
  id: string;
  campaign_id: string;
  created_at: number;
  updated_at: number;
  status: StitchRunStatus;
  progress: string;
  current_step: string | null;
  model_id: StitchModelId;
  stitch_project_id: string | null;
  stitch_design_system_id: string | null;
  scaffold_screen_id: string | null;
  current_screen_id: string | null;
  edits: string;
  injected_html: string | null;
  audit_result: string | null;
  session_url: string | null;
  queued_user_prompt: string | null;
  error: string | null;
}

function rowToRun(row: StitchRunRow): StitchRun {
  let edits: StitchEdit[] = [];
  try {
    edits = JSON.parse(row.edits);
  } catch {
    edits = [];
  }
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status,
    progress: row.progress,
    current_step: row.current_step ?? undefined,
    model_id: row.model_id,
    stitch_project_id: row.stitch_project_id ?? undefined,
    stitch_design_system_id: row.stitch_design_system_id ?? undefined,
    scaffold_screen_id: row.scaffold_screen_id ?? undefined,
    current_screen_id: row.current_screen_id ?? undefined,
    edits,
    injected_html: row.injected_html ?? undefined,
    audit_result: row.audit_result ?? undefined,
    session_url: row.session_url ?? undefined,
    queued_user_prompt: row.queued_user_prompt ?? undefined,
    error: row.error ?? undefined,
  };
}

export async function createStitchRun(
  campaignId: string,
  modelId: StitchModelId
): Promise<StitchRun> {
  const now = Date.now();
  const run: StitchRun = {
    id: nanoid(10),
    campaign_id: campaignId,
    created_at: now,
    updated_at: now,
    status: "pending",
    progress: "Queued",
    model_id: modelId,
    edits: [],
  };
  const db = await getDb();
  db.run(
    `INSERT INTO stitch_runs
       (id, campaign_id, created_at, updated_at, status, progress,
        current_step, model_id, stitch_project_id, stitch_design_system_id,
        scaffold_screen_id, current_screen_id, edits, injected_html,
        audit_result, session_url, error)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL)`,
    [
      run.id,
      run.campaign_id,
      run.created_at,
      run.updated_at,
      run.status,
      run.progress,
      run.model_id,
      JSON.stringify(run.edits),
    ]
  );
  persist();
  return run;
}

export async function getStitchRun(id: string): Promise<StitchRun | null> {
  const db = await getDb();
  const stmt = db.prepare("SELECT * FROM stitch_runs WHERE id = ?");
  try {
    stmt.bind([id]);
    if (!stmt.step()) return null;
    return rowToRun(stmt.getAsObject() as unknown as StitchRunRow);
  } finally {
    stmt.free();
  }
}

export async function getLatestStitchRunForCampaign(
  campaignId: string
): Promise<StitchRun | null> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT * FROM stitch_runs WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT 1"
  );
  try {
    stmt.bind([campaignId]);
    if (!stmt.step()) return null;
    return rowToRun(stmt.getAsObject() as unknown as StitchRunRow);
  } finally {
    stmt.free();
  }
}

export async function updateStitchRun(
  id: string,
  patch: Partial<Omit<StitchRun, "id" | "campaign_id" | "created_at">>
): Promise<StitchRun> {
  const existing = await getStitchRun(id);
  if (!existing) throw new Error(`Stitch run ${id} not found`);

  const updated: StitchRun = {
    ...existing,
    ...patch,
    id: existing.id,
    campaign_id: existing.campaign_id,
    created_at: existing.created_at,
    updated_at: Date.now(),
  };

  const db = await getDb();
  db.run(
    `UPDATE stitch_runs SET
       updated_at = ?,
       status = ?,
       progress = ?,
       current_step = ?,
       model_id = ?,
       stitch_project_id = ?,
       stitch_design_system_id = ?,
       scaffold_screen_id = ?,
       current_screen_id = ?,
       edits = ?,
       injected_html = ?,
       audit_result = ?,
       session_url = ?,
       queued_user_prompt = ?,
       error = ?
     WHERE id = ?`,
    [
      updated.updated_at,
      updated.status,
      updated.progress,
      updated.current_step ?? null,
      updated.model_id,
      updated.stitch_project_id ?? null,
      updated.stitch_design_system_id ?? null,
      updated.scaffold_screen_id ?? null,
      updated.current_screen_id ?? null,
      JSON.stringify(updated.edits),
      updated.injected_html ?? null,
      updated.audit_result ?? null,
      updated.session_url ?? null,
      updated.queued_user_prompt ?? null,
      updated.error ?? null,
      id,
    ]
  );
  persist();
  return updated;
}

export async function appendStitchEdit(
  id: string,
  edit: StitchEdit
): Promise<StitchRun> {
  const existing = await getStitchRun(id);
  if (!existing) throw new Error(`Stitch run ${id} not found`);
  return updateStitchRun(id, { edits: [...existing.edits, edit] });
}
