import { router, publicProcedure } from "./trpc";
import { settingsRouter } from "../routers/settings";
import { campaignsRouter } from "../routers/campaigns";
import { intakeRouter } from "../routers/intake";
import { bridgeRouter } from "../routers/bridge";
import { productionRouter } from "../routers/production";
import { stitchRouter } from "../routers/stitch";

// Root router for the wizard's API modules.

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    message: "Wizard backend ready",
    time: new Date().toISOString(),
  })),
  settings: settingsRouter,
  campaigns: campaignsRouter,
  intake: intakeRouter,
  bridge: bridgeRouter,
  production: productionRouter,
  stitch: stitchRouter,
});

export type AppRouter = typeof appRouter;
