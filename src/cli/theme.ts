import type { RuntimeConfig } from "../types/config.js";

const THEMES = {
  ansi: {
    domain: "3;94",
    title: "97",
    duration: "3;93",
    error: "91",
    dim: "2",
    cyan: "96",
    bold: "1",
  },
  none: {
    domain: "",
    title: "",
    duration: "",
    error: "",
    dim: "",
    cyan: "",
    bold: "",
  },
} as const;

const THEME_TOKENS = ["domain", "title", "duration", "error", "dim", "cyan", "bold"] as const;

const FIXED_ICONS = {
  success: "ok",
  error: "x",
  cache: "[cache]",
  pass: "ok",
  fail: "x",
  bullet: "•",
  web: "•",
  webError: "•",
  connector: "│",
} as const;

type ThemeTokenName = (typeof THEME_TOKENS)[number];
type ThemeCodeMap = Record<ThemeTokenName, string>;

function normalizeThemeCode(rawValue: unknown, token: ThemeTokenName, baseTheme: ThemeCodeMap): string | null {
  if (rawValue === undefined || rawValue === null) return null;

  const raw = String(rawValue).trim();
  if (!raw) return null;

  const hexMatch = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (!hex) return null;

    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);

    if (![r, g, b].every((value) => Number.isFinite(value))) return null;

    const stylePrefix = String(baseTheme[token] || "")
      .split(";")
      .filter((part) => part === "1" || part === "2" || part === "3")
      .join(";");

    const colorPart = `38;2;${r};${g};${b}`;
    return stylePrefix ? `${stylePrefix};${colorPart}` : colorPart;
  }

  if (/^[0-9;]+$/.test(raw)) {
    return raw;
  }

  return null;
}

function applyThemeOverrides(themeName: RuntimeConfig["theme"], overridesRaw: Record<string, string>): ThemeCodeMap {
  const baseTheme = (THEMES[themeName] || THEMES.ansi) as ThemeCodeMap;
  const overrides: Partial<ThemeCodeMap> = {};

  for (const token of THEME_TOKENS) {
    const code = normalizeThemeCode(overridesRaw[token], token, baseTheme);
    if (code !== null) overrides[token] = code;
  }

  return {
    ...baseTheme,
    ...overrides,
  };
}

function supportsColor(theme: RuntimeConfig["theme"]): boolean {
  if (theme === "none") return false;
  if (process.env.NO_COLOR !== undefined) return false;

  const noColor = String(process.env.YAGAMI_NO_COLOR || "")
    .trim()
    .toLowerCase();

  if (noColor === "1" || noColor === "true" || noColor === "yes") return false;

  const forceColor = String(process.env.FORCE_COLOR || "").trim();
  if (forceColor && forceColor !== "0") return true;

  return Boolean(process.stdout.isTTY);
}

