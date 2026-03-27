#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { render as renderAnsiMarkdown } from "markdansi";

import { getConfig } from "./config.js";
import { cmdTheme, createCliThemeRuntime } from "./cli/theme.js";
import { normalizeUniqueUrls } from "./engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = getConfig();
const theme = createCliThemeRuntime(config);

function readCliVersion(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, "..", "package.json");
    const payload = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string };
    const version = String(payload.version || "").trim();
    if (version) return version;
  } catch {
    // ignore and fallback below
  }

  const envVersion = String(process.env.npm_package_version || "").trim();
  return envVersion || "0.0.0";
}

const CLI_VERSION = readCliVersion();

const MARKDOWN_RENDER_ENABLED = (() => {
  const value = String(process.env.YAGAMI_MARKDOWN_RENDER ?? "")
    .trim()
    .toLowerCase();
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return Boolean(process.stdout.isTTY);
})();

function normalizeMarkdownForRender(markdown: string): string {
  const lines = String(markdown ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const output: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmedStart = line.trimStart();
    if (/^(```|~~~)/.test(trimmedStart)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    let normalized = line;
    normalized = normalized.replace(/^ {4}(?=(?:[*+-]|\d+\.)\s)/, "");

    if (/^-{20,}\s*$/.test(normalized.trim())) {
      normalized = "---";
    }

    output.push(normalized);
  }

  return output.join("\n");
}

function renderMarkdownForTerminal(markdown: string): string {
  const source = normalizeMarkdownForRender(markdown);
  if (!source.trim()) return "";
  if (!MARKDOWN_RENDER_ENABLED) return source;

  try {
    const rendered = renderAnsiMarkdown(source, {
      wrap: false,
      codeBox: false,
      tableTruncate: false,
    });
    return typeof rendered === "string" ? rendered.trimEnd() : source;
  } catch {
    return source;
  }
}

function printUsage(): void {
  console.log(`Local-first web search agent

Usage:
  yagami --version
  yagami start
  yagami stop
  yagami status [--cache] [--limit N] [--tokens] [--json]
  yagami reload [--json]
  yagami doctor [--json]
  yagami theme [preview] [--json]
  yagami config path [--json]
  yagami config show [--json]
  yagami config get <key> [--json]
  yagami config set <key> <value> [--json-value] [--json]
  yagami config unset <key> [--json]
  yagami search <text> [--json] [--profile]
  yagami search-advanced <query> [--json] [--profile]
  yagami code <query> [--json] [--profile]
  yagami company <name> [--json] [--profile]
  yagami similar <url> [--json] [--profile]
  yagami prompt [search|code|company|similar|deep]
  yagami fetch <url> [--max-chars N] [--no-cache] [--json]
  yagami deep start <instructions> [--effort fast|balanced|thorough] [--json]
  yagami deep check <researchId> [--json]
  yagami <text>  # shorthand for search

Environment:
  YAGAMI_LLM_API                (default: ${config.llmApi || "openai-completions"})
  YAGAMI_LLM_BASE_URL           (default: ${config.llmBaseUrl})
  YAGAMI_LLM_API_KEY            (default: ${config.llmApiKey || ""})
  YAGAMI_LLM_MODEL              (optional)
  YAGAMI_SEARCH_ENGINE          (default: ${config.searchEngine})
  YAGAMI_SEARCH_ENGINE_URL_TEMPLATE (optional; use {query} placeholder)
  YAGAMI_CDP_URL                (default: ${config.lightpandaCdpUrl})
  YAGAMI_BROWSE_LINK_TIMEOUT_MS (default: ${config.browseLinkTimeoutMs})
  YAGAMI_HOST                   (default: ${config.host})
  YAGAMI_PORT                   (default: ${config.port})
`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHostPortFromUrl(rawUrl: string, fallbackPort: number): { host: string; port: number } {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname || "127.0.0.1";
    const port = url.port ? Number.parseInt(url.port, 10) : fallbackPort;
    return { host, port: Number.isFinite(port) ? port : fallbackPort };
  } catch {
    return { host: "127.0.0.1", port: fallbackPort };
  }
}

async function checkTcpPort(host: string, port: number, timeoutMs = 1500): Promise<{ ok: boolean; error?: string }> {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, error: `timeout after ${timeoutMs}ms` }));
    socket.once("error", (error) => finish({ ok: false, error: error?.message || String(error) }));

    try {
      socket.connect(port, host);
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function normalizeLlmApi(value: unknown): "anthropic-messages" | "openai-completions" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "anthropic-messages") return "anthropic-messages";
  return "openai-completions";
}

function resolveRuntimeApiKey(api: "anthropic-messages" | "openai-completions", value: unknown): string {
  const key = String(value ?? "").trim();
  if (key) return key;
  return api === "anthropic-messages" ? "local" : "none";
}

function joinUrl(baseUrl: string, pathname: string): string {
  const left = String(baseUrl || "").replace(/\/+$/, "");
  const right = String(pathname || "").replace(/^\/+/, "");
  if (!left) return `/${right}`;
  if (!right) return left;
  return `${left}/${right}`;
}

function anthropicModelsUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/v1$/i.test(trimmed)) return joinUrl(trimmed, "models");
  return joinUrl(trimmed, "v1/models");
}

async function checkModelEndpoint(): Promise<{
  ok: boolean;
  api: string;
  baseUrl: string;
  model?: string | null;
  modelsCount?: number;
  error?: string;
}> {
  const api = normalizeLlmApi(config.llmApi);
  const baseUrl = config.llmBaseUrl;

  const endpoint = api === "anthropic-messages" ? anthropicModelsUrl(baseUrl) : joinUrl(baseUrl, "models");
  const headers =
    api === "anthropic-messages"
      ? {
          "x-api-key": resolveRuntimeApiKey(api, config.llmApiKey),
          "anthropic-version": "2023-06-01",
        }
      : {
          authorization: `Bearer ${resolveRuntimeApiKey(api, config.llmApiKey)}`,
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        api,
        baseUrl,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const firstModel = payload?.data?.[0]?.id || null;

    return {
      ok: true,
      api,
      baseUrl,
      model: firstModel,
      modelsCount: Array.isArray(payload?.data) ? payload.data.length : 0,
    };
  } catch (error) {
    return {
      ok: false,
      api,
      baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await fsp.readFile(config.pidFile, "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function ensureRuntimeDir(): Promise<void> {
  await fsp.mkdir(config.runtimeDir, { recursive: true });
}

async function daemonRequest(
  pathname: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs ?? 15000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.daemonUrl}${pathname}`, {
      method,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let json: Record<string, unknown>;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth(): Promise<Record<string, unknown> | null> {
  try {
    const response = await daemonRequest("/health", { timeoutMs: 2000 });
    if (!response.ok) return null;
    return response.json;
  } catch {
    return null;
  }
}

async function waitForHealthy(timeoutMs = 15000): Promise<Record<string, unknown> | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await checkHealth();
    if (health?.ok) return health;
    await delay(250);
  }
  return null;
}

function parseCliArgs(args: string[]): { positional: string[]; flags: Record<string, unknown> } {
  const positional: string[] = [];
  const flags: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] || "";

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    if (!withoutPrefix) continue;

    const eqIndex = withoutPrefix.indexOf("=");
    if (eqIndex >= 0) {
      const key = withoutPrefix.slice(0, eqIndex);
      const value = withoutPrefix.slice(eqIndex + 1);
      if (!key) continue;
      if (flags[key] === undefined) flags[key] = value;
      else if (Array.isArray(flags[key])) (flags[key] as unknown[]).push(value);
      else flags[key] = [flags[key], value];
      continue;
    }

    const key = withoutPrefix;
    const next = args[i + 1];
    const hasValue = next !== undefined && !String(next).startsWith("--");
    const value: unknown = hasValue ? next : true;

    if (flags[key] === undefined) flags[key] = value;
    else if (Array.isArray(flags[key])) (flags[key] as unknown[]).push(value);
    else flags[key] = [flags[key], value];

    if (hasValue) i += 1;
  }

  return { positional, flags };
}

function getFlagValue(flags: Record<string, unknown>, key: string, fallback: unknown = undefined): unknown {
  const value = flags[key];
  if (value === undefined) return fallback;
  if (Array.isArray(value)) return value[value.length - 1];
  return value;
}

function getIntFlag(flags: Record<string, unknown>, key: string, fallback: number | undefined): number | undefined {
  const value = getFlagValue(flags, key, fallback);
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBoolFlag(flags: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = getFlagValue(flags, key, undefined);
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function getListFlag(flags: Record<string, unknown>, key: string): string[] {
  const value = flags[key];
  if (value === undefined || value === null) return [];

  const values = Array.isArray(value) ? value : [value];
  const output: string[] = [];

  for (const entry of values) {
    if (typeof entry !== "string") continue;
    for (const part of entry.split(",")) {
      const item = part.trim();
      if (item) output.push(item);
    }
  }

  return Array.from(new Set(output));
}

async function readStdinIfAvailable(): Promise<string> {
  if (process.stdin.isTTY) return "";

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8").trim();
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) output[key] = item;
  }
  return output as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseConfigKeyPath(raw: unknown): string[] {
  const key = String(raw || "").trim();
  if (!key) throw new Error("config key is required");

  const parts = key.split(".").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => !part)) {
    throw new Error(`invalid config key path: ${key}`);
  }

  return parts;
}

