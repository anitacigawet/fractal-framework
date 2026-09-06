import assert from "node:assert/strict";
import test from "node:test";
import { CampaignProductionWork, productionOutputNamespace } from "../server/_core/productionWork";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("simultaneous stale-tab starts create one run and keep the campaign locked through completion", async () => {
  const coordinator = new CampaignProductionWork();
  const created = deferred<{ id: string }>();
  const work = deferred();
  let creates = 0;
  const start = () => coordinator.start("campaign", () => { creates++; return created.promise; }, () => work.promise, assert.fail);
  const first = start();
  await assert.rejects(start(), { code: "CONFLICT" });
  assert.equal(creates, 1);
  created.resolve({ id: "run-1" });
  assert.deepEqual(await first, { id: "run-1" });
  await assert.rejects(start(), { code: "CONFLICT" });
  await assert.rejects(coordinator.run("campaign", async () => "citation-backfill"), { code: "CONFLICT" });
  assert.equal(await coordinator.run("other-campaign", async () => "independent"), "independent");
  work.resolve();
  await settle();
  assert.equal(await coordinator.run("campaign", async () => "retry"), "retry");
});

test("setup and worker failures release the campaign so ordinary retries succeed", async () => {
  const coordinator = new CampaignProductionWork();
  await assert.rejects(coordinator.start("campaign", async () => { throw new Error("setup failed"); }, async () => {}, assert.fail), /setup failed/);
  const errors: unknown[] = [];
  await coordinator.start("campaign", async () => ({ id: "run-2" }), async () => { throw new Error("worker failed"); }, (error) => { errors.push(error); });
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(await coordinator.run("campaign", async () => "retry"), "retry");
  await assert.rejects(coordinator.run("campaign", async () => { throw new Error("backfill failed"); }), /backfill failed/);
  assert.equal(await coordinator.run("campaign", async () => "second retry"), "second retry");
});

test("every production and backfill run has an isolated output namespace", () => {
  assert.notEqual(productionOutputNamespace("run-1"), productionOutputNamespace("run-2"));
  assert.notEqual(productionOutputNamespace("run-1"), productionOutputNamespace("citations_run-1"));
  assert.throws(() => productionOutputNamespace("../other"), /Invalid production run ID/);
});
