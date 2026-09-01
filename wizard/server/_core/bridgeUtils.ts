// Shared helpers for routers that drive the NotebookLM bridge subprocess:
// path constants, tmp-prompt writing, output-file reading, JSON parsing.
// Pulled out of bridge.ts/bridge router so production.ts can reuse them.

import { resolve } from "path";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { BRIDGE_PATHS } from "./bridge";
import { DOCS_ROOT, REPO_ROOT, WIZARD_ROOT } from "./paths";

// Paths to the repo's docs (used by setupFrameworkNotebook), the bridge's
// persona files, and the wizard's per-run tmp directory.
export { REPO_ROOT };
export const DOCS_DIR = DOCS_ROOT;

export const FRAMEWORK_TRANSLATOR_PERSONA_PATH = resolve(
  BRIDGE_PATHS.bridgeDir,
  "queries/_framework_translator_persona.md"
);
export const VACUUM_IDENTIFIER_PERSONA_PATH = resolve(
  BRIDGE_PATHS.bridgeDir,
  "queries/_vacuum_identifier_persona.md"
);
export const TRUST_SERVER_PERSONA_PATH = resolve(
  BRIDGE_PATHS.bridgeDir,
  "queries/_persona.md"
);

export const WIZARD_QUERIES_DIR = resolve(
  BRIDGE_PATHS.bridgeDir,
  "queries/wizard"
);

export const BRIDGE_OUTPUTS_DIR = resolve(BRIDGE_PATHS.bridgeDir, "outputs");

export const WIZARD_TMP_DIR = resolve(WIZARD_ROOT, "data/tmp");

// Write an instruction body to a tmp file under wizard/data/tmp/ so the
// bridge's `query` subcommand (which requires --prompt-path) can find it.
export function writeTmpPrompt(prefix: string, instructions: string): string {
  mkdirSync(WIZARD_TMP_DIR, { recursive: true });
  const path = resolve(WIZARD_TMP_DIR, `${prefix}_${Date.now()}.md`);
  const body = `## Instructions (sent to Chat)\n\n${instructions}\n`;
  writeFileSync(path, body, "utf-8");
  return path;
}

// The bridge runner writes query responses to outputs/<county>/<name>.md
// with YAML front-matter. Strip the front-matter and return the body.
export function readBridgeOutputBody(
  county: string,
  outputName: string
): string {
  const cleanName = outputName.endsWith(".md") ? outputName : `${outputName}.md`;
  const path = resolve(BRIDGE_OUTPUTS_DIR, county, cleanName);
  if (!existsSync(path)) {
    throw new Error(`Bridge output file not found: ${path}`);
  }
  const text = readFileSync(path, "utf-8");
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      return text
        .slice(end + 4)
        .replace(/^\s*\n/, "")
        .trimEnd();
    }
  }
  return text.trimEnd();
}

// Pull JSON out of an LLM response that may have markdown fences around it.
export function parseJsonLoose(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  return JSON.parse(cleaned);
}

// Parse the notebook ID from `create-notebook` stdout. The bridge prints
// `  ID:     <id>` on its own line.
export function parseNotebookId(stdout: string): string | null {
  const m = stdout.match(/^\s*ID:\s+(\S+)\s*$/m);
  return m ? m[1] : null;
}

// Build the --var KEY=value args for substituting Campaign fields into
// bridge prompts. Used by both the Framework Translator (no Campaign yet,
// so this is empty) and the production phase (Campaign-locked fields).
export function campaignVarArgs(fields: Record<string, string | undefined>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value && value.length > 0) {
      args.push("--var", `${key}=${value}`);
    }
  }
  return args;
}