function getValueAtKeyPath(source: Record<string, unknown>, pathParts: string[]): unknown {
  let cursor: unknown = source;

  for (const part of pathParts) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[part];
  }

  return cursor;
}

function setValueAtKeyPath(target: Record<string, unknown>, pathParts: string[], value: unknown): void {
  if (pathParts.length === 0) return;

  let cursor: Record<string, unknown> = target;

  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const segment = pathParts[index];
    const next = cursor[segment];

    if (!isPlainObject(next)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[pathParts[pathParts.length - 1]] = value;
}

function unsetValueAtKeyPath(target: Record<string, unknown>, pathParts: string[]): boolean {
  if (pathParts.length === 0) return false;

  const stack: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let cursor: Record<string, unknown> = target;

  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const segment = pathParts[index];
    const next = cursor[segment];
    if (!isPlainObject(next)) return false;

    stack.push({ parent: cursor, key: segment });
    cursor = next;
  }

  const leaf = pathParts[pathParts.length - 1];
  if (!(leaf in cursor)) return false;

  delete cursor[leaf];

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const { parent, key } = stack[index];
    const value = parent[key];

    if (isPlainObject(value) && Object.keys(value).length === 0) {
      delete parent[key];
      continue;
    }

    break;
  }

  return true;
}

async function readConfigFileObject(configFile: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fsp.readFile(configFile, "utf8");
    if (!raw.trim()) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error(`config file must contain a JSON object: ${configFile}`);
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new Error(`invalid JSON in config file: ${configFile}`);
    }

    throw error;
  }
}

async function writeConfigFileObject(configFile: string, value: Record<string, unknown>): Promise<void> {
  await fsp.mkdir(path.dirname(configFile), { recursive: true });
  await fsp.writeFile(configFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatConfigValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

async function ensureDaemonRunning(): Promise<Record<string, unknown> | null> {
  const health = await checkHealth();
  if (!health?.ok) {
    console.error("yagami is not running. Start it first: yagami start");
    process.exitCode = 1;
    return null;
  }
  return health;
}

async function runCommandRequest(
  pathname: string,
  body: Record<string, unknown>,
  timeoutMs = config.queryTimeoutMs + 5000,
): Promise<Record<string, unknown>> {
  const response = await daemonRequest(pathname, {
    method: "POST",
    body,
    timeoutMs,
  });

  if (!response.ok || !response.json?.ok) {
    throw new Error(String(response.json?.error || `HTTP ${response.status}`));
  }

  return (response.json.result as Record<string, unknown>) || {};
}

async function cmdStart(): Promise<void> {
  await ensureRuntimeDir();

  const health = await checkHealth();
  if (health?.ok) {
    console.log(`yagami is already running on ${config.daemonUrl} (pid ${health.pid})`);
    return;
  }

  const outFd = fs.openSync(config.logFile, "a");
  const daemonPath = path.join(__dirname, "daemon.js");

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: ["ignore", outFd, outFd],
    env: { ...process.env },
  });

  child.unref();
  fs.closeSync(outFd);

  const ready = await waitForHealthy(20000);
  if (!ready) {
    console.error(`failed to start yagami daemon. See log: ${config.logFile}`);
    process.exitCode = 1;
    return;
  }

  console.log(`yagami started (pid ${ready.pid})`);
  console.log(`daemon: ${config.daemonUrl}`);
}

async function cmdStop(): Promise<void> {
  const pid = await readPid();

  try {
    await daemonRequest("/stop", { method: "POST", timeoutMs: 2000 });
  } catch {
    // noop
  }

  const started = Date.now();
  while (Date.now() - started < 5000) {
    const health = await checkHealth();
    if (!health?.ok) break;
    await delay(150);
  }

  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }

    await delay(500);

    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  if (fs.existsSync(config.pidFile)) {
    await fsp.unlink(config.pidFile).catch(() => {});
  }

  console.log("yagami stopped");
}

