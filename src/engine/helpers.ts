import type { CategoryProfile, CountryProfile, SearchCategory } from "../types/engine.js";
import { COMPANY_COUNTRY_ALIASES, COMPANY_COUNTRY_PROFILES, URL_REGEX } from "./constants.js";
import { normalizeUniqueUrls, normalizeUrl } from "./url-utils.js";

export function clampInteger(value: unknown, fallback: number, options: { min?: number; max?: number } = {}): number {
  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase() as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

export function normalizeCountryCode(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return COMPANY_COUNTRY_ALIASES[normalized] ?? null;
}

export function getCompanyCountryProfile(countryCode: string | null): CountryProfile | null {
  if (!countryCode) return null;
  return COMPANY_COUNTRY_PROFILES[countryCode] ?? null;
}

export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseStringList(value: unknown): string[] {
  const output: string[] = [];
  for (const entry of toArray(value as string | string[] | null | undefined)) {
    if (typeof entry !== "string") continue;
    for (const part of entry.split(",")) {
      const item = part.trim();
      if (item) output.push(item);
    }
  }
  return Array.from(new Set(output));
}

export function parseUrlList(value: unknown): string[] {
  return parseStringList(value)
    .map((entry) => {
      try {
        return normalizeUrl(entry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is string => Boolean(entry));
}

export function toBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

export function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: unknown): string {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripHtml(value: unknown): string {
  return normalizeWhitespace(decodeHtmlEntities(String(value ?? "").replace(/<[^>]*>/g, " ")));
}

export function normalizeDomainFilter(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "";

  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return (
      raw
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        ?.trim() ?? ""
    );
  }
}

export function domainMatches(hostname: string, domains: Iterable<string>): boolean {
  if (!hostname) return false;
  for (const domain of domains) {
    if (!domain) continue;
    if (hostname === domain) return true;
    if (hostname.endsWith(`.${domain}`)) return true;
  }
  return false;
}

export function isDiscoveryDomain(hostname: string): boolean {
  return domainMatches(hostname, ["duckduckgo.com", "bing.com", "google.com", "search.brave.com"]);
}

export function isValidPublicHostname(hostname: string): boolean {
  if (!hostname) return false;
  return hostname === "localhost" || hostname.includes(".");
}

export function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

export function isChallengeLikeContent(title: unknown, content: unknown): boolean {
  const haystack = `${String(title ?? "")}\n${String(content ?? "")}`.toLowerCase();
  const tokens = [
    "just a moment",
    "attention required",
    "verify you are human",
    "checking your browser",
    "access denied",
    "cloudflare",
    "cf-ray",
    "captcha",
  ];

  return tokens.some((token) => haystack.includes(token));
}

export function extractTopTerms(value: unknown, maxTerms = 6): string[] {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "your",
    "about",
    "into",
    "their",
    "have",
    "will",
    "not",
    "are",
    "you",
    "how",
    "what",
    "when",
    "where",
    "why",
    "who",
    "www",
    "http",
    "https",
  ]);

  const words = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stopwords.has(word));

  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([word]) => word);
}

export function unwrapDuckDuckGoHref(rawHref: unknown): string {
  if (!rawHref) return "";

  const trimmed = String(rawHref).trim();
  const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  try {
    const url = new URL(absolute);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname || "";

    if (hostname.endsWith("duckduckgo.com") && pathname.startsWith("/l/")) {
      const target = url.searchParams.get("uddg") || url.searchParams.get("rut");
      if (target) return decodeURIComponent(target);
    }

    if (hostname.endsWith("google.com") && pathname === "/url") {
      const target = url.searchParams.get("q") || url.searchParams.get("url");
      if (target) return decodeURIComponent(target);
    }

    return url.toString();
  } catch {
    return trimmed;
  }
}

