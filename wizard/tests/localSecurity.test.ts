import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { request as httpRequest } from "node:http";
import { localRequestGuard } from "../server/_core/localRequestGuard";
import { publicProcedure, router } from "../server/_core/trpc";
import { SitePreview } from "../client/src/components/SitePreview";

test("all local API transports enforce the configured origin before dispatch", async () => {
  const app = express();
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as {port:number}).port;
  const origin = `http://127.0.0.1:${port}`;
  let effects = 0;
  app.use(localRequestGuard(port));
  app.use(express.json());
  app.get("/api/health", (_req,res) => res.json({status:"ok"}));
  app.use("/trpc", createExpressMiddleware({
    router: router({ bump: publicProcedure.mutation(() => ++effects), read: publicProcedure.query(() => "fixture") }),
    createContext: () => ({}),
  }));
  const request = async (path: string, options: RequestInit = {}) => {
    const result = await fetch(origin + path, options);
    await result.text();
    return result.status;
  };
  try {
    assert.equal(await request("/api/health"), 200);
    assert.equal(await request("/trpc/read"), 200);
    const good = {Origin:origin,"Content-Type":"application/json"};
    assert.equal(await request("/trpc/bump", {method:"POST", headers:good, body:'{"json":null}'}), 200);
    assert.equal(await request("/trpc/bump,bump?batch=1", {method:"POST", headers:good, body:'{"0":{"json":null},"1":{"json":null}}'}), 200);
    assert.equal(effects, 3);
    for (const badOrigin of [undefined,"null","https://attacker.invalid",origin+"/",origin.replace(String(port),String(port+1))]) {
      const headers: Record<string,string> = {"Content-Type":"application/json","Sec-Fetch-Site":"same-origin"};
      if(badOrigin !== undefined) headers.Origin = badOrigin;
      assert.equal(await request("/trpc/bump", {method:"POST",headers,body:'{"json":null}'}),403);
    }
    for (const contentType of ["multipart/form-data; boundary=fixture", "application/octet-stream", "text/plain"]) {
      assert.equal(await request("/trpc/bump", {method:"POST",headers:{Origin:origin,"Content-Type":contentType},body:"fixture"}),415);
    }
    const form = new FormData(); form.set("dummy","fixture");
    assert.equal(await request("/trpc/bump", {method:"POST",headers:{Origin:"null","Sec-Fetch-Site":"cross-site"},body:form}),403);
    assert.equal(await request("/trpc/read", {headers:{Origin:"null"}}),403);
    assert.equal(await request("/trpc/read", {headers:{"Sec-Fetch-Site":"cross-site"}}),403);
    // fetch may normalize Host; use the HTTP interface to send it verbatim.
    const forgedHost = await new Promise<number|undefined>((resolve,reject) => {
      const req = httpRequest(origin+"/trpc/read", {headers:{Host:`attacker.invalid:${port}`,Origin:origin,"X-Forwarded-Host":`127.0.0.1:${port}`}},res=>{
        res.resume();res.on("end",()=>resolve(res.statusCode));
      });
      req.on("error",reject);req.end();
    });
    assert.equal(forgedHost,403);
    assert.equal(await request("/trpc/bump", {method:"OPTIONS",headers:{Origin:origin}}),403);
    assert.equal(effects,3,"no rejected request reached its mutation");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("all generated previews use the shared opaque-origin policy", () => {
  const html = renderToStaticMarkup(createElement(SitePreview,{html:"<p>citation</p>",title:"Fixture"}));
  assert.match(html,/sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(html,/allow-same-origin|allow-forms|allow-top-navigation/);
  assert.match(html,/referrerPolicy="no-referrer"/i);
  assert.match(html,/srcDoc=/i);
});