async function cmdReload(asJson: boolean): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  try {
    const response = await daemonRequest("/reload", {
      method: "POST",
      body: {},
      timeoutMs: Math.max(config.queryTimeoutMs + 5000, 30000),
    });

    if (!response.ok || !response.json?.ok) {
      throw new Error(String(response.json?.error || `HTTP ${response.status}`));
    }

    const result = (response.json.result as Record<string, unknown>) || {};

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            ...result,
          },
          null,
          2,
        ),
      );
      return;
    }

    const message = String(result.message || "reloaded runtime settings").trim();
    const applied = ((result.applied as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
    const restartOnlyChanges = Array.isArray(result.restartOnlyChanges)
      ? result.restartOnlyChanges.map((value) => String(value || "")).filter(Boolean)
      : [];

    console.log(message);

    if (Object.keys(applied).length > 0) {
      console.log(
        `active: llm=${String(applied.llmApi || "-")} ${String(applied.llmBaseUrl || "-")} · search=${String(applied.searchEngine || "duckduckgo")}`,
      );
      console.log(
        `timeouts: browseLink=${String(applied.browseLinkTimeoutMs || "-")}ms query=${String(applied.queryTimeoutMs || "-")}ms`,
      );
    }

    if (restartOnlyChanges.length > 0) {
      console.log(`restart required for: ${restartOnlyChanges.join(", ")}`);
    }
  } catch (error) {
    console.error(`reload failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function formatCompactDuration(ms: number): string {
  const value = Math.max(0, Number(ms || 0));
  if (value < 1000) return `${value}ms`;

  const sec = value / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;

  const min = sec / 60;
  if (min < 60) return `${min.toFixed(min < 10 ? 1 : 0)}m`;

  const hr = min / 60;
  return `${hr.toFixed(hr < 10 ? 1 : 0)}h`;
}

async function cmdStatus(args: string[], asJson: boolean): Promise<void> {
  const { flags } = parseCliArgs(args);
  const showCache = getBoolFlag(flags, "cache", false);
  const showTokens = getBoolFlag(flags, "tokens", getBoolFlag(flags, "token", false));
  const cacheLimit = getIntFlag(flags, "limit", 20) ?? 20;

  const needsExtendedStats = showCache || showTokens;

  let health = await checkHealth();
  if (needsExtendedStats && health?.ok) {
    try {
      const response = await daemonRequest("/stats", {
        method: "POST",
        body: {
          includeCacheEntries: showCache,
          cacheEntriesLimit: cacheLimit,
        },
        timeoutMs: 5000,
      });

      if (response.ok && response.json?.result && typeof response.json.result === "object") {
        health = {
          ...health,
          ...(response.json.result as Record<string, unknown>),
        };
      }
    } catch {
      // fall back to regular health snapshot
    }
  }

  const pid = await readPid();

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          running: Boolean(health?.ok),
          pid: health?.pid ?? pid ?? null,
          daemonUrl: config.daemonUrl,
          config: {
            theme: config.theme,
            configFile: config.configFile,
            themeTokens: config.themeTokens || {},
          },
          health: health || null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (health?.ok) {
    console.log(`yagami is running (pid ${health.pid})`);
    console.log(`daemon: ${config.daemonUrl}`);
    console.log(`model: ${health.model}`);
    console.log(
      `queries: ${health.queries} (active: ${health.activeQueries ?? 0}), cache hit/miss: ${health.cacheHits}/${health.cacheMisses}`,
    );
    console.log(
      `lightpanda: managed=${health.lightpandaManaged} pid=${health.lightpandaManagedPid ?? "-"} autoStart=${health.lightpandaAutoStart}`,
    );
    console.log(
      `research policy: maxPages=${health.researchMaxPages} maxHops=${health.researchMaxHops} sameDomainOnly=${health.researchSameDomainOnly}`,
    );

    const browseLinkTimeoutMs = Number(health.browseLinkTimeoutMs || config.browseLinkTimeoutMs || 0);
    const queryTimeoutMs = Number(health.queryTimeoutMs || config.queryTimeoutMs || 0);
    const cacheTtlMs = Number(health.cacheTtlMs || config.cacheTtlMs || 0);
    const maxHtmlChars = Number(health.maxHtmlChars || config.maxHtmlChars || 0);
    const maxMarkdownChars = Number(health.maxMarkdownChars || config.maxMarkdownChars || 0);
    console.log(`timeouts: browseLink=${browseLinkTimeoutMs}ms query=${queryTimeoutMs}ms`);
    console.log(`cache: ttl=${cacheTtlMs}ms`);
    console.log(`content limits: html=${maxHtmlChars} markdown=${maxMarkdownChars}`);

    const customThemeTokens =
      config.themeTokens && typeof config.themeTokens === "object" ? Object.keys(config.themeTokens).length : 0;

    const operationConcurrency = Number(health.operationConcurrency || config.operationConcurrency || 1);
    const browseConcurrency = Number(health.browseConcurrency || config.browseConcurrency || 1);
    const opActive = Number(health.operationSlotsActive || 0);
    const opPending = Number(health.operationSlotsPending || 0);
    const browseActive = Number(health.browseSlotsActive || 0);
    const browsePending = Number(health.browseSlotsPending || 0);

    console.log(
      `concurrency: operations=${operationConcurrency} (active=${opActive}, pending=${opPending}) · browse=${browseConcurrency} (active=${browseActive}, pending=${browsePending})`,
    );
    console.log(`tool execution: ${health.toolExecutionMode}`);
    console.log(`theme: ${config.theme}${customThemeTokens > 0 ? ` (custom tokens: ${customThemeTokens})` : ""}`);
    console.log(`config file: ${config.configFile}`);
    console.log(`uptime: ${health.uptimeSec}s`);

    if (showTokens) {
      const tokens =
        (health.tokens && typeof health.tokens === "object" ? (health.tokens as Record<string, unknown>) : {}) || {};
      const tokenCost =
        (tokens.cost && typeof tokens.cost === "object" ? (tokens.cost as Record<string, unknown>) : {}) || {};

      const tokenInput = Number(tokens.input || 0);
      const tokenOutput = Number(tokens.output || 0);
      const tokenCacheRead = Number(tokens.cacheRead || 0);
      const tokenCacheWrite = Number(tokens.cacheWrite || 0);
      const tokenTotal = Number(tokens.total || 0);
      const avgPerQuery = Number(tokens.avgPerQuery || 0);
      const costTotal = Number(tokenCost.total || 0);

      console.log(
        `tokens: in=${tokenInput} out=${tokenOutput} cacheRead=${tokenCacheRead} cacheWrite=${tokenCacheWrite} total=${tokenTotal} avg/query=${avgPerQuery}`,
      );
      console.log(`token cost: total=${costTotal.toFixed(6)}`);
    }

    if (showCache) {
      const cacheEntries = Array.isArray(health.cacheEntries)
        ? (health.cacheEntries as Array<Record<string, unknown>>)
        : [];

      if (cacheEntries.length === 0) {
        console.log(`cache entries: 0`);
      } else {
        console.log(`cache entries (showing ${cacheEntries.length}, limit=${cacheLimit}):`);
        for (const entry of cacheEntries) {
          const url = String(entry.url || "");
          const domain = domainFromUrl(url);
          const title = compactTitle(String(entry.title || ""));
          const ttl = formatCompactDuration(Number(entry.ttlMs || 0));
          const age = formatCompactDuration(Number(entry.ageMs || 0));
          const bytes = Number(entry.bytes || 0);
          const titlePart = title ? ` · ${title}` : "";
          console.log(`  - ${domain} · ttl=${ttl} · age=${age} · bytes=${bytes}${titlePart}`);
        }
      }
    }

    return;
  }

  if (pid && isProcessAlive(pid)) {
    console.log(`yagami process exists (pid ${pid}) but health check failed`);
    console.log(`check logs: ${config.logFile}`);
  } else {
    console.log("yagami is not running");
  }
}

async function cmdDoctor(asJson: boolean): Promise<void> {
  const daemon = await checkHealth();
  const pid = await readPid();
  const modelEndpoint = await checkModelEndpoint();
  const cdpEndpoint = parseHostPortFromUrl(config.lightpandaCdpUrl, config.lightpandaPort || 9222);
  const cdp = await checkTcpPort(cdpEndpoint.host, cdpEndpoint.port, 2000);

  const llmReport = {
    ok: modelEndpoint.ok,
    api: modelEndpoint.api,
    baseUrl: modelEndpoint.baseUrl,
    model: modelEndpoint.model || null,
    modelsCount: modelEndpoint.modelsCount || 0,
    error: modelEndpoint.error || null,
  };

  const report = {
    daemon: {
      ok: Boolean(daemon?.ok),
      pid: daemon?.pid ?? pid ?? null,
      url: config.daemonUrl,
    },
    llm: llmReport,
    lightpanda: {
      ok: cdp.ok,
      cdpUrl: config.lightpandaCdpUrl,
      host: cdpEndpoint.host,
      port: cdpEndpoint.port,
      autoStart: config.lightpandaAutoStart,
      error: cdp.error || null,
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const pass = (ok: boolean): string => (ok ? theme.icon("pass") : theme.icon("fail"));

  console.log(
    `Daemon      ${pass(report.daemon.ok)}  ${report.daemon.url} ${report.daemon.pid ? `(pid ${report.daemon.pid})` : ""}`.trim(),
  );
  const apiLabel = String(report.llm.api || "openai-completions");
  console.log(`LLM         ${pass(report.llm.ok)}  ${report.llm.baseUrl} (${apiLabel})`);

  if (report.llm.ok) {
    console.log(`            model: ${report.llm.model || "unknown"} (${report.llm.modelsCount} available)`);
  } else {
    console.log(`            error: ${report.llm.error}`);
  }

  console.log(`Lightpanda  ${pass(report.lightpanda.ok)}  ${report.lightpanda.cdpUrl}`);
  if (!report.lightpanda.ok) {
    console.log(`            error: ${report.lightpanda.error}`);
    console.log(`            auto-start is ${report.lightpanda.autoStart ? "enabled" : "disabled"}`);
  }
}

async function cmdConfig(args: string[], asJson: boolean): Promise<void> {
  const runtimeConfig = getConfig();
  const configFile = runtimeConfig.configFile;

  const { positional, flags } = parseCliArgs(args);
  const action = String(positional[0] || "show")
    .trim()
    .toLowerCase();

  if (action === "path") {
    if (asJson) {
      console.log(JSON.stringify({ configFile }, null, 2));
      return;
    }

    console.log(configFile);
    return;
  }

  if (action === "show" || action === "list") {
    const values = await readConfigFileObject(configFile);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            configFile,
            values,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(JSON.stringify(values, null, 2));
    return;
  }

  if (action === "get") {
    const key = String(positional[1] || "").trim();
    if (!key) {
      console.error("missing config key\n");
      printUsage();
      process.exitCode = 1;
      return;
    }

    const pathParts = parseConfigKeyPath(key);
    const values = await readConfigFileObject(configFile);
    const value = getValueAtKeyPath(values, pathParts);

    if (value === undefined) {
      console.error(`config key not found: ${key}`);
      process.exitCode = 1;
      return;
    }

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            configFile,
            key,
            value,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(formatConfigValue(value));
    return;
  }

  if (action === "set") {
    const key = String(positional[1] || "").trim();
    if (!key) {
      console.error("missing config key\n");
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (positional.length < 3) {
      console.error("missing config value\n");
      printUsage();
      process.exitCode = 1;
      return;
    }

    const pathParts = parseConfigKeyPath(key);
    const rawValue = positional.slice(2).join(" ");
    const asJsonValue = getBoolFlag(flags, "json-value", false);

    let value: unknown = rawValue;
    if (asJsonValue) {
      try {
        value = JSON.parse(rawValue);
      } catch (error) {
        throw new Error(
          `invalid --json-value for key '${key}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const values = await readConfigFileObject(configFile);
    setValueAtKeyPath(values, pathParts, value);
    await writeConfigFileObject(configFile, values);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            configFile,
            key,
            value,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`set ${key} in ${configFile}`);
    console.log(formatConfigValue(value));
    return;
  }

  if (action === "unset") {
    const key = String(positional[1] || "").trim();
    if (!key) {
      console.error("missing config key\n");
      printUsage();
      process.exitCode = 1;
      return;
    }

    const pathParts = parseConfigKeyPath(key);
    const values = await readConfigFileObject(configFile);
    const removed = unsetValueAtKeyPath(values, pathParts);

    if (!removed) {
      console.error(`config key not found: ${key}`);
      process.exitCode = 1;
      return;
    }

    await writeConfigFileObject(configFile, values);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            configFile,
            key,
            removed: true,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`unset ${key} in ${configFile}`);
    return;
  }

  console.error("config command requires subcommand: path|show|get|set|unset\n");
  printUsage();
  process.exitCode = 1;
}

