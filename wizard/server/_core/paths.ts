import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function isRepositoryRoot(candidate: string): boolean {
  return (
    existsSync(resolve(candidate, "wizard/package.json")) &&
    existsSync(resolve(candidate, "engine/notebooklm_bridge/runner.py")) &&
    existsSync(resolve(candidate, "docs/fractal_framework_methodology_guide.md"))
  );
}

function findRepositoryRoot(): string {
  const candidates = [
    process.env.FRACTAL_REPO_ROOT,
    process.cwd(),
    resolve(process.cwd(), ".."),
    // Source execution: wizard/server/_core -> repository root.
    resolve(moduleDir, "../../.."),
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of [...new Set(candidates.map((item) => resolve(item)))]) {
    if (isRepositoryRoot(candidate)) return candidate;
  }

  throw new Error(
    `Unable to locate the Fractal Framework repository. Checked: ${candidates.join(", ")}`
  );
}

export const REPO_ROOT = findRepositoryRoot();
export const WIZARD_ROOT = resolve(REPO_ROOT, "wizard");
export const DOCS_ROOT = resolve(REPO_ROOT, "docs");
export const BRIDGE_ROOT = resolve(REPO_ROOT, "engine/notebooklm_bridge");
