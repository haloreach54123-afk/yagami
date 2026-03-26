import type { LlmApi } from "../types/config.js";
import type { AgentThinkingLevel } from "../types/engine.js";

export async function fetchJson(
  url: string,
  options: RequestInit = {},
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
    }

    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeLlmApi(value: unknown): LlmApi {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "anthropic-messages") return "anthropic-messages";
  return "openai-completions";
}

export function resolveRuntimeApiKey(api: LlmApi, value: unknown): string {
  const key = String(value ?? "").trim();
  if (key) return key;
  return api === "anthropic-messages" ? "local" : "none";
}

export function normalizeThinkingLevel(value: unknown, fallback: AgentThinkingLevel = "off"): AgentThinkingLevel {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized as AgentThinkingLevel;
  }

  return fallback;
}

export function joinUrl(baseUrl: string, path: string): string {
  const left = String(baseUrl || "").replace(/\/+$/, "");
  const right = String(path || "").replace(/^\/+/, "");
  if (!left) return `/${right}`;
  if (!right) return left;
  return `${left}/${right}`;
}

export function anthropicModelsUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/v1$/i.test(trimmed)) {
    return joinUrl(trimmed, "models");
  }

  return joinUrl(trimmed, "v1/models");
}