export function isTrackingOrAdUrl(rawUrl: unknown): boolean {
  try {
    const url = new URL(String(rawUrl));
    const hostname = url.hostname.toLowerCase();

    if (hostname.endsWith("duckduckgo.com")) return true;
    if ((hostname === "google.com" || hostname === "www.google.com") && url.pathname === "/url") return true;
    if (hostname === "search.brave.com") return true;
    if (hostname.endsWith("bing.com") && (url.pathname === "/aclick" || url.pathname.startsWith("/ck/"))) return true;

    const adParams = ["ad_domain", "ad_provider", "ad_type", "click_metadata", "u3", "rut"];
    if (adParams.some((param) => url.searchParams.has(param))) return true;

    return false;
  } catch {
    return false;
  }
}

const CATEGORY_PROFILES: Record<SearchCategory, CategoryProfile> = {
  company: {
    queryHint: "official site products services company overview funding news",
    includeDomains: [],
    includeText: ["company"],
  },
  "research paper": {
    queryHint: "research paper arxiv preprint",
    includeDomains: ["arxiv.org", "openreview.net", "acm.org", "ieee.org"],
    includeText: ["abstract"],
  },
  news: {
    queryHint: "latest news",
    includeDomains: [],
    includeText: ["news"],
  },
  pdf: {
    queryHint: "filetype:pdf pdf",
    includeDomains: [],
    includeText: [],
  },
  github: {
    queryHint: "github repository",
    includeDomains: ["github.com"],
    includeText: [],
  },
  tweet: {
    queryHint: "x twitter thread",
    includeDomains: ["x.com", "twitter.com"],
    includeText: [],
  },
  "personal site": {
    queryHint: "personal blog portfolio",
    includeDomains: [],
    includeText: ["about"],
  },
  people: {
    queryHint: "biography profile",
    includeDomains: [],
    includeText: [],
  },
  "financial report": {
    queryHint: "annual report 10-k earnings",
    includeDomains: ["sec.gov"],
    includeText: ["annual report", "10-k", "earnings"],
  },
};

export function categoryProfile(category: unknown): CategoryProfile {
  const value = String(category ?? "")
    .trim()
    .toLowerCase() as SearchCategory;
  return CATEGORY_PROFILES[value] ?? { queryHint: "", includeDomains: [], includeText: [] };
}

export function truncateText(text: unknown, maxChars: number): string {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Truncated to ${maxChars} characters]`;
}

export function countWords(text: unknown): number {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
}

interface MessageLike {
  content?: unknown;
}

export function extractAssistantText(message: MessageLike | null | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";

  return message.content
    .filter((block: ContentBlock) => block?.type === "text")
    .map((block: ContentBlock) => String(block.text ?? ""))
    .join("\n")
    .trim();
}

export function extractTextContent(contentBlocks: unknown): string {
  if (!Array.isArray(contentBlocks)) return "";

  return contentBlocks
    .filter((block: ContentBlock) => block?.type === "text")
    .map((block: ContentBlock) => String(block.text ?? ""))
    .join("\n")
    .trim();
}

export function buildContext(
  entries: Array<{ error?: unknown; title?: unknown; url?: unknown; snippet?: unknown; content?: unknown }>,
  maxChars: number,
): string {
  const chunks: string[] = [];

  for (const entry of entries) {
    if (entry.error) continue;

    chunks.push(
      [
        `TITLE: ${String(entry.title ?? "Untitled")}`,
        `URL: ${String(entry.url ?? "")}`,
        entry.snippet ? `SNIPPET: ${String(entry.snippet)}` : "",
        entry.content ? `CONTENT:\n${String(entry.content)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return truncateText(chunks.join("\n\n---\n\n"), maxChars);
}

export function getHostname(url: unknown): string {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isHostAllowed(hostname: string, allowedHosts: Iterable<string>): boolean {
  if (!hostname) return false;
  for (const allowed of allowedHosts) {
    if (hostname === allowed) return true;
    if (hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

export function extractSeedUrls(text: unknown): string[] {
  const matches = String(text ?? "").match(URL_REGEX) ?? [];
  return normalizeUniqueUrls(matches);
}

export function extractCitationUrls(text: unknown): string[] {
  const matches = String(text ?? "").match(URL_REGEX) ?? [];
  return normalizeUniqueUrls(matches);
}

export function normalizePotentialUrls(values: Iterable<unknown>): string[] {
  return normalizeUniqueUrls(values);
}
