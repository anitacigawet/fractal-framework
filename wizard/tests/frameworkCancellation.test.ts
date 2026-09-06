import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as path from "node:path";
import ts from "typescript";
import { z } from "zod";
import { router, publicProcedure } from "../server/_core/trpc";
import { CancellableWork } from "../server/_core/cancellableWork";

test("actual framework router stops its bridge before acknowledging cancel and starts no later stage", async () => {
  let run: Record<string,unknown>|null = null;
  let bridgeCalls = 0;
  let bridgeStopped = false;
  let entered!:()=>void;
  const bridgeEntered = new Promise<void>(resolve=>{entered=resolve;});
  const forbidden = () => {throw Error("unexpected real operation");};
  const imports: Record<string,unknown> = {
    zod:{z},path,fs:{existsSync:forbidden},
    "../_core/cancellableWork":{CancellableWork},
    "../_core/trpc":{router,publicProcedure},
    "../_core/bridge":{BRIDGE_PATHS:{bridgeDir:"fixture"},startReauth:forbidden,confirmReauth:forbidden,runBridge:async ({signal}:{signal:AbortSignal})=>{
      bridgeCalls++;entered();
      await new Promise<void>(resolve=>signal.addEventListener("abort",()=>{bridgeStopped=true;resolve();},{once:true}));
      return {exitCode:-3,stdout:"",stderr:""};
    }},
    "../_core/settings":{resolveFrameworkNotebookId:()=>"fixture-notebook",setFrameworkNotebookId:forbidden},
    "../_core/frameworkRepo":{
      createFrameworkRun:async(location:string,mode:string)=>{run={id:"fixture",status:"pending",location,mode};return run;},
      getFrameworkRun:async()=>run,
      updateFrameworkRun:async(_id:string,patch:Record<string,unknown>)=>{run={...run,...patch};return run;},
    },
    "../_core/bridgeUtils":{DOCS_DIR:"fixture",FRAMEWORK_TRANSLATOR_PERSONA_PATH:"fixture",VACUUM_IDENTIFIER_PERSONA_PATH:"fixture",writeTmpPrompt:()=>"fixture",readBridgeOutputBody:forbidden,parseJsonLoose:forbidden,parseNotebookId:forbidden},
  };
  const source=readFileSync(new URL("../server/routers/bridge.ts",import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,console,require:(name:string)=>{
    if(!(name in imports)) throw Error("unapproved import "+name);
    return imports[name];
  }},{timeout:3000});
  const caller=(module.exports as {bridgeRouter:{createCaller:(context:object)=>any}}).bridgeRouter.createCaller({});
  await caller.startFrameworkRun({location:"Example",mode:"fast"});
  await bridgeEntered;
  const result=await caller.cancelFrameworkRun({id:"fixture"});
  assert.equal(result.status,"cancelled");
  assert.equal(bridgeStopped,true);
  assert.equal(bridgeCalls,1,"no create-notebook/research/identification call after cancel");
  assert.equal(result.proposal,undefined);
  assert.match(result.progress,/already accepted/);
  assert.equal((await caller.getFrameworkRun({id:"fixture"})).status,"cancelled");
  assert.equal((await caller.cancelFrameworkRun({id:"fixture"})).status,"cancelled");
});