function domainFromUrl(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "").slice(0, 48);
  }
}

function compactTitle(title: unknown, maxLen = 72): string {
  const value = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1)}…`;
}

function compactErrorMessage(errorMessage: unknown, maxLen = 120): string {
  const ansiEscape = String.fromCharCode(27);
  const stripped = String(errorMessage || "")
    .split(ansiEscape)
    .join("")
    .replace(/\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) return "request failed";

  let compact = stripped
    .replace(/^Error:\s*/i, "")
    .replace(/^page\.goto:\s*/i, "")
    .replace(/^page\.content:\s*/i, "")
    .replace(/^browser\.newContext:\s*/i, "")
    .replace(/Call log:.*$/i, "")
    .trim();

  if (!compact) compact = "request failed";
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen - 1)}…`;
}

function formatMs(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${Math.round(value)}ms`;
}

function printProfile(profile: Record<string, unknown> | null | undefined): void {
  if (!profile) {
    console.log("\nProfile: unavailable");
    return;
  }

  const summary = (profile.summary as Record<string, unknown> | undefined) || {};
  const byTool = (profile.byTool as Record<string, Record<string, unknown>> | undefined) || {};

  console.log("\nProfile:");
  console.log(`- total: ${formatMs(profile.totalMs)}`);
  console.log(`- first assistant token: ${formatMs(profile.firstAssistantTokenMs)}`);
  console.log(`- turns: ${summary.turnCount ?? 0}, assistant messages: ${summary.assistantMessageCount ?? 0}`);
  console.log(`- tool calls: ${summary.toolCallCount ?? 0} (errors: ${summary.toolErrorCount ?? 0})`);
  console.log(`- tool duration sum: ${formatMs(summary.toolDurationSumMs)}`);

  const toolNames = Object.keys(byTool);
  if (toolNames.length > 0) {
    console.log("- by tool:");
    for (const toolName of toolNames) {
      const stats = byTool[toolName] || {};
      console.log(
        `  • ${toolName}: count=${stats.count ?? 0}, err=${stats.errors ?? 0}, avg=${formatMs(stats.durationAvgMs)}, sum=${formatMs(stats.durationSumMs)}, cache hit/miss=${stats.cacheHits ?? 0}/${stats.cacheMisses ?? 0}`,
      );
    }
  }

  const tools = Array.isArray(profile.tools) ? (profile.tools as Array<Record<string, unknown>>) : [];
  if (tools.length > 0) {
    const slowest = [...tools]
      .filter((tool) => typeof tool.durationMs === "number")
      .sort((a, b) => Number(b.durationMs || 0) - Number(a.durationMs || 0))
      .slice(0, 3);

    if (slowest.length > 0) {
      console.log("- slowest calls:");
      for (const tool of slowest) {
        const target = tool.url ? ` ${tool.url}` : "";
        console.log(`  • ${tool.toolName || "tool"}: ${formatMs(tool.durationMs)}${target}`);
      }
    }
  }
}

function printQueryResult(
  result: Record<string, unknown>,
  options: { answerOverride?: string; skipAnswer?: boolean; asProfile?: boolean } = {},
): void {
  const answerOverride = options.answerOverride;
  const skipAnswer = options.skipAnswer ?? false;
  const asProfile = options.asProfile ?? false;

  const answer = String(answerOverride ?? result.answer ?? "").trim() || "(no answer returned)";

  if (!skipAnswer) {
    console.log("");
    console.log(renderMarkdownForTerminal(answer));
  }

  const durationMs = typeof result.durationMs === "number" ? result.durationMs : null;
  const durationSec = typeof durationMs === "number" ? `${(durationMs / 1000).toFixed(1)}s` : "-";
  const model = String(result.model || "unknown");
  const toolsUsed = Array.isArray(result.toolsUsed) ? result.toolsUsed : [];
  const toolCount = toolsUsed.length;
  const errorCount = toolsUsed.filter((entry) => Boolean((entry as Record<string, unknown>).isError)).length;
  const errorSuffix = errorCount > 0 ? ` · ${errorCount} failed` : "";
  console.log(`\n${theme.styleDim(`${durationSec} · ${model} · ${toolCount} tool calls${errorSuffix}`)}`);

  if (asProfile) {
    printProfile((result.profile as Record<string, unknown> | undefined) || null);
  }
}

interface StreamPageEntry {
  pageNo: number;
  url: string;
  domain: string;
  ok: boolean;
  status?: string;
  browseCallId?: string;
  presentCallId?: string;
  documentId?: string | null;
  title?: string;
  browseMs?: number;
  presentMs?: number;
  cache?: string;
  presentCache?: string;
  totalMs?: number;
  finalized?: boolean;
  error?: string;
}

async function queryWithLiveStream(
  query: string,
  options: { streamPath?: string; requestBody?: Record<string, unknown> | null; asProfile?: boolean } = {},
): Promise<void> {
  const streamPath = options.streamPath || "/search/stream";
  const requestBody = options.requestBody;
  const asProfile = options.asProfile ?? false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.queryTimeoutMs + 5000);

  let abortedByUserSignal = false;
  const onUserAbortSignal = () => {
    abortedByUserSignal = true;
    controller.abort();
  };

  process.once("SIGINT", onUserAbortSignal);
  process.once("SIGTERM", onUserAbortSignal);

  const payload = requestBody && typeof requestBody === "object" ? requestBody : { query };

  let response: Response;
  try {
    response = await fetch(`${config.daemonUrl}${streamPath}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    clearTimeout(timer);
    process.removeListener("SIGINT", onUserAbortSignal);
    process.removeListener("SIGTERM", onUserAbortSignal);

    if (abortedByUserSignal || controller.signal.aborted) {
      throw new Error("request aborted by user");
    }

    throw error;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`search stream failed: HTTP ${response.status}${text ? ` ${text.slice(0, 300)}` : ""}`);
  }

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinnerEnabled = process.stdout.isTTY;

  const state = {
    phase: "Starting",
    turn: 0,

    maxPages: null as number | null,
    queryStartedAt: Date.now(),
    nextPageNo: 0,
    pages: [] as StreamPageEntry[],
    inFlightByCallId: new Map<string, StreamPageEntry>(),
    byDocumentId: new Map<string, StreamPageEntry>(),
  };

  let spinnerIndex = 0;
  let spinnerInterval: NodeJS.Timeout | null = null;
  let spinnerVisible = false;
  let pagesPrinted = 0;

  function clearSpinnerLine() {
    if (!spinnerEnabled) return;
    if (!spinnerVisible) return;

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    readline.moveCursor(process.stdout, 0, -1);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    spinnerVisible = false;
  }

  function printEventLine(line: string) {
    clearSpinnerLine();
    process.stdout.write(`${line}\n`);
  }

  function renderPageLine(entry: StreamPageEntry): string {
    const domain = theme.styleDomain(entry.domain || "unknown");

    if (entry.ok) {
      const title = compactTitle(entry.title);
      const titlePart = title ? ` ${theme.styleTitle(title)}` : "";
      const cacheHit = entry.cache === "hit" || entry.presentCache === "hit";
      const cachePart = cacheHit ? ` ${theme.styleDim(theme.icon("cache"))}` : "";
      return `${theme.icon("bullet")} ${domain}${titlePart}${cachePart}`;
    }

    const reason = compactErrorMessage(entry.error || "request failed");
    return `${theme.icon("bullet")} ${domain} ${theme.styleError(`— ${reason}`)}`;
  }

  function formatSpinnerPhase(phase: string): string {
    const normalized = String(phase || "").trim();

    const phaseMatch = normalized.match(/^(Reading|Extracting)\s+(.+)$/i);
    if (phaseMatch) {
      const verb = String(phaseMatch[1] || "");
      const domain = String(phaseMatch[2] || "");
      return `${theme.styleDim(verb)} ${theme.styleDimItalic(domain)}`;
    }

    return theme.styleDim(normalized || "Working");
  }

  function spinnerLabel() {
    const elapsedMs = Date.now() - state.queryStartedAt;
    const elapsed = elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;
    return `${formatSpinnerPhase(state.phase)} ${theme.styleDim("·")} ${theme.styleDim(elapsed)}`;
  }

  function renderSpinner() {
    if (!spinnerEnabled) return;
    const frame = spinnerFrames[spinnerIndex % spinnerFrames.length] || "·";
    spinnerIndex += 1;
    clearSpinnerLine();
    process.stdout.write(`\n${theme.styleDuration(frame)} ${spinnerLabel()}`);
    spinnerVisible = true;
  }

  function startSpinner() {
    if (!spinnerEnabled) return;
    if (spinnerInterval) return;
    renderSpinner();
    spinnerInterval = setInterval(renderSpinner, 90);
  }

  function stopSpinner() {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
    clearSpinnerLine();
  }

  function finalizePage(entry: StreamPageEntry) {
    if (!entry || entry.finalized) return;
    entry.finalized = true;

    if (pagesPrinted > 0) {
      printEventLine(theme.styleDim(theme.icon("connector")));
    }

    printEventLine(renderPageLine(entry));
    pagesPrinted += 1;
  }

  function onProgress(event: Record<string, unknown>) {
    const eventType = String(event?.type || "");

    if (eventType === "query_start") {
      state.phase = "Planning";
      const maxPages = (event.researchPlan as Record<string, unknown> | undefined)?.maxPages;
      state.maxPages = typeof maxPages === "number" ? maxPages : state.maxPages;

      return;
    }

    if (eventType === "turn_start") {
      const turn = event.turn;
      state.turn = typeof turn === "number" ? turn : state.turn;
      state.phase = "Thinking";
      return;
    }

    if (eventType === "first_token") {
      state.phase = "Collecting findings";
      return;
    }

    if (eventType === "assistant_delta") {
      // Collate mode: assistant deltas are internal (URL selection), not streamed to user
      return;
    }

    if (eventType === "tool_start") {
      const toolName = String(event.toolName || "");

      if (toolName === "browse") {
        const args = (event.args as Record<string, unknown>) || {};
        const url = String(args.url || "");
        const entry: StreamPageEntry = {
          pageNo: state.nextPageNo + 1,
          url,
          domain: domainFromUrl(url),
          ok: false,
          status: "browsing",
          browseCallId: String(event.toolCallId || ""),
        };

        state.nextPageNo += 1;
        state.pages.push(entry);
        if (entry.browseCallId) state.inFlightByCallId.set(entry.browseCallId, entry);
        state.phase = `Reading ${entry.domain}`;
        return;
      }

      if (toolName === "present") {
        const args = (event.args as Record<string, unknown>) || {};
        const documentId = String(args.documentId || "");
        const page = documentId ? state.byDocumentId.get(documentId) : null;

        if (page) {
          page.presentCallId = String(event.toolCallId || "");
          page.status = "extracting";
          if (page.presentCallId) state.inFlightByCallId.set(page.presentCallId, page);
          state.phase = `Extracting ${page.domain}`;
        } else {
          state.phase = "Extracting";
        }
      }
      return;
    }

    if (eventType === "tool_end") {
      const toolName = String(event.toolName || "");
      const toolCallId = String(event.toolCallId || "");

      if (toolName === "browse") {
        let entry = state.inFlightByCallId.get(toolCallId);
        state.inFlightByCallId.delete(toolCallId);

        if (!entry) {
          const url = String(event.url || "");
          entry = {
            pageNo: state.nextPageNo + 1,
            url,
            domain: domainFromUrl(url),
            ok: false,
          };
          state.nextPageNo += 1;
          state.pages.push(entry);
        }

        entry.url = String(event.url || entry.url);
        entry.domain = domainFromUrl(entry.url);
        entry.documentId = String(event.documentId || "") || null;
        entry.title = String(event.title || entry.title || "");
        entry.browseMs = typeof event.durationMs === "number" ? event.durationMs : undefined;
        entry.cache = String(event.cache || "") || undefined;

        if (typeof event.maxPages === "number") {
          state.maxPages = event.maxPages;
        }

        if (event.isError) {
          entry.ok = false;
          entry.error = String(event.errorMessage || "request failed");
          entry.totalMs = entry.browseMs;
          finalizePage(entry);
        } else if (entry.documentId) {
          entry.ok = true;
          entry.status = "browsed";
          state.byDocumentId.set(entry.documentId, entry);
        } else {
          entry.ok = true;
          entry.totalMs = entry.browseMs;
          finalizePage(entry);
        }

        state.phase = "Thinking";
        return;
      }

      if (toolName === "present") {
        let entry = state.inFlightByCallId.get(toolCallId);
        state.inFlightByCallId.delete(toolCallId);

        const documentId = String(event.documentId || "");
        if (!entry && documentId) {
          entry = state.byDocumentId.get(documentId);
        }

        if (!entry) return;

        entry.presentMs = typeof event.durationMs === "number" ? event.durationMs : undefined;
        entry.presentCache = String(event.cache || "") || undefined;
        entry.title = String(event.title || entry.title || "");

        if (event.isError) {
          entry.ok = false;
          entry.error = String(event.errorMessage || "content extraction failed");
        } else {
          entry.ok = true;
        }

        entry.totalMs = (entry.browseMs || 0) + (entry.presentMs || 0);
        if (entry.documentId) {
          state.byDocumentId.delete(entry.documentId);
        }

        finalizePage(entry);
        state.phase = "Thinking";
      }
      return;
    }

    if (eventType === "query_end") {
      state.phase = "Finalizing";
      for (const page of state.pages) {
        if (!page.finalized && (page.browseMs || page.presentMs)) {
          page.ok = page.ok !== false;
          page.totalMs = page.totalMs || page.browseMs || page.presentMs;
          finalizePage(page);
        }
      }
    }
  }

  startSpinner();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: Record<string, unknown> | null = null;
  let streamError: string | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          let parsedPayload: Record<string, unknown> | null = null;
          try {
            parsedPayload = JSON.parse(line) as Record<string, unknown>;
          } catch {
            parsedPayload = null;
          }

          if (parsedPayload?.type === "progress") {
            onProgress((parsedPayload.event as Record<string, unknown>) || {});
          } else if (parsedPayload?.type === "result") {
            finalResult = (parsedPayload.result as Record<string, unknown>) || null;
          } else if (parsedPayload?.type === "error") {
            streamError = String(parsedPayload.error || "unknown stream error");
          }
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      try {
        const trailingPayload = JSON.parse(trailing) as Record<string, unknown>;
        if (trailingPayload?.type === "progress") {
          onProgress((trailingPayload.event as Record<string, unknown>) || {});
        }
        if (trailingPayload?.type === "result") {
          finalResult = (trailingPayload.result as Record<string, unknown>) || null;
        }
        if (trailingPayload?.type === "error") {
          streamError = String(trailingPayload.error || "unknown stream error");
        }
      } catch {
        // ignore malformed trailing chunk
      }
    }
  } catch (error) {
    if (abortedByUserSignal || controller.signal.aborted) {
      throw new Error("request aborted by user");
    }

    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onUserAbortSignal);
    process.removeListener("SIGTERM", onUserAbortSignal);
    stopSpinner();
  }

  if (streamError) {
    throw new Error(streamError);
  }

  if (!finalResult) {
    if (abortedByUserSignal || controller.signal.aborted) {
      throw new Error("request aborted by user");
    }

    throw new Error("search stream ended without result");
  }

  printQueryResult(finalResult, { asProfile });
}

