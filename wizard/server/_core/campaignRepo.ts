// Campaign persistence — thin repo over sql.js. The schema stores well-known
// columns (id, timestamps, stage, title) flat, and the rest of the Campaign
// object as JSON in a `data` column. v1 simplification; lets us evolve the
// Campaign shape without schema migrations.

import { nanoid } from "nanoid";
import type { Campaign, Stage, Message } from "../../shared/types";
import { getDb, persist } from "./db";

interface CampaignRow {
  id: string;
  created_at: number;
  updated_at: number;
  stage: Stage;
  title: string;
  data: string;
}

function rowToCampaign(row: CampaignRow): Campaign {
  const rest = JSON.parse(row.data) as Partial<Campaign>;
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stage: row.stage,
    title: row.title,
    ...rest,
  } as Campaign;
}

function rowFromResult(cols: string[], values: unknown[]): CampaignRow {
  const row: Record<string, unknown> = {};
  cols.forEach((c, i) => (row[c] = values[i]));
  return row as unknown as CampaignRow;
}

function campaignToDataJson(campaign: Campaign): string {
  // Strip the columns stored flat — everything else goes into `data`.
  const { id, created_at, updated_at, stage, title, ...rest } = campaign;
  return JSON.stringify(rest);
}

export async function createCampaign(title: string): Promise<Campaign> {
  const now = Date.now();
  const campaign: Campaign = {
    id: nanoid(10),
    created_at: now,
    updated_at: now,
    stage: "intake",
    title,
    messages: [],
  };
  const db = await getDb();
  db.run(
    "INSERT INTO campaigns (id, created_at, updated_at, stage, title, data) VALUES (?, ?, ?, ?, ?, ?)",
    [
      campaign.id,
      campaign.created_at,
      campaign.updated_at,
      campaign.stage,
      campaign.title,
      campaignToDataJson(campaign),
    ]
  );
  persist();
  return campaign;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const db = await getDb();
  const result = db.exec("SELECT * FROM campaigns ORDER BY updated_at DESC");
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((vals) => rowToCampaign(rowFromResult(columns, vals)));
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const db = await getDb();
  const stmt = db.prepare("SELECT * FROM campaigns WHERE id = ?");
  try {
    stmt.bind([id]);
    if (!stmt.step()) return null;
    const obj = stmt.getAsObject() as unknown as CampaignRow;
    return rowToCampaign(obj);
  } finally {
    stmt.free();
  }
}

export async function updateCampaign(
  id: string,
  patch: Partial<Campaign>
): Promise<Campaign> {
  const existing = await getCampaign(id);
  if (!existing) throw new Error(`Campaign ${id} not found`);

  const updated: Campaign = {
    ...existing,
    ...patch,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: Date.now(),
  };

  const db = await getDb();
  db.run(
    "UPDATE campaigns SET updated_at = ?, stage = ?, title = ?, data = ? WHERE id = ?",
    [
      updated.updated_at,
      updated.stage,
      updated.title,
      campaignToDataJson(updated),
      id,
    ]
  );
  persist();
  return updated;
}

export async function appendIntakeMessages(
  id: string,
  newMessages: Message[]
): Promise<Campaign> {
  const existing = await getCampaign(id);
  if (!existing) throw new Error(`Campaign ${id} not found`);
  return updateCampaign(id, {
    messages: [...(existing.messages ?? []), ...newMessages],
  });
}
