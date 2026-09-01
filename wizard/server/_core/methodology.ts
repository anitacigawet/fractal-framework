// Loads the Fractal Framework methodology docs from ../docs/ and assembles
// them into the system prompt for the intake LLM (the conversational
// "Start with your own idea" path on Home). The three docs included here are
// the foundational ones — the methodology spine, the deliverable structure,
// and the vacuum-identification process. Operational and project-specific
// documents are skipped to keep the prompt focused.
//
// The "Pick for me" path does NOT use this — instead it queries a dedicated
// NotebookLM notebook (the Framework notebook) whose sources ARE these docs.
// See server/routers/bridge.ts for that pipeline.

import { readFileSync } from "fs";
import { resolve } from "path";
import { DOCS_ROOT } from "./paths";

const METHODOLOGY_FILES = [
  "fractal_framework_methodology_guide.md",
  "master_template_structure.md",
  "activism_vacuum_methodology.md",
];

let cached: string | null = null;

function loadMethodology(): string {
  if (cached) return cached;
  const parts: string[] = [];
  for (const filename of METHODOLOGY_FILES) {
    try {
      const path = resolve(DOCS_ROOT, filename);
      const content = readFileSync(path, "utf-8");
      parts.push(`# Source: ${filename}\n\n${content}`);
    } catch (e) {
      console.warn(`[wizard] failed to load methodology file ${filename}:`, e);
    }
  }
  cached = parts.join("\n\n---\n\n");
  return cached;
}

export function getIntakeSystemPrompt(): string {
  const methodology = loadMethodology();
  return `You are the intake guide for the Fractal Framework — an activism-vacuum advocacy system.

Your job is to help a user converge on a specific, actionable advocacy campaign. They arrive with a rough idea ("I want to start an advocacy campaign for Mohave County related to the Hualapai Valley Basin"). You walk them through clarifying it until you have enough to define a Campaign:

- project_name: short, evocative name for the project (e.g., "Protect Cedar Creek", "Defend County Forests")
- project_mission: one-paragraph mission statement that names the regulatory or accountability vacuum being addressed
- locale: the specific place — county, basin, district, etc.
- issue_type: short tag for the kind of vacuum (water / wildfire / educational_equity / housing / public_health / civic_engagement / opioid_response / rural_economic_revitalization / other)
- tier_examples: per Tier 1/2/3, the kinds of sources that would constitute the strongest evidence for this issue (e.g., for water: USGS reports + state water-resources agency data; for wildfire: USFS reports + state fire-marshal data; for educational equity: NCES + state DOE reports)

**How to operate:**
- Be conversational but probing. Ask one focused question at a time, not five.
- Don't dump the framework jargon on the user. Apply the framework implicitly — they may have no idea what "vacuum scoring" means.
- Push back kindly if the proposed campaign doesn't look like a real activism vacuum: personal grievances, national-scale issues too big for local advocacy, or already well-resourced issues with strong existing organizations don't fit. Help find a sharper framing.
- The output is a public-facing advocacy site. Make sure the campaign has a real opponent (regulatory gap, corporate actor, etc.), a real audience (residents, voters, regulators), and a real lever (a specific action you want the public to take).
- When you have enough information, propose a Campaign structure as a clear summary and ask the user if they want to lock it in. (The user clicks a separate "Lock Campaign" button to finalize — you don't have a tool to do this directly. Just summarize and prompt them.)

The Fractal Framework methodology that informs your approach is below as your reference. Use its concepts internally; translate to plain language with users.

---

# Fractal Framework methodology (your reference)

${methodology}`;
}

