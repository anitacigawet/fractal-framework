// Framework-run persistence. Each row in `framework_runs` is one "Pick for me"
// pipeline invocation: a translate -> research -> identify chain that progresses
// asynchronously in the background. The wizard frontend polls the row's status.
//
// Status transitions:
//   pending      -> translating -> researching -> identifying -> complete
//                                                              \-> error (from any prior stage)

import { nanoid } from "nanoid";
import { getDb, persist } from "./db";

export type FrameworkRunStatus =
  | "pending"
  | "translating"
  | "researching"
  | "identifying"
  | "complete"
  | "error";

export interface FrameworkRun {
  id: string;
  created_at: number;
  updated_at: number;
  status: FrameworkRunStatus;
  location: string;
  mode: "deep" | "fast";
  progress: string;
  research_query?: string;
  notebook_id?: string;
  proposal?: string; // JSON-encoded CampaignLockProposal-ish (with rationale + source_summary)
  error?: string;
}

interface FrameworkRunRow {
  id: string;
  created_at: number;
  updated_at: number;
  status: FrameworkRunStatus;
  location: string;
  mode: "deep" | "fast";
  progress: string;
  research_query: string | null;
  notebook_id: string | null;
  proposal: string | null;
  error: string | null;
}

function rowToRun(row: FrameworkRunRow): FrameworkRun {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status,
    location: row.location,
    mode: row.mode,
    progress: row.progress,
    research_query: row.research_query ?? undefined,
    notebook_id: row.notebook_id ?? undefined,
    proposal: row.proposal ?? undefined,
    error: row.error ?? undefined,
  };
}

export async function createFrameworkRun(
  location: string,
  mode: "deep" | "fast"
): Promise<FrameworkRun> {
  const now = Date.now();
  const run: FrameworkRun = {
    id: nanoid(10),
    created_at: now,
    updated_at: now,
    status: "pending",
    location,
    mode,
    progress: "Queued",
  };
  const db = await getDb();
  db.run(
    "INSERT INTO framework_runs (id, created_at, updated_at, status, location, mode, progress, research_query, notebook_id, proposal, error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)",
    [run.id, run.created_at, run.updated_at, run.status, run.location, run.mode, run.progress]
  );
  persist();
  return run;
}

export async function getFrameworkRun(id: string): Promise<FrameworkRun | null> {
  const db = await getDb();
  const stmt = db.prepare("SELECT * FROM framework_runs WHERE id = ?");
  try {
    stmt.bind([id]);
    if (!stmt.step()) return null;
    return rowToRun(stmt.getAsObject() as unknown as FrameworkRunRow);
  } finally {
    stmt.free();
  }
}

export async function updateFrameworkRun(
  id: string,
  patch: Partial<Omit<FrameworkRun, "id" | "created_at">>
): Promise<FrameworkRun> {
  const existing = await getFrameworkRun(id);
  if (!existing) throw new Error(`Framework run ${id} not found`);

  const updated: FrameworkRun = {
    ...existing,
    ...patch,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: Date.now(),
  };

  const db = await getDb();
  db.run(
    `UPDATE framework_runs SET
       updated_at = ?,
       status = ?,
       progress = ?,
       research_query = ?,
       notebook_id = ?,
       proposal = ?,
       error = ?
     WHERE id = ?`,
    [
      updated.updated_at,
      updated.status,
      updated.progress,
      updated.research_query ?? null,
      updated.notebook_id ?? null,
      updated.proposal ?? null,
      updated.error ?? null,
      id,
    ]
  );
  persist();
  return updated;
}
