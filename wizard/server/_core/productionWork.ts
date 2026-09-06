import { TRPCError } from "@trpc/server";

// The supported server is one process. Acquire before the first await so two
// stale browser tabs cannot both create work for the same campaign. Ownership
// lasts through final persistence, and failed setup/work always releases it.
export class CampaignProductionWork {
  private readonly active = new Set<string>();

  private acquire(campaignId: string): () => void {
    if (this.active.has(campaignId)) {
      throw new TRPCError({ code: "CONFLICT", message: "Production or citation resolution is already running for this campaign. Wait for it to finish, then retry." });
    }
    this.active.add(campaignId);
    return () => this.active.delete(campaignId);
  }

  async start<T>(campaignId: string, create: () => Promise<T>, work: (run: T) => Promise<void>, onError: (error: unknown) => void): Promise<T> {
    const release = this.acquire(campaignId);
    try {
      const run = await create();
      void Promise.resolve().then(() => work(run)).catch(onError).finally(release);
      return run;
    } catch (error) {
      release();
      throw error;
    }
  }

  async run<T>(campaignId: string, work: () => Promise<T>): Promise<T> {
    const release = this.acquire(campaignId);
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export function productionOutputNamespace(runId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error("Invalid production run ID");
  return `_production_${runId}`;
}
