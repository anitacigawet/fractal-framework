import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { parse } from "dotenv";
import { pythonCommand, runBridge } from "../server/_core/bridge";
import { bridgeHealth } from "../server/_core/bridgeHealth";
import { CancellableWork } from "../server/_core/cancellableWork";

test("sample empty interpreter and whitespace select defaults; explicit paths remain intact", () => {
  const sample = parse(readFileSync(new URL("../.env.example",import.meta.url)));
  assert.equal(pythonCommand(sample.BRIDGE_PYTHON,"win32"),"py");
  assert.equal(pythonCommand("  ","linux"),"python3");
  assert.equal(pythonCommand(" C:/Python 3/python.exe ","win32"),"C:/Python 3/python.exe");
});

test("bridge cancellation kills the worker and waits for its close", async () => {
  const controller = new AbortController();
  const child = Object.assign(new EventEmitter(), {stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{killed=true;return true;}});
  let killed = false;
  let finished = false;
  const fakeSpawn = (() => child) as unknown as Parameters<typeof runBridge>[1];
  const result = runBridge({args:["synthetic"],signal:controller.signal},fakeSpawn).then(r=>{finished=true;return r;});
  controller.abort();
  await Promise.resolve();
  assert.equal(killed,true);
  assert.equal(finished,false);
  child.emit("close",null);
  assert.equal((await result).exitCode,-3);
  let spawned = false;
  await assert.rejects(runBridge({args:[],signal:controller.signal},(()=>{spawned=true;return child;}) as typeof fakeSpawn));
  assert.equal(spawned,false);
});

test("normal bridge completion preserves stdout and argv", async () => {
  const child = Object.assign(new EventEmitter(), {stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  const fakeSpawn = ((file:string,args:string[],options:{shell:boolean}) => {
    assert.ok(file.length>0);
    assert.deepEqual(args,["-m","notebooklm_bridge.runner","status","--force"]);
    assert.equal(options.shell,false);
    return child;
  }) as unknown as Parameters<typeof runBridge>[1];
  const result = runBridge({args:["status","--force"]},fakeSpawn);
  child.stdout.write("Auth: valid\n");
  child.emit("close",0);
  assert.equal((await result).stdout,"Auth: valid\n");
});

test("cancellation stops an actual inert OS worker before resolving", { timeout: 10000 }, async () => {
  const controller = new AbortController();
  let worker: ReturnType<typeof spawn> | undefined;
  const inertSpawn = (() => {
    worker = spawn(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return worker;
  }) as typeof spawn;
  try {
    const result = await runBridge({
      args: [], signal: controller.signal,
      onStdoutLine: line => { if (line === "ready") controller.abort(); },
      timeoutMs: 5000,
    }, inertSpawn);
    assert.equal(result.exitCode, -3);
    assert.equal(result.timedOut, false);
    assert.ok(worker?.pid);
    assert.throws(() => process.kill(worker!.pid!, 0), { code: "ESRCH" });
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill();
  }
});

test("valid success is healthy, while failures and unknown success stay distinguishable", () => {
  assert.equal(bridgeHealth({exitCode:0,stdout:"Auth: valid\n",stderr:""}).status,"ok");
  assert.equal(bridgeHealth({exitCode:0,stdout:"Auth: ok\n",stderr:""}).status,"ok");
  assert.equal(bridgeHealth({exitCode:1,stdout:"Auth: missing\n",stderr:""}).status,"unconfigured");
  assert.equal(bridgeHealth({exitCode:1,stdout:"Auth: valid\n",stderr:"failure"}).status,"bad");
  assert.equal(bridgeHealth({exitCode:0,stdout:"Auth: invalid\n",stderr:""}).status,"warn");
});

test("task cancellation waits for persistence; completed and failed tasks release ownership", async () => {
  const tasks = new CancellableWork();
  let complete!:()=>void;
  let sawAbort = false;
  const persistence = new Promise<void>(resolve=>{complete=resolve;});
  const work = tasks.start("fixture",async signal=>{
    signal.addEventListener("abort",()=>{sawAbort=true;},{once:true});
    await persistence;
  });
  await Promise.resolve();
  assert.throws(()=>tasks.start("fixture",async()=>{}),/already active/);
  let ack = false;
  const stopped = tasks.cancel("fixture").then(r=>{ack=true;return r;});
  await Promise.resolve();
  assert.equal(sawAbort,true);assert.equal(ack,false);
  complete();await work;assert.equal(await stopped,true);
  assert.equal(await tasks.cancel("fixture"),false);
  await assert.rejects(tasks.start("failure",async()=>{throw Error("fixture failure");}),/fixture failure/);
  await tasks.start("failure",async()=>{});
});
