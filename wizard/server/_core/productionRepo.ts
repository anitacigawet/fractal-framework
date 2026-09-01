// Production-run persistence. Each row in `production_runs` is one campaign's
// site-generation pipeline invocation: configure Trust Server persona, then
// run the wizard's site-section queries against the campaign's notebook.

import { nanoid } from "nanoid";
import { getDb, persist } from "./db";

export type ProductionRunStatus =
  | "pending"
  | "configuring"
  | "generating"
  | "complete"
  | "error";

export interface ProductionRun {
  id: string;
  campaign_id: string;
  created_at: number;
  updated_at: number;
  status: ProductionRunStatus;
  progress: string;
  current_query?: string;
  outputs: Record<string, string>;
  error?: string;
}

interface ProductionRunRow {
  id: string;
  campaign_id: string;
  created_at: number;
  updated_at: number;
  status: ProductionRunStatus;
  progress: string;
  current_query: string | null;
  outputs: string;
  error: string | null;
}

function rowToRun(row: ProductionRunRow): ProductionRun {
  let outputs: Record<string, string> = {};
  try {
    outputs = JSON.parse(row.outputs);
  } catch {
    outputs = {};
  }
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status,
    progress: row.progress,
    current_query: row.current_query ?? undefined,
    outputs,
    error: row.error ?? undefined,
  };
}

export async function createProductionRun(
  campaignId: string
): Promise<ProductionRun> {
  const now = Date.now();
  const run: ProductionRun = {
    id: nanoid(10),
    campaign_id: campaignId,
    created_at: now,
    updated_at: now,
    status: "pending",
    progress: "Queued",
    outputs: {},
  };
  const db = await getDb();
  db.run(
    "INSERT INTO production_runs (id, campaign_id, created_at, updated_at, status, progress, current_query, outputs, error) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)",
    [
      run.id,
      run.campaign_id,
      run.created_at,
      run.updated_at,
      run.status,
      run.progress,
      JSON.stringify(run.outputs),
    ]
  );
  persist();
  return run;
}

export async function getProductionRun(
  id: string
): Promise<ProductionRun | null> {
  const db = await getDb();
  const stmt = db.prepare("SELECT * FROM production_runs WHERE id = ?");
  try {
    stmt.bind([id]);
    if (!stmt.step()) return null;
    return rowToRun(stmt.getAsObject() as unknown as ProductionRunRow);
  } finally {
    stmt.free();
  }
}

export async function getLatestProductionRunForCampaign(
  campaignId: string
): Promise<ProductionRun | null> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT * FROM production_runs WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT 1"
  );
  try {
    stmt.bind([campaignId]);
    if (!stmt.step()) return null;
    return rowToRun(stmt.getAsObject() as unknown as ProductionRunRow);
  } finally {
    stmt.free();
  }
}

export async function updateProductionRun(
  id: string,
  patch: Partial<Omit<ProductionRun, "id" | "campaign_id" | "created_at">>
): Promise<ProductionRun> {
  const existing = await getProductionRun(id);
  if (!existing) throw new Error(`Production run ${id} not found`);

  const updated: ProductionRun = {
    ...existing,
    ...patch,
    id: existing.id,
    campaign_id: existing.campaign_id,
    created_at: existing.created_at,
    updated_at: Date.now(),
  };

  const db = await getDb();
  db.run(
    `UPDATE production_runs SET
       updated_at = ?,
       status = ?,
       progress = ?,
       current_query = ?,
       outputs = ?,
       error = ?
     WHERE id = ?`,
    [
      updated.updated_at,
      updated.status,
      updated.progress,
      updated.current_query ?? null,
      JSON.stringify(updated.outputs),
      updated.error ?? null,
      id,
    ]
  );
  persist();
  return updated;
}
