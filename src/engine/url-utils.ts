const URL_REGEX = /https?:\/\/[^\s)\]>]+/g;

type UrlRewriteRule = {
  id: string;
  fromHost: string;
  toHost: string;
  pathPrefixes?: readonly string[];
  preserveCanonicalUrl?: boolean;
  expectedContentType?: string;
};

const URL_REWRITE_RULES: readonly UrlRewriteRule[] = [
  {
    id: "apple-docs-sosumi",
    fromHost: "developer.apple.com",
    toHost: "sosumi.ai",
    pathPrefixes: ["/documentation", "/design/human-interface-guidelines", "/videos/play"],
    preserveCanonicalUrl: true,
    expectedContentType: "text/markdown",
  },
];

function pathHasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function hostnameEquals(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function findMatchingUrlRewriteRule(url: URL): UrlRewriteRule | null {
  for (const rule of URL_REWRITE_RULES) {
    if (!hostnameEquals(url.hostname, rule.fromHost)) continue;

    const prefixes = rule.pathPrefixes || [];
    if (prefixes.length > 0 && !prefixes.some((prefix) => pathHasPrefix(url.pathname, prefix))) {
      continue;
    }

    return rule;
  }

  return null;
}

export function sanitizeUrlCandidate(input: unknown): string {
  let value = String(input ?? "").trim();
  if (!value) return "";

  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1).trim();
  }

  value = value.replace(/^[\s("'`[]+/, "");

  for (let i = 0; i < 3; i += 1) {
    const next = value
      .replace(/(?:\*{1,3}|_{1,3}|`{1,3})+$/g, "")
      .replace(/[>\]"'`]+$/g, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();

    if (next === value) break;
    value = next;
  }

  return value;
}

export function normalizeUrl(input: unknown): string {
  const raw = sanitizeUrlCandidate(input);
  if (!raw) throw new Error("URL is required");

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  return url.toString();
}

export function normalizeUrlForDedupe(input: unknown): string {
  const normalized = normalizeUrl(input);
  const url = new URL(normalized);

  url.hash = "";

  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  if (url.pathname !== "/") {
    const trimmedPath = url.pathname.replace(/\/+$/g, "");
    url.pathname = trimmedPath || "/";
  }

  return url.toString();
}

export function normalizeUniqueUrls(values: Iterable<unknown>): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    try {
      const normalized = normalizeUrl(value);
      const dedupeKey = normalizeUrlForDedupe(normalized);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      urls.push(normalized);
    } catch {
      // ignore malformed URL-like fragments
    }
  }

  return urls;
}

export type BrowseUrlRewrite = {
  url: string;
  rewritten: boolean;
  ruleId?: string;
  preserveCanonicalUrl: boolean;
  expectedContentType: string;
};

export function rewriteBrowseUrl(input: unknown): BrowseUrlRewrite {
  const normalized = normalizeUrl(input);
  const parsed = new URL(normalized);
  const rule = findMatchingUrlRewriteRule(parsed);

  if (!rule) {
    return {
      url: normalized,
      rewritten: false,
      preserveCanonicalUrl: false,
      expectedContentType: "text/html",
    };
  }

  const rewritten = new URL(parsed.toString());
  rewritten.hostname = rule.toHost;

  return {
    url: rewritten.toString(),
    rewritten: true,
    ruleId: rule.id,
    preserveCanonicalUrl: Boolean(rule.preserveCanonicalUrl),
    expectedContentType: String(rule.expectedContentType || "text/html"),
  };
}

export function extractSeedUrls(text: unknown): string[] {
  const matches = String(text ?? "").match(URL_REGEX) ?? [];
  return normalizeUniqueUrls(matches);
}

export function extractCitationUrls(text: unknown): string[] {
  const matches = String(text ?? "").match(URL_REGEX) ?? [];
  return normalizeUniqueUrls(matches);
}
