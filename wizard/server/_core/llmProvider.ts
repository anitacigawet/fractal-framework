// Multi-provider LLM routing. OpenAI and DeepSeek share an OpenAI-compatible
// shape; Gemini responses are translated to the same simple {text} result.

import {
  resolveActiveProvider,
  resolveProviderKey,
  resolveProviderModel,
  resolveRateLimitRps,
} from "./settings";
import type { ProviderId } from "./env";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InvokeParams {
  messages: LLMMessage[];
  maxTokens?: number;
}

export interface InvokeResult {
  text: string;
}

export interface LLMProvider {
  invoke(params: InvokeParams): Promise<InvokeResult>;
  validate(): Promise<boolean>;
  getName(): string;
}

const DEFAULT_MAX_TOKENS = 2048;

// Shared rate limiter (single-user, single-process).
let lastRequestTime = 0;
async function applyRateLimit(): Promise<void> {
  const rps = resolveRateLimitRps();
  if (rps <= 0) {
    lastRequestTime = Date.now();
    return;
  }
  const minIntervalMs = 1000 / rps;
  const wait = minIntervalMs - (Date.now() - lastRequestTime);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
}

class OpenAICompatibleProvider implements LLMProvider {
  constructor(
    private readonly providerId: ProviderId,
    private readonly displayName: string,
    private readonly baseUrl: string,
  ) {}

  getName(): string {
    return `${this.displayName} (${resolveProviderModel(this.providerId)})`;
  }

  async validate(): Promise<boolean> {
    return !!resolveProviderKey(this.providerId);
  }

  async invoke(params: InvokeParams): Promise<InvokeResult> {
    const key = resolveProviderKey(this.providerId);
    if (!key) {
      throw new Error(`${this.displayName} API key not configured.`);
    }

    await applyRateLimit();

    const body = {
      model: resolveProviderModel(this.providerId),
      messages: params.messages,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.displayName} invoke failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { text: data.choices?.[0]?.message?.content ?? "" };
  }
}

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor() {
    super("openai", "OpenAI", "https://api.openai.com/v1/chat/completions");
  }
}

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor() {
    super("deepseek", "DeepSeek", "https://api.deepseek.com/chat/completions");
  }
}

// Gemini has a different request/response shape. Translate OpenAI-style
// messages in and the standard candidate shape out.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProvider implements LLMProvider {
  getName(): string {
    return `Gemini (${resolveProviderModel("gemini")})`;
  }

  async validate(): Promise<boolean> {
    return !!resolveProviderKey("gemini");
  }

  async invoke(params: InvokeParams): Promise<InvokeResult> {
    const key = resolveProviderKey("gemini");
    if (!key) {
      throw new Error("Gemini API key not configured.");
    }

    await applyRateLimit();

    const systemMessages = params.messages.filter((m) => m.role === "system");
    const otherMessages = params.messages.filter((m) => m.role !== "system");
    const systemInstruction = systemMessages.length
      ? { parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }] }
      : undefined;
    const contents = otherMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const model = resolveProviderModel("gemini");
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini invoke failed: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("") ?? "";
    return { text };
  }
}

export function getProvider(providerId: ProviderId): LLMProvider {
  switch (providerId) {
    case "openai":
      return new OpenAIProvider();
    case "deepseek":
      return new DeepSeekProvider();
    case "gemini":
      return new GeminiProvider();
  }
}

export function getActiveProvider(): LLMProvider {
  return getProvider(resolveActiveProvider());
}
