import { z } from "zod";
import { resolve } from "path";
import { existsSync } from "fs";

import { router, publicProcedure } from "../_core/trpc";
import {
  runBridge,
  BRIDGE_PATHS,
  startReauth,
  confirmReauth,
} from "../_core/bridge";
import {
  resolveFrameworkNotebookId,
  setFrameworkNotebookId,
} from "../_core/settings";
import {
  createFrameworkRun,
  getFrameworkRun,
  updateFrameworkRun,
} from "../_core/frameworkRepo";
import {
  DOCS_DIR,
  FRAMEWORK_TRANSLATOR_PERSONA_PATH,
  VACUUM_IDENTIFIER_PERSONA_PATH,
  writeTmpPrompt,
  readBridgeOutputBody,
  parseJsonLoose,
  parseNotebookId,
} from "../_core/bridgeUtils";

// ─────────────────────────────────────────────────────────────────────────
// Constants specific to the framework setup / Pick-for-me flow
// ─────────────────────────────────────────────────────────────────────────

const FRAMEWORK_SETUP_COUNTY = "_framework";

const METHODOLOGY_DOCS = [
  "fractal_framework_methodology_guide.md",
  "master_template_structure.md",
  "activism_vacuum_methodology.md",
];

// ─────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────

const vacuumProposalSchema = z.object({
  project_name: z.string().min(1),
  project_mission: z.string().min(1),
  locale: z.string().min(1),
  issue_type: z.string().min(1),
  tier_examples: z.object({
    tier_1: z.string().min(1),
    tier_2: z.string().min(1),
    tier_3: z.string().min(1),
  }),
  rationale: z.string().optional(),
  source_summary: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// Background pipeline — the actual work for one framework run
// ─────────────────────────────────────────────────────────────────────────

async function runFrameworkPipeline(runId: string): Promise<void> {
  const setError = async (message: string) => {
    try {
      await updateFrameworkRun(runId, {
        status: "error",
        progress: "Failed",
        error: message,
      });
    } catch (e) {
      console.error(`[framework-run ${runId}] failed to record error:`, e);
    }
  };

  try {
    const run = await getFrameworkRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const frameworkNotebookId = resolveFrameworkNotebookId();
    if (!frameworkNotebookId) {
      throw new Error(
        "Framework notebook is not set up. Go to Settings → Framework Notebook → Set up."
      );
    }

    const perRunCounty = `_framework_run_${run.id}`;

    // ── STEP 1: Translate location → research query ──────────────────────
    await updateFrameworkRun(runId, {
      status: "translating",
      progress: `Asking the Framework notebook to translate "${run.location}" into a research query...`,
    });

    const translatePromptPath = writeTmpPrompt(
      `translate_${run.id}`,
      `run the framework through ${run.location}`
    );

    const translateResult = await runBridge({
      args: [
        "query",
        "--county",
        perRunCounty,
        "--notebook-id",
        frameworkNotebookId,
        "--prompt-path",
        translatePromptPath,
        "--output-name",
        "translate",
      ],
      timeoutMs: 180_000,
    });
    if (translateResult.exitCode !== 0) {
      throw new Error(
        `Translation step failed (exit ${translateResult.exitCode}):\n${
          translateResult.stderr || translateResult.stdout
        }`
      );
    }

    const researchQuery = readBridgeOutputBody(perRunCounty, "translate");
    if (!researchQuery) {
      throw new Error("Translation returned empty content.");
    }

    // ── STEP 2: Create a per-location notebook and run research ──────────
    await updateFrameworkRun(runId, {
      status: "researching",
      progress: `Creating a fresh notebook and running ${run.mode === "fast" ? "Fast" : "Deep"} Research...`,
      research_query: researchQuery,
    });

    const createResult = await runBridge({
      args: [
        "create-notebook",
        "--county",
        perRunCounty,
        "--title",
        `Pick-for-me: ${run.location}`,
      ],
      timeoutMs: 60_000,
    });
    if (createResult.exitCode !== 0) {
      throw new Error(
        `create-notebook failed (exit ${createResult.exitCode}):\n${
          createResult.stderr || createResult.stdout
        }`
      );
    }
    const locationNotebookId = parseNotebookId(createResult.stdout);
    if (!locationNotebookId) {
      throw new Error(
        `Could not parse notebook ID from create-notebook output:\n${createResult.stdout}`
      );
    }

    await updateFrameworkRun(runId, {
      notebook_id: locationNotebookId,
      progress: `${run.mode === "fast" ? "Fast" : "Deep"} Research running against fresh notebook ${locationNotebookId.slice(0, 8)}...`,
    });

    // The research prompt for phase-a is the translated query, written to a tmp file
    // (phase-a expects --prompt-path).
    const researchPromptPath = writeTmpPrompt(
      `research_${run.id}`,
      researchQuery
    );
    const researchTimeoutMs = run.mode === "fast" ? 600_000 : 1_800_000; // 10 / 30 min
    const phaseATimeoutSec = Math.floor(researchTimeoutMs / 1000) - 30; // give Python a 30s buffer
    const researchResult = await runBridge({
      args: [
        "phase-a",
        "--county",
        perRunCounty,
        "--notebook-id",
        locationNotebookId,
        "--prompt-path",
        researchPromptPath,
        "--mode",
        run.mode,
        "--timeout",
        String(phaseATimeoutSec),
        "--max-sources",
        "10",
      ],
      timeoutMs: researchTimeoutMs,
    });
    if (researchResult.exitCode !== 0) {
      throw new Error(
        `Research step failed (exit ${researchResult.exitCode}):\n${
          researchResult.stderr || researchResult.stdout
        }`
      );
    }

    // ── STEP 3: Configure Vacuum Identifier persona + extract Campaign ───
    await updateFrameworkRun(runId, {
      status: "identifying",
      progress: "Configuring Vacuum Identifier persona and extracting Campaign proposal...",
    });

    const personaResult = await runBridge({
      args: [
        "phase-b",
        "--county",
        perRunCounty,
        "--notebook-id",
        locationNotebookId,
        "--persona-path",
        VACUUM_IDENTIFIER_PERSONA_PATH,
      ],
      timeoutMs: 60_000,
    });
    if (personaResult.exitCode !== 0) {
      throw new Error(
        `Persona configuration failed:\n${
          personaResult.stderr || personaResult.stdout
        }`
      );
    }

    const identifyPromptPath = writeTmpPrompt(
      `identify_${run.id}`,
      `Based on the sources in this notebook, identify the single most pressing activism vacuum for ${run.location} and propose a Campaign as JSON per your instructions. Output ONLY the JSON object.`
    );
    const identifyResult = await runBridge({
      args: [
        "query",
        "--county",
        perRunCounty,
        "--notebook-id",
        locationNotebookId,
        "--prompt-path",
        identifyPromptPath,
        "--output-name",
        "identify",
      ],
      timeoutMs: 180_000,
    });
    if (identifyResult.exitCode !== 0) {
      throw new Error(
        `Identification step failed:\n${
          identifyResult.stderr || identifyResult.stdout
        }`
      );
    }

    const rawProposal = readBridgeOutputBody(perRunCounty, "identify");
    let parsed: unknown;
    try {
      parsed = parseJsonLoose(rawProposal);
    } catch {
      throw new Error(
        `Vacuum Identifier did not return parseable JSON. Raw response:\n\n${rawProposal}`
      );
    }
    const validated = vacuumProposalSchema.safeParse(parsed);
    if (!validated.success) {
      const missing = validated.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(
        `Vacuum Identifier JSON missing or invalid fields: ${missing}.\n\nRaw:\n${rawProposal}`
      );
    }

    await updateFrameworkRun(runId, {
      status: "complete",
      progress: "Complete — review the proposal below.",
      proposal: JSON.stringify(validated.data),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[framework-run ${runId}] error:`, message);
    await setError(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────

export const bridgeRouter = router({
  status: publicProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const args = ["status"];
      if (input?.force) args.push("--force");
      const result = await runBridge({
        args,
        timeoutMs: 30_000,
      });

      return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        bridgeDir: BRIDGE_PATHS.bridgeDir,
      };
    }),

  // Spawn the NotebookLM login subprocess. The user signs into Google in the
  // browser window it opens, then calls confirmReauth to advance.
  startReauth: publicProcedure.mutation(() => startReauth()),

  // Feed ENTER to the in-flight login subprocess and wait for it to exit.
  confirmReauth: publicProcedure.mutation(() => confirmReauth()),

  // One-shot setup of the Framework notebook: creates the notebook, uploads
  // the three methodology docs as sources, configures the Framework Translator
  // persona, and saves the resulting notebook_id to settings.json. ~30-60s.
  setupFrameworkNotebook: publicProcedure.mutation(async () => {
    // 1. Create the notebook
    const createResult = await runBridge({
      args: [
        "create-notebook",
        "--county",
        FRAMEWORK_SETUP_COUNTY,
        "--title",
        "Fractal Framework (wizard)",
      ],
      timeoutMs: 60_000,
    });
    if (createResult.exitCode !== 0) {
      throw new Error(
        `create-notebook failed (exit ${createResult.exitCode}):\n${
          createResult.stderr || createResult.stdout
        }`
      );
    }
    const notebookId = parseNotebookId(createResult.stdout);
    if (!notebookId) {
      throw new Error(
        `Could not parse notebook ID from create-notebook output:\n${createResult.stdout}`
      );
    }

    // 2. Upload each methodology doc
    const uploaded: string[] = [];
    for (const docName of METHODOLOGY_DOCS) {
      const docPath = resolve(DOCS_DIR, docName);
      if (!existsSync(docPath)) {
        throw new Error(`Methodology doc not found at ${docPath}`);
      }
      const addResult = await runBridge({
        args: [
          "add-source",
          "--county",
          FRAMEWORK_SETUP_COUNTY,
          "--notebook-id",
          notebookId,
          "--file",
          docPath,
        ],
        timeoutMs: 180_000,
      });
      if (addResult.exitCode !== 0) {
        throw new Error(
          `add-source ${docName} failed (exit ${addResult.exitCode}):\n${
            addResult.stderr || addResult.stdout
          }`
        );
      }
      uploaded.push(docName);
    }

    // 3. Configure the Framework Translator persona
    const personaResult = await runBridge({
      args: [
        "phase-b",
        "--county",
        FRAMEWORK_SETUP_COUNTY,
        "--notebook-id",
        notebookId,
        "--persona-path",
        FRAMEWORK_TRANSLATOR_PERSONA_PATH,
      ],
      timeoutMs: 60_000,
    });
    if (personaResult.exitCode !== 0) {
      throw new Error(
        `Persona configuration failed:\n${
          personaResult.stderr || personaResult.stdout
        }`
      );
    }

    // 4. Save the notebook_id to settings
    setFrameworkNotebookId(notebookId);

    return {
      notebookId,
      uploadedDocs: uploaded,
    };
  }),

  clearFrameworkNotebook: publicProcedure.mutation(() => {
    setFrameworkNotebookId(null);
    return { ok: true as const };
  }),

  // Kick off a framework-driven Pick-for-me pipeline. Returns the run_id;
  // the frontend polls `getFrameworkRun` for progress.
  startFrameworkRun: publicProcedure
    .input(
      z.object({
        location: z.string().min(2).max(200),
        mode: z.enum(["deep", "fast"]).default("fast"),
      })
    )
    .mutation(async ({ input }) => {
      const frameworkNotebookId = resolveFrameworkNotebookId();
      if (!frameworkNotebookId) {
        throw new Error(
          "Framework notebook is not set up. Go to Settings → Framework Notebook → Set up."
        );
      }
      const run = await createFrameworkRun(input.location, input.mode);
      // Fire-and-forget; the pipeline updates the row as it progresses.
      void runFrameworkPipeline(run.id);
      return { id: run.id };
    }),

  // Poll endpoint — returns the current state of a framework run.
  getFrameworkRun: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getFrameworkRun(input.id)),
});
