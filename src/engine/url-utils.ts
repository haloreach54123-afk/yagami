const URL_REGEX = /https?:\/\/[^\s)\]>]+/g;

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

export function extractSeedUrls(text: unknown): string[] {
  const matches = String(text ?? "").match(URL_REGEX) ?? [];
  return normalizeUniqueUrls(matches);
}

export function extractCitationUrls(text: unknown): string[] {
  const matches = String(text ?? "").match(URL_REGEX) ?? [];
  return normalizeUniqueUrls(matches);
}
