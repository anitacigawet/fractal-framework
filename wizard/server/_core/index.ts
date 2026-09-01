import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { resolve } from "path";
import { env } from "./env";
import { appRouter } from "./router";
import { WIZARD_ROOT } from "./paths";

const app = express();

app.use(express.json());

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext: () => ({}),
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Single-file site download. The wizard's "Download site" button hits this
// endpoint; the response is the same HTML the preview iframe shows, but with
// a Content-Disposition header so the browser saves it as index.html.
//
// `?source=stitch` returns the latest stitch_runs.injected_html for the
// campaign (the Stitch-generated design). Default = the legacy/default
// template rendered by siteTemplate.ts. When ?source=stitch is requested
// but no completed Stitch run exists, falls back to the default template
// with a header noting the fallback.
app.get("/api/download/:campaignId", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const source =
      typeof req.query.source === "string" ? req.query.source : "default";
    const { getCampaign } = await import("./campaignRepo");
    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      res.status(404).send("Campaign not found");
      return;
    }

    let html: string;
    if (source === "stitch") {
      const { getLatestStitchRunForCampaign } = await import("./stitchRepo");
      const run = await getLatestStitchRunForCampaign(campaignId);
      if (run?.injected_html) {
        html = run.injected_html;
      } else {
        const { renderSite } = await import("./siteTemplate");
        html = renderSite(campaign);
      }
    } else {
      const { renderSite } = await import("./siteTemplate");
      html = renderSite(campaign);
    }

    const filenameSlug =
      (campaign.project_name ?? campaign.title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "advocacy-site";
    const suffix = source === "stitch" ? "-stitch" : "";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filenameSlug}${suffix}.html"`
    );
    res.send(html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).send(`Download failed: ${msg}`);
  }
});

// In production, serve the built client (dist/client) inline.
if (env.NODE_ENV === "production") {
  // The built client lives at wizard/dist/client/. Use the resolved wizard
  // root so `pnpm start` works even from a different process working directory.
  const clientDist = resolve(WIZARD_ROOT, "dist/client");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(resolve(clientDist, "index.html"));
  });
}

const HOST = "127.0.0.1";

app.listen(env.PORT, HOST, () => {
  console.log(`[wizard] backend listening on http://${HOST}:${env.PORT}`);
});
