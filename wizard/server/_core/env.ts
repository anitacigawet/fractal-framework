import { config } from "dotenv";

config();

export type ProviderId = "gemini" | "openai" | "deepseek";

export const env = {
  PORT: Number(process.env.PORT ?? 7101),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  LLM_PROVIDER: (process.env.LLM_PROVIDER ?? "gemini") as ProviderId,

  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",

  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",

  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/wizard.db",
  SETTINGS_PATH: process.env.SETTINGS_PATH ?? "./data/settings.json",

  // Optional rate limit on LLM calls (requests/second). 0 = disabled.
  RATE_LIMIT_RPS: Number(process.env.RATE_LIMIT_RPS ?? 0),

  // Google Stitch — generative per-campaign visual design for the
  // generated advocacy sites. Optional; when unset, the wizard falls back
  // to the default site template.
  STITCH_API_KEY: process.env.STITCH_API_KEY ?? "",
  STITCH_MODEL: process.env.STITCH_MODEL ?? "GEMINI_3_FLASH",
};

export type StitchModelId = "GEMINI_3_FLASH" | "GEMINI_3_PRO";
export const STITCH_MODELS: readonly StitchModelId[] = [
  "GEMINI_3_FLASH",
  "GEMINI_3_PRO",
] as const;