async function cmdPrompt(args: string[]): Promise<void> {
  const { deriveResearchPlan, buildSystemPrompt } = await import("./engine/policy.js");

  const mode = (args[0] || "search").toLowerCase();
  const modeMap: Record<string, string> = {
    search: "general",
    general: "general",
    code: "code",
    company: "company",
    similar: "similar",
    deep: "deep",
  };

  const policyMode = modeMap[mode];
  if (!policyMode) {
    console.error(`Unknown mode: ${mode}. Options: search, code, company, similar, deep`);
    process.exitCode = 1;
    return;
  }

  const plan = deriveResearchPlan("(query)", config, {
    researchPolicy: { mode: policyMode },
  });

  const searchEngine = config.searchEngine || "duckduckgo";
  const template = `https://${searchEngine}.com/?q=<url-encoded query>`;

  const prompt = buildSystemPrompt(plan, { engine: searchEngine, template });
  console.log(prompt);
}

async function cmdSearch(args: string[], asJson: boolean, asProfile = false): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  const { positional } = parseCliArgs(args);
  let query = positional.join(" ").trim();
  if (!query) query = await readStdinIfAvailable();

  if (!query) {
    console.error("missing search text\n");
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!asJson) {
    try {
      await queryWithLiveStream(query, {
        streamPath: "/search/stream",
        requestBody: { query },
        asProfile,
      });
    } catch (error) {
      console.error(`search failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  try {
    const result = await runCommandRequest("/search", { query });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`search failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function cmdSearchAdvanced(args: string[], asJson: boolean, asProfile = false): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  const { positional, flags } = parseCliArgs(args);
  let query = positional.join(" ").trim();
  if (!query) query = await readStdinIfAvailable();

  if (!query) {
    console.error("missing search text\n");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const requestBody = omitUndefined({
    query,

    numResults: getIntFlag(flags, "num-results", undefined),
    type: getFlagValue(flags, "type", undefined),
    category: getFlagValue(flags, "category", undefined),
    includeDomains: getListFlag(flags, "include-domains"),
    excludeDomains: getListFlag(flags, "exclude-domains"),
    startPublishedDate: getFlagValue(flags, "start-published-date", undefined),
    endPublishedDate: getFlagValue(flags, "end-published-date", undefined),
    includeText: getListFlag(flags, "include-text"),
    excludeText: getListFlag(flags, "exclude-text"),
    livecrawl: getFlagValue(flags, "livecrawl", undefined),
    textMaxCharacters: getIntFlag(flags, "text-max-characters", undefined),
    contextMaxCharacters: getIntFlag(flags, "context-max-characters", undefined),
  });

  if (!asJson) {
    try {
      await queryWithLiveStream(query, {
        streamPath: "/search/advanced/stream",
        requestBody,
        asProfile,
      });
    } catch (error) {
      console.error(`search-advanced failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }

    return;
  }

  try {
    const result = await runCommandRequest("/search/advanced", requestBody);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`search-advanced failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function cmdCode(args: string[], asJson: boolean, asProfile = false): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  const { positional, flags } = parseCliArgs(args);
  let query = positional.join(" ").trim();
  if (!query) query = await readStdinIfAvailable();

  if (!query) {
    console.error("missing code search text\n");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const requestBody = omitUndefined({
    query,

    numResults: getIntFlag(flags, "num-results", undefined),
    includeDomains: getListFlag(flags, "include-domains"),
    excludeDomains: getListFlag(flags, "exclude-domains"),
    sites: getListFlag(flags, "sites"),
    type: getFlagValue(flags, "type", undefined),
    livecrawl: getFlagValue(flags, "livecrawl", undefined),
    includeText: getListFlag(flags, "include-text"),
    excludeText: getListFlag(flags, "exclude-text"),
    startPublishedDate: getFlagValue(flags, "start-published-date", undefined),
    endPublishedDate: getFlagValue(flags, "end-published-date", undefined),
    customInstruction: getFlagValue(flags, "instruction", getFlagValue(flags, "instructions", undefined)),
  });

  if (!asJson) {
    try {
      await queryWithLiveStream(query, {
        streamPath: "/code-context/stream",
        requestBody,
        asProfile,
      });
    } catch (error) {
      console.error(`code failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }

    return;
  }

  try {
    const result = await runCommandRequest("/code-context", requestBody);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`code failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function cmdCompany(args: string[], asJson: boolean, asProfile = false): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  const { positional, flags } = parseCliArgs(args);
  let companyName = positional.join(" ").trim();
  if (!companyName) companyName = await readStdinIfAvailable();

  if (!companyName) {
    console.error("missing company name\n");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const requestBody = omitUndefined({
    companyName,
    query: companyName,

    country: getFlagValue(flags, "country", undefined),
    numResults: getIntFlag(flags, "num-results", undefined),
    type: getFlagValue(flags, "type", undefined),
    sites: getListFlag(flags, "sites"),
    seedUrls: getListFlag(flags, "seed-urls"),
    includeDomains: getListFlag(flags, "include-domains"),
    excludeDomains: getListFlag(flags, "exclude-domains"),
    includeText: getListFlag(flags, "include-text"),
    excludeText: getListFlag(flags, "exclude-text"),
    startPublishedDate: getFlagValue(flags, "start-published-date", undefined),
    endPublishedDate: getFlagValue(flags, "end-published-date", undefined),
    customInstruction: getFlagValue(flags, "instruction", getFlagValue(flags, "instructions", undefined)),
  });

  if (!asJson) {
    try {
      await queryWithLiveStream(companyName, {
        streamPath: "/company-research/stream",
        requestBody,
        asProfile,
      });
    } catch (error) {
      console.error(`company failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }

    return;
  }

  try {
    const result = await runCommandRequest("/company-research", requestBody);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`company failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function cmdSimilar(args: string[], asJson: boolean, asProfile = false): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  const { positional, flags } = parseCliArgs(args);
  const url = String(positional[0] || "").trim();

  if (!url) {
    console.error("missing URL\n");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const instruction = getFlagValue(flags, "instruction", getFlagValue(flags, "instructions", undefined));
  const instructionText = typeof instruction === "string" ? instruction.trim() : "";

  const query = instructionText
    ? `Find web pages similar to ${url}. ${instructionText}`
    : `Find web pages similar to ${url}. Focus on same product category, target users, and use-case overlap. Avoid generic dictionary or synonym pages.`;

  const requestBody = omitUndefined({
    url,
    query,
    mode: "similar",

    sites: getListFlag(flags, "sites"),
    seedUrls: [url, ...getListFlag(flags, "seed-urls")],
    numResults: getIntFlag(flags, "num-results", undefined),
    type: getFlagValue(flags, "type", undefined),
    includeDomains: getListFlag(flags, "include-domains"),
    excludeDomains: getListFlag(flags, "exclude-domains"),
    includeText: getListFlag(flags, "include-text"),
    excludeText: getListFlag(flags, "exclude-text"),
    customInstruction: instructionText || undefined,
  });

  if (!asJson) {
    try {
      await queryWithLiveStream(query, {
        streamPath: "/find-similar/stream",
        requestBody,
        asProfile,
      });
    } catch (error) {
      console.error(`similar failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }

    return;
  }

  try {
    const result = await runCommandRequest("/find-similar", requestBody);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`similar failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function cmdFetch(args: string[], asJson: boolean): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  const { positional, flags } = parseCliArgs(args);
  const url = String(positional[0] || "").trim();

  if (!url) {
    console.error("missing URL\n");
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runCommandRequest(
      "/fetch",
      omitUndefined({
        url,
        maxCharacters: getIntFlag(flags, "max-chars", getIntFlag(flags, "max-characters", undefined)),
        noCache: getBoolFlag(flags, "no-cache", false),
      }),
    );

    if (asJson) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }

    const title = String(result.title || "").trim();
    const canonicalUrl = String(result.url || result.requestedUrl || url).trim();
    const content = String(result.content || "(no content)");
    const timing = result.timing as Record<string, unknown> | undefined;
    const cache = result.cache as Record<string, unknown> | undefined;
    const totalMs = typeof timing?.totalMs === "number" ? timing.totalMs : null;
    const total = typeof totalMs === "number" ? `${(totalMs / 1000).toFixed(1)}s` : "-";
    const cacheSummary = `browse=${cache?.browse || "-"}, present=${cache?.present || "-"}`;

    if (title) console.log(title);
    console.log(canonicalUrl);
    console.log("");
    console.log(content);
    console.log(`\n${total} · ${cacheSummary}`);
  } catch (error) {
    console.error(`fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function cmdDeep(args: string[], asJson: boolean): Promise<void> {
  const health = await ensureDaemonRunning();
  if (!health) return;

  const { positional, flags } = parseCliArgs(args);
  const action = String(positional[0] || "")
    .trim()
    .toLowerCase();

  if (action === "start") {
    const effortChoices = new Set(["fast", "balanced", "thorough"]);

    const effortFlagRaw = getFlagValue(flags, "effort", undefined);
    const effortFromFlag =
      typeof effortFlagRaw === "string" && effortChoices.has(effortFlagRaw.trim().toLowerCase())
        ? effortFlagRaw.trim().toLowerCase()
        : undefined;

    let instructionTokens = positional.slice(1);
    let inferredEffort = effortFromFlag;

    // Ergonomic fallback for npm script invocation where '--effort' can be swallowed
    // (e.g. npm run deep start "..." --effort thorough -> trailing 'thorough').
    if (!inferredEffort && instructionTokens.length > 1) {
      const trailing = String(instructionTokens[instructionTokens.length - 1] || "")
        .trim()
        .toLowerCase();
      if (effortChoices.has(trailing)) {
        inferredEffort = trailing;
        instructionTokens = instructionTokens.slice(0, -1);
      }
    }

    const instructions = instructionTokens.join(" ").trim();
    if (!instructions) {
      console.error("missing research instructions\n");
      printUsage();
      process.exitCode = 1;
      return;
    }

    try {
      const result = await runCommandRequest(
        "/deep-research/start",
        omitUndefined({
          instructions,
          effort: inferredEffort,
        }),
        config.queryTimeoutMs + 2000,
      );

      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const researchId = String(result.researchId || "").trim();
      const effort = String(result.effort || inferredEffort || "").trim();
      const message = String(result.message || "Research started").trim();

      if (researchId) console.log(`researchId: ${researchId}`);
      if (effort) console.log(`effort: ${effort}`);

      if (message && (!researchId || !message.includes(researchId))) {
        console.log(message);
      } else if (researchId) {
        console.log("Research started. Run: yagami deep check <researchId>");
      } else {
        console.log("Research started");
      }
    } catch (error) {
      console.error(`deep start failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "check") {
    const researchId = String(positional[1] || "").trim();
    if (!researchId) {
      console.error("missing researchId\n");
      printUsage();
      process.exitCode = 1;
      return;
    }

    try {
      const result = await runCommandRequest("/deep-research/check", { researchId }, config.queryTimeoutMs + 5000);

      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.status === "completed") {
        console.log(String(result.report || "(no report)"));

        const citations = normalizeUniqueUrls((result.citations as unknown[]) || []);
        if (citations.length > 0) {
          console.log("\nCitations:");
          for (const url of citations) console.log(`  ${url}`);
        }

        const durationMs = typeof result.durationMs === "number" ? result.durationMs : 0;
        const effortLabel = result.effort ? ` · effort=${result.effort}` : "";
        console.log(`\nstatus: completed · ${(durationMs / 1000).toFixed(1)}s${effortLabel}`);
      } else {
        console.log(`${result.status || "unknown"}: ${result.message || "no message"}`);
      }
    } catch (error) {
      console.error(`deep check failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }

    return;
  }

  console.error("deep command requires subcommand: start|check\n");
  printUsage();
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
    printUsage();
    return;
  }

  const first = String(argv[0] || "").toLowerCase();

  if (argv.length === 1 && (first === "-v" || first === "--version" || first === "version")) {
    console.log(CLI_VERSION);
    return;
  }
  const asJson = argv.includes("--json");
  const asProfile = argv.includes("--profile");

  if (first === "start") {
    await cmdStart();
    return;
  }

  if (first === "stop") {
    await cmdStop();
    return;
  }

  if (first === "status") {
    await cmdStatus(argv.slice(1), asJson);
    return;
  }

  if (first === "reload") {
    await cmdReload(asJson);
    return;
  }

  if (first === "doctor") {
    await cmdDoctor(asJson);
    return;
  }

  if (first === "theme") {
    await cmdTheme(config, argv.slice(1), { asJson, printUsage });
    return;
  }

  if (first === "config") {
    await cmdConfig(argv.slice(1), asJson);
    return;
  }

  if (first === "search") {
    await cmdSearch(argv.slice(1), asJson, asProfile);
    return;
  }

  if (first === "search-advanced") {
    await cmdSearchAdvanced(argv.slice(1), asJson, asProfile);
    return;
  }

  if (first === "code") {
    await cmdCode(argv.slice(1), asJson, asProfile);
    return;
  }

  if (first === "company") {
    await cmdCompany(argv.slice(1), asJson, asProfile);
    return;
  }

  if (first === "similar") {
    await cmdSimilar(argv.slice(1), asJson, asProfile);
    return;
  }

  if (first === "prompt") {
    await cmdPrompt(argv.slice(1));
    return;
  }

  if (first === "fetch") {
    await cmdFetch(argv.slice(1), asJson);
    return;
  }

  if (first === "deep") {
    await cmdDeep(argv.slice(1), asJson);
    return;
  }

  // Shorthand mode: any unrecognized command becomes search text.
  await cmdSearch(argv, asJson, asProfile);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
