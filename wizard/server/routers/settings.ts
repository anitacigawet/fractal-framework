import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import {
  getSettingsSnapshot,
  resolveActiveProvider,
  resolveFrameworkNotebookId,
  resolveStitchApiKey,
  setActiveProvider,
  setProviderKey,
  setProviderModel,
  setStitchApiKey,
  setStitchModel,
  setStitchDisclaimerDismissed,
} from "../_core/settings";
import { getProvider } from "../_core/llmProvider";
import { runBridge } from "../_core/bridge";

const ProviderIdSchema = z.enum(["gemini", "openai", "deepseek"]);
const StitchModelSchema = z.enum(["GEMINI_3_FLASH", "GEMINI_3_PRO"]);

// ── Health check ────────────────────────────────────────────────────────
// One-shot probe across the four components the wizard needs configured.
// Each check returns a structured { key, label, status, message } so the
// UI can render a status grid the user can scan before starting a real
// campaign.

type HealthStatus = "ok" | "warn" | "bad" | "unconfigured";
interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  message: string;
}

async function checkLlmProvider(): Promise<HealthCheck> {
  const provider = resolveActiveProvider();
  try {
    const p = getProvider(provider);
    const result = await p.invoke({
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      maxTokens: 16,
    });
    return {
      key: "llm_provider",
      label: `LLM provider (${provider})`,
      status: "ok",
      message: `Responded — sample: "${result.text.slice(0, 60)}"`,
    };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const isNoKey = /api[\s_-]*key|missing|unauthorized|401/i.test(msg);
    return {
      key: "llm_provider",
      label: `LLM provider (${provider})`,
      status: isNoKey ? "unconfigured" : "bad",
      message: msg,
    };
  }
}

async function checkBridge(): Promise<HealthCheck> {
  try {
    const result = await runBridge({
      args: ["status", "--force"],
      timeoutMs: 30_000,
    });
    if (result.exitCode === 0) {
      // bridge stdout usually contains "Auth: ok" or similar
      const authOk = /auth:\s*ok/i.test(result.stdout);
      return {
        key: "bridge",
        label: "NotebookLM bridge",
        status: authOk ? "ok" : "warn",
        message: authOk
          ? "Authenticated and ready."
          : "Bridge reachable but auth state unclear. Try Re-authenticate.",
      };
    }
    const expired = /Auth:\s*(expired|missing|unknown)/i.test(result.stdout);
    return {
      key: "bridge",
      label: "NotebookLM bridge",
      status: expired ? "unconfigured" : "bad",
      message: expired
        ? "Not authenticated. Use the Re-authenticate button below."
        : `Bridge exit ${result.exitCode}: ${result.stderr || result.stdout || "(no output)"}`,
    };
  } catch (e) {
    return {
      key: "bridge",
      label: "NotebookLM bridge",
      status: "bad",
      message: (e as Error).message ?? String(e),
    };
  }
}

async function checkFrameworkNotebook(): Promise<HealthCheck> {
  const id = resolveFrameworkNotebookId();
  if (!id) {
    return {
      key: "framework_notebook",
      label: "Framework Notebook",
      status: "unconfigured",
      message: "Not set up. Click 'Set up Framework Notebook' above.",
    };
  }
  return {
    key: "framework_notebook",
    label: "Framework Notebook",
    status: "ok",
    message: `Configured (id: ${id.slice(0, 8)}…)`,
  };
}

async function checkStitch(): Promise<HealthCheck> {
  const apiKey = resolveStitchApiKey();
  if (!apiKey) {
    return {
      key: "stitch",
      label: "Google Stitch",
      status: "unconfigured",
      message:
        "Not set up. Optional — the wizard falls back to its default template without it.",
    };
  }
  try {
    const { Stitch, StitchToolClient } = await import("@google/stitch-sdk");
    const client = new StitchToolClient({ apiKey });
    const sdk = new Stitch(client);
    const projects = await sdk.projects();
    await client.close();
    return {
      key: "stitch",
      label: "Google Stitch",
      status: "ok",
      message: `Authenticated — ${projects.length} accessible project${projects.length === 1 ? "" : "s"}.`,
    };
  } catch (e) {
    const err = e as Error & { code?: string };
    return {
      key: "stitch",
      label: "Google Stitch",
      status: "bad",
      message: err.code ? `${err.code}: ${err.message}` : err.message,
    };
  }
}

function overallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === "bad")) return "bad";
  if (checks.some((c) => c.status === "unconfigured")) return "warn";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

export const settingsRouter = router({
  get: publicProcedure.query(() => getSettingsSnapshot()),

  setActiveProvider: publicProcedure
    .input(z.object({ provider: ProviderIdSchema }))
    .mutation(({ input }) => {
      setActiveProvider(input.provider);
      return getSettingsSnapshot();
    }),

  setProviderKey: publicProcedure
    .input(z.object({ provider: ProviderIdSchema, apiKey: z.string() }))
    .mutation(({ input }) => {
      setProviderKey(input.provider, input.apiKey);
      return getSettingsSnapshot();
    }),

  setProviderModel: publicProcedure
    .input(z.object({ provider: ProviderIdSchema, model: z.string().min(1) }))
    .mutation(({ input }) => {
      setProviderModel(input.provider, input.model);
      return getSettingsSnapshot();
    }),

  // Live key test — makes a tiny real call to confirm the provider responds.
  validateProvider: publicProcedure
    .input(z.object({ provider: ProviderIdSchema }))
    .mutation(async ({ input }) => {
      const provider = getProvider(input.provider);
      try {
        const result = await provider.invoke({
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          maxTokens: 16,
        });
        return { ok: true as const, sample: result.text.slice(0, 80) };
      } catch (e) {
        return { ok: false as const, error: (e as Error).message };
      }
    }),

  // ── Stitch ──────────────────────────────────────────────────────────

  setStitchApiKey: publicProcedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(({ input }) => {
      setStitchApiKey(input.apiKey);
      return getSettingsSnapshot();
    }),

  setStitchModel: publicProcedure
    .input(z.object({ model: StitchModelSchema }))
    .mutation(({ input }) => {
      setStitchModel(input.model);
      return getSettingsSnapshot();
    }),

  setStitchDisclaimerDismissed: publicProcedure
    .input(z.object({ dismissed: z.boolean() }))
    .mutation(({ input }) => {
      setStitchDisclaimerDismissed(input.dismissed);
      return getSettingsSnapshot();
    }),

  // One-shot health check across LLM provider + bridge + framework notebook
  // + Stitch key. Runs each probe in parallel and returns a structured
  // status report the UI renders as a grid. Use before starting a real
  // campaign to catch misconfigurations early.
  runHealthCheck: publicProcedure.mutation(async () => {
    const [llm, bridge, framework, stitch] = await Promise.all([
      checkLlmProvider(),
      checkBridge(),
      checkFrameworkNotebook(),
      checkStitch(),
    ]);
    const checks = [llm, bridge, framework, stitch];
    return {
      checks,
      overall: overallStatus(checks),
      ranAt: new Date().toISOString(),
    };
  }),

  // Live key test — probes stitch.projects() to confirm the key authenticates.
  // We dynamic-import the SDK so the wizard doesn't crash on boot if the
  // module fails to resolve for any reason.
  validateStitch: publicProcedure.mutation(async () => {
    const apiKey = resolveStitchApiKey();
    if (!apiKey) {
      return { ok: false as const, error: "No API key configured" };
    }
    try {
      const { Stitch, StitchToolClient } = await import("@google/stitch-sdk");
      const client = new StitchToolClient({ apiKey });
      const sdk = new Stitch(client);
      const projects = await sdk.projects();
      await client.close();
      return {
        ok: true as const,
        projectCount: projects.length,
      };
    } catch (e) {
      const err = e as Error & { code?: string };
      return {
        ok: false as const,
        error: err.code ? `${err.code}: ${err.message}` : err.message,
      };
    }
  }),
});
