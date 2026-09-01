// Runtime settings — read from data/settings.json; env vars take precedence.
// Cached in-process; small surface, so the cache is invalidated implicitly
// on every mutator (we rewrite the cache after writing the file).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { env, STITCH_MODELS, type ProviderId, type StitchModelId } from "./env";

interface ProviderSettings {
  apiKey?: string;
  model?: string;
}

interface StitchSettings {
  apiKey?: string;
  model?: StitchModelId;
  disclaimerDismissed?: boolean;
}

interface SettingsFile {
  activeProvider?: ProviderId;
  providers?: Partial<Record<ProviderId, ProviderSettings>>;
  rateLimitRps?: number;
  frameworkNotebookId?: string;
  stitch?: StitchSettings;
}

let cached: SettingsFile | null = null;

function load(): SettingsFile {
  if (cached) return cached;
  try {
    const raw = readFileSync(env.SETTINGS_PATH, "utf-8");
    cached = JSON.parse(raw) as SettingsFile;
  } catch {
    cached = {};
  }
  return cached;
}

function persist(s: SettingsFile): void {
  cached = s;
  mkdirSync(dirname(env.SETTINGS_PATH), { recursive: true });
  writeFileSync(env.SETTINGS_PATH, JSON.stringify(s, null, 2));
}

const PROVIDER_IDS: readonly ProviderId[] = ["gemini", "openai", "deepseek"] as const;

const ENV_KEYS: Record<ProviderId, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

const ENV_MODELS: Record<ProviderId, string> = {
  gemini: "GEMINI_MODEL",
  openai: "OPENAI_MODEL",
  deepseek: "DEEPSEEK_MODEL",
};

const DEFAULT_MODELS: Record<ProviderId, string> = {
  gemini: "gemini-2.0-flash",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
};

// Resolvers — env wins over settings.json.

export function resolveActiveProvider(): ProviderId {
  const fromEnv = process.env.LLM_PROVIDER as ProviderId | undefined;
  if (fromEnv && PROVIDER_IDS.includes(fromEnv)) return fromEnv;
  const fromFile = load().activeProvider;
  if (fromFile && PROVIDER_IDS.includes(fromFile)) return fromFile;
  return "gemini";
}

export function resolveProviderKey(providerId: ProviderId): string {
  const envKey = process.env[ENV_KEYS[providerId]];
  if (envKey) return envKey;
  return load().providers?.[providerId]?.apiKey ?? "";
}

export function resolveProviderModel(providerId: ProviderId): string {
  const envModel = process.env[ENV_MODELS[providerId]];
  if (envModel) return envModel;
  return load().providers?.[providerId]?.model ?? DEFAULT_MODELS[providerId];
}

export function resolveRateLimitRps(): number {
  const fromEnv = process.env.RATE_LIMIT_RPS;
  if (fromEnv) return Number(fromEnv);
  return load().rateLimitRps ?? 0;
}

// Mutators — used only by the Settings router.

export function setActiveProvider(providerId: ProviderId): void {
  const s = load();
  s.activeProvider = providerId;
  persist(s);
}

export function setProviderKey(providerId: ProviderId, apiKey: string): void {
  const s = load();
  s.providers ??= {};
  s.providers[providerId] ??= {};
  s.providers[providerId]!.apiKey = apiKey;
  persist(s);
}

export function setProviderModel(providerId: ProviderId, model: string): void {
  const s = load();
  s.providers ??= {};
  s.providers[providerId] ??= {};
  s.providers[providerId]!.model = model;
  persist(s);
}

export function resolveFrameworkNotebookId(): string | null {
  const fromEnv = process.env.FRAMEWORK_NOTEBOOK_ID;
  if (fromEnv) return fromEnv;
  return load().frameworkNotebookId ?? null;
}

export function setFrameworkNotebookId(notebookId: string | null): void {
  const s = load();
  if (notebookId) {
    s.frameworkNotebookId = notebookId;
  } else {
    delete s.frameworkNotebookId;
  }
  persist(s);
}

// ── Stitch ──────────────────────────────────────────────────────────────

export function resolveStitchApiKey(): string {
  if (process.env.STITCH_API_KEY) return process.env.STITCH_API_KEY;
  return load().stitch?.apiKey ?? "";
}

export function resolveStitchModel(): StitchModelId {
  const fromEnv = process.env.STITCH_MODEL as StitchModelId | undefined;
  if (fromEnv && STITCH_MODELS.includes(fromEnv)) return fromEnv;
  const fromFile = load().stitch?.model;
  if (fromFile && STITCH_MODELS.includes(fromFile)) return fromFile;
  return "GEMINI_3_FLASH";
}

export function resolveStitchDisclaimerDismissed(): boolean {
  return !!load().stitch?.disclaimerDismissed;
}

export function setStitchApiKey(apiKey: string): void {
  const s = load();
  s.stitch ??= {};
  s.stitch.apiKey = apiKey;
  persist(s);
}

export function setStitchModel(model: StitchModelId): void {
  const s = load();
  s.stitch ??= {};
  s.stitch.model = model;
  persist(s);
}

export function setStitchDisclaimerDismissed(dismissed: boolean): void {
  const s = load();
  s.stitch ??= {};
  s.stitch.disclaimerDismissed = dismissed;
  persist(s);
}

// Snapshot — what the Settings UI consumes. Never includes the actual API
// key; only whether one is configured + where it came from.

export interface ProviderSnapshot {
  id: ProviderId;
  displayName: string;
  model: string;
  modelFromEnv: boolean;
  hasKey: boolean;
  keyFromEnv: boolean;
}

export interface StitchSnapshot {
  hasKey: boolean;
  keyFromEnv: boolean;
  model: StitchModelId;
  modelFromEnv: boolean;
  availableModels: readonly StitchModelId[];
  disclaimerDismissed: boolean;
}

export interface SettingsSnapshot {
  activeProvider: ProviderId;
  activeProviderFromEnv: boolean;
  providers: ProviderSnapshot[];
  frameworkNotebookId: string | null;
  frameworkNotebookIdFromEnv: boolean;
  stitch: StitchSnapshot;
}

const DISPLAY_NAMES: Record<ProviderId, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

export function getSettingsSnapshot(): SettingsSnapshot {
  return {
    activeProvider: resolveActiveProvider(),
    activeProviderFromEnv: !!process.env.LLM_PROVIDER,
    providers: PROVIDER_IDS.map((id) => ({
      id,
      displayName: DISPLAY_NAMES[id],
      model: resolveProviderModel(id),
      modelFromEnv: !!process.env[ENV_MODELS[id]],
      hasKey: !!resolveProviderKey(id),
      keyFromEnv: !!process.env[ENV_KEYS[id]],
    })),
    frameworkNotebookId: resolveFrameworkNotebookId(),
    frameworkNotebookIdFromEnv: !!process.env.FRAMEWORK_NOTEBOOK_ID,
    stitch: {
      hasKey: !!resolveStitchApiKey(),
      keyFromEnv: !!process.env.STITCH_API_KEY,
      model: resolveStitchModel(),
      modelFromEnv: !!process.env.STITCH_MODEL,
      availableModels: STITCH_MODELS,
      disclaimerDismissed: resolveStitchDisclaimerDismissed(),
    },
  };
}
