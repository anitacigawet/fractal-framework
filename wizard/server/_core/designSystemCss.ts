// Shared loader for the canonical design-system CSS. Both surfaces use it:
//   - siteScaffold.ts injects it into Stitch-generated HTML's <head> at
//     content-injection time so .cite/.src-card/.tier render consistently.
//   - siteTemplate.ts (the always-free fallback template) embeds it
//     directly so the default-template output matches the wizard UI's
//     aesthetic instead of using the older emerald palette.
//
// Loaded once at process boot and cached.

import { readFileSync } from "fs";
import { resolve } from "path";
import { WIZARD_ROOT } from "./paths";

const DESIGN_SYSTEM_CSS_PATH = resolve(
  WIZARD_ROOT,
  "client/src/styles/design-system.css"
);

let _cached: string | null = null;

export function loadDesignSystemCss(): string {
  if (_cached !== null) return _cached;
  try {
    _cached = readFileSync(DESIGN_SYSTEM_CSS_PATH, "utf-8");
  } catch {
    _cached = "";
  }
  return _cached;
}