function colorize(text: string, code: string, enabled: boolean): string {
  if (!enabled || !code) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function styleToken(text: string, token: ThemeTokenName, theme: ThemeCodeMap, colorEnabled: boolean): string {
  return colorize(text, theme[token], colorEnabled);
}

function icon(name: keyof typeof FIXED_ICONS): string {
  return FIXED_ICONS[name] || "";
}

export type ThemeIconName = keyof typeof FIXED_ICONS;

export interface CliThemeRuntime {
  colorEnabled: boolean;
  icon: (name: ThemeIconName) => string;
  styleDomain: (text: string) => string;
  styleTitle: (text: string) => string;
  styleDuration: (text: string) => string;
  styleError: (text: string) => string;
  styleDim: (text: string) => string;
  styleDimItalic: (text: string) => string;
  styleCyan: (text: string) => string;
  styleBold: (text: string) => string;
}

export function createCliThemeRuntime(config: RuntimeConfig): CliThemeRuntime {
  const activeThemeName = THEMES[config.theme] ? config.theme : "ansi";
  const activeTheme = applyThemeOverrides(activeThemeName, config.themeTokens || {});
  const colorEnabled = supportsColor(config.theme);

  const style = (token: ThemeTokenName, text: string): string => styleToken(text, token, activeTheme, colorEnabled);

  const styleDimItalic = (text: string): string => {
    if (!colorEnabled) return text;

    const dimCode = String(activeTheme.dim || "2");
    const parts = dimCode.split(";").filter(Boolean);
    if (!parts.includes("3")) parts.push("3");
    return colorize(text, parts.join(";"), true);
  };

  return {
    colorEnabled,
    icon: (name: ThemeIconName) => icon(name),
    styleDomain: (text: string) => style("domain", text),
    styleTitle: (text: string) => style("title", text),
    styleDuration: (text: string) => style("duration", text),
    styleError: (text: string) => style("error", text),
    styleDim: (text: string) => style("dim", text),
    styleDimItalic,
    styleCyan: (text: string) => style("cyan", text),
    styleBold: (text: string) => style("bold", text),
  };
}

function parseCliArgs(args: string[]): { positional: string[] } {
  const positional: string[] = [];
  for (const token of args) {
    if (!token.startsWith("--")) positional.push(token);
  }
  return { positional };
}

export async function cmdTheme(
  config: RuntimeConfig,
  args: string[],
  options: { asJson?: boolean; printUsage: () => void } = { printUsage: () => {} },
): Promise<void> {
  const asJson = options.asJson ?? false;
  const { positional } = parseCliArgs(args);
  const action = String(positional[0] || "preview")
    .trim()
    .toLowerCase();

  if (action && action !== "preview") {
    console.error("theme command supports: preview\n");
    options.printUsage();
    process.exitCode = 1;
    return;
  }

  const activeThemeName = THEMES[config.theme] ? config.theme : "ansi";
  const activeTheme = applyThemeOverrides(activeThemeName, config.themeTokens || {});
  const colorEnabled = supportsColor(config.theme);

  const samples: Record<ThemeTokenName, string> = {
    domain: "example.com",
    title: "Example page title",
    duration: "1.4s",
    error: "request failed",
    dim: "secondary text",
    cyan: "https://example.com",
    bold: "strong label",
  };

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          theme: activeThemeName,
          themeName: activeThemeName,
          requestedTheme: config.theme,
          configFile: config.configFile,
          overrides: config.themeTokens || {},
          resolvedTokens: activeTheme,
          samples,
        },
        null,
        2,
      ),
    );
    return;
  }

  const styleBold = (text: string): string => styleToken(text, "bold", activeTheme, colorEnabled);
  const styleDim = (text: string): string => styleToken(text, "dim", activeTheme, colorEnabled);
  const styleDuration = (text: string): string => styleToken(text, "duration", activeTheme, colorEnabled);
  const styleDimItalic = (text: string): string => {
    if (!colorEnabled) return text;

    const dimCode = String(activeTheme.dim || "2");
    const parts = dimCode.split(";").filter(Boolean);
    if (!parts.includes("3")) parts.push("3");
    return colorize(text, parts.join(";"), true);
  };

  console.log(styleBold("Theme preview"));
  console.log(styleDim(`theme=${config.theme} · config=${config.configFile}`));

  for (const token of THEME_TOKENS) {
    const sample = samples[token] || token;
    const code = activeTheme[token] || "-";
    const label = `${token}:`.padEnd(10, " ");
    console.log(
      `  ${styleDim(label)} ${styleToken(sample, token, activeTheme, colorEnabled)} ${styleDim(`(${code})`)}`,
    );
  }

  const sampleSuccessDomain = styleToken("duckduckgo.com", "domain", activeTheme, colorEnabled);
  const sampleSuccessTitle = styleToken("Google AI news March 2026 at DuckDuckGo", "title", activeTheme, colorEnabled);
  const sampleErrorDomain = styleToken("deccanherald.com", "domain", activeTheme, colorEnabled);
  const sampleError = styleToken("— Timeout 7000ms exceeded.", "error", activeTheme, colorEnabled);

  console.log(`\n${styleDim("Stream markers:")}`);
  console.log(`${icon("bullet")} ${sampleSuccessDomain} ${sampleSuccessTitle}`);
  console.log(`${styleDim(icon("connector"))}`);
  console.log(`${icon("bullet")} ${sampleErrorDomain} ${sampleError}`);

  console.log(`\n${styleDim("Spinner line:")}`);
  console.log(
    `${styleDuration("⠋")} ${styleDim("Reading")} ${styleDimItalic("duckduckgo.com")} ${styleDim("·")} ${styleDim("1.2s")}`,
  );
}
