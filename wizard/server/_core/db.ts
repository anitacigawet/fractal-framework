// SQLite via sql.js — in-memory database backed by a file on disk.
// Single-user, single-process; every write triggers a full file dump.
// Acceptable for v1 (campaigns table is small; writes are rare relative
// to LLM calls). Drizzle migrations can replace the inline schema later.

import initSqlJs, { type Database } from "sql.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { env } from "./env";

let _raw: Database | null = null;
let _initPromise: Promise<Database> | null = null;

async function init(): Promise<Database> {
  const SQL = await initSqlJs();
  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  const fileExists = existsSync(env.DATABASE_PATH);
  const buf = fileExists ? new Uint8Array(readFileSync(env.DATABASE_PATH)) : undefined;
  const db = new SQL.Database(buf);

  db.run(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      stage TEXT NOT NULL,
      title TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);

  // Framework runs — the per-Pick-for-me job table. Each row is one
  // location-driven vacuum-identification pipeline (translate -> research ->
  // identify). Status transitions sequentially; the wizard polls this row
  // for progress. Background worker mutates the row as it advances.
  db.run(`
    CREATE TABLE IF NOT EXISTS framework_runs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      location TEXT NOT NULL,
      mode TEXT NOT NULL,
      progress TEXT NOT NULL,
      research_query TEXT,
      notebook_id TEXT,
      proposal TEXT,
      error TEXT
    );
  `);

  // Production runs — the per-Campaign job table for the site-generation
  // phase. Each row drives one Campaign's production pipeline (configure
  // Trust Server persona, then run the 6 wizard site-section queries against
  // the Campaign's notebook). The wizard polls this row for progress.
  db.run(`
    CREATE TABLE IF NOT EXISTS production_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      progress TEXT NOT NULL,
      current_query TEXT,
      outputs TEXT NOT NULL,
      error TEXT
    );
  `);

  // Stitch runs — the per-Campaign job table for Google Stitch generative
  // visual design. Each row holds the lifecycle of one Stitch session against
  // one Campaign: project creation, initial scaffold generate(), iterative
  // edit() refinements (auto + user), validation gate results, post-injection
  // HTML, and final audit. Wizard polls this row for progress.
  db.run(`
    CREATE TABLE IF NOT EXISTS stitch_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      progress TEXT NOT NULL,
      current_step TEXT,
      model_id TEXT NOT NULL,
      stitch_project_id TEXT,
      stitch_design_system_id TEXT,
      scaffold_screen_id TEXT,
      current_screen_id TEXT,
      edits TEXT NOT NULL,
      injected_html TEXT,
      audit_result TEXT,
      session_url TEXT,
      queued_user_prompt TEXT,
      error TEXT
    );
  `);

  // One-shot migration for stitch_runs.queued_user_prompt — added after
  // the initial table shipped. SQLite ALTER TABLE doesn't have IF NOT EXISTS
  // in all versions, so we just try the ALTER and ignore the error if the
  // column already exists. Pattern can be reused for future single-column
  // additions until/unless we adopt a real migration system.
  try {
    db.run(`ALTER TABLE stitch_runs ADD COLUMN queued_user_prompt TEXT`);
  } catch {
    /* column already exists */
  }

  _raw = db;
  persistRaw(db);
  return db;
}

export async function getDb(): Promise<Database> {
  if (_raw) return _raw;
  if (!_initPromise) _initPromise = init();
  return _initPromise;
}

function persistRaw(db: Database): void {
  const buf = db.export();
  writeFileSync(env.DATABASE_PATH, Buffer.from(buf));
}

export function persist(): void {
  if (_raw) persistRaw(_raw);
}
