import { CODE_PREFERRED_DOMAINS, COMPANY_PREFERRED_DOMAINS } from "./constants.js";
import {
  clampInteger,
  extractSeedUrls,
  getCompanyCountryProfile,
  getHostname,
  normalizeCountryCode,
  normalizeDomainFilter,
  normalizeEnum,
  parseIsoDate,
  parseStringList,
  parseUrlList,
} from "./helpers.js";
import type {
  EngineResearchConfig,
  NormalizedResearchPolicy,
  RawResearchPolicy,
  ResearchMode,
  ResearchPlan,
} from "../types/engine.js";

const RESEARCH_MODES: readonly ResearchMode[] = ["general", "code", "company", "similar", "deep"];
const RETRIEVAL_TYPES = ["auto", "fast", "neural"] as const;
const LIVECRAWL_MODES = ["never", "fallback", "always", "preferred"] as const;

export function normalizeResearchPolicy(rawPolicy: RawResearchPolicy = {}): NormalizedResearchPolicy {
  const explicitIncludeDomains = parseStringList(rawPolicy.includeDomains)
    .map((value) => normalizeDomainFilter(value))
    .filter(Boolean);

  const siteDomains = parseStringList(rawPolicy.sites)
    .map((value) => normalizeDomainFilter(value))
    .filter(Boolean);

  const includeDomains = Array.from(new Set([...explicitIncludeDomains, ...siteDomains]));

  const excludeDomains = parseStringList(rawPolicy.excludeDomains)
    .map((value) => normalizeDomainFilter(value))
    .filter(Boolean);

  const includeText = parseStringList(rawPolicy.includeText)
    .map((value) => String(value).toLowerCase().trim())
    .filter(Boolean);

  const excludeText = parseStringList(rawPolicy.excludeText)
    .map((value) => String(value).toLowerCase().trim())
    .filter(Boolean);

  const categoryRaw = String(rawPolicy.category ?? "")
    .trim()
    .toLowerCase();
  const category = categoryRaw || null;

  const mode = normalizeEnum(rawPolicy.mode, RESEARCH_MODES, "general");

  const country = normalizeCountryCode(rawPolicy.country);
  const countryProfile = mode === "company" ? getCompanyCountryProfile(country) : null;

  const preferredDomainsRaw = parseStringList(rawPolicy.preferredDomains)
    .map((value) => normalizeDomainFilter(value))
    .filter(Boolean);

  const preferredDomains =
    mode === "code"
      ? Array.from(new Set([...preferredDomainsRaw, ...CODE_PREFERRED_DOMAINS]))
      : mode === "company"
        ? Array.from(
            new Set([...preferredDomainsRaw, ...COMPANY_PREFERRED_DOMAINS, ...(countryProfile?.domains ?? [])]),
          )
        : preferredDomainsRaw;

  const explicitSeedUrls = parseUrlList(rawPolicy.seedUrls);
  const countrySeedUrls =
    mode === "company" && countryProfile
      ? parseUrlList(countryProfile.seedUrls?.(String(rawPolicy.companyName ?? rawPolicy.query ?? "").trim()) ?? [])
      : [];

  const seedUrls = Array.from(new Set([...explicitSeedUrls, ...countrySeedUrls]));

  const customInstruction =
    String(rawPolicy.customInstruction ?? rawPolicy.instructions ?? rawPolicy.instruction ?? "").trim() || null;

  const type = normalizeEnum(rawPolicy.type, RETRIEVAL_TYPES, "auto");
  const livecrawl = normalizeEnum(rawPolicy.livecrawl, LIVECRAWL_MODES, "fallback");

  const requestedResults = clampInteger(rawPolicy.numResults, 0, { min: 0, max: 40 });
  const requestedMaxPages = requestedResults > 0 ? requestedResults : null;
  const requestedHops = clampInteger(rawPolicy.maxHops, 0, { min: 0, max: 8 });
  const requestedMaxHops = requestedHops > 0 ? requestedHops : null;

  const startPublishedDate = String(rawPolicy.startPublishedDate ?? "").trim() || null;
  const endPublishedDate = String(rawPolicy.endPublishedDate ?? "").trim() || null;

  const startDate = parseIsoDate(startPublishedDate);
  const endDate = parseIsoDate(endPublishedDate);

  const advanced =
    requestedMaxPages !== null ||
    requestedMaxHops !== null ||
    includeDomains.length > 0 ||
    excludeDomains.length > 0 ||
    includeText.length > 0 ||
    excludeText.length > 0 ||
    Boolean(category) ||
    Boolean(country) ||
    Boolean(startPublishedDate) ||
    Boolean(endPublishedDate) ||
    Boolean(customInstruction) ||
    preferredDomains.length > 0 ||
    seedUrls.length > 0 ||
    mode !== "general" ||
    type !== "auto" ||
    livecrawl !== "fallback";

  return {
    advanced,
    mode,
    type,
    livecrawl,
    category,
    country,
    countryLabel: countryProfile?.label ?? null,
    includeDomains,
    excludeDomains,
    includeText,
    excludeText,
    preferredDomains,
    seedUrls,
    customInstruction,
    requestedResults,
    requestedMaxPages,
    requestedMaxHops,
    startPublishedDate,
    endPublishedDate,
    startDate,
    endDate,
  };
}

export function deriveResearchPlan(
  query: string,
  config: EngineResearchConfig,
  options: { researchPolicy?: RawResearchPolicy } = {},
): ResearchPlan {
  const policy = normalizeResearchPolicy(options.researchPolicy ?? {});

  const extractedSeedUrls = extractSeedUrls(query);
  const seedUrls = Array.from(new Set([...extractedSeedUrls, ...(policy.seedUrls ?? [])]));
  const seedHosts = new Set(seedUrls.map((url) => getHostname(url)).filter(Boolean));

  let defaultMaxPages = config.researchMaxPages;
  if (policy.mode === "code") defaultMaxPages = Math.min(defaultMaxPages, 8);
  if (policy.mode === "company") defaultMaxPages = Math.min(defaultMaxPages, 8);
  if (policy.mode === "similar") defaultMaxPages = Math.min(defaultMaxPages, 6);

  const maxPages = Math.max(1, policy.requestedMaxPages || defaultMaxPages);

  const maxHops = Math.max(0, policy.requestedMaxHops ?? config.researchMaxHops);

  return {
    maxPages,
    maxHops,
    sameDomainOnly: config.researchSameDomainOnly && seedHosts.size > 0,
    seedUrls,
    seedHosts,
    policy,
  };
}

// ---- Prompt building blocks (internal) ----

function currentDateIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function toolsBlock(): string {
  return [
    "Tools:",
    "- browse(url) → documentId. Fetches a web page and stores it.",
    "- present(documentId) → title, author, date, text. Extracts readable content. Always call before citing a page.",
  ].join("\n");
}

function groundingBlock(): string {
  return [
    "Grounding:",
    "- Cite only URLs you browsed and presented. Never fabricate URLs or quotes.",
    "- If evidence is missing or conflicting, say so.",
  ].join("\n");
}

function collateOutputBlock(): string {
  return `Browse pages relevant to the query. Call present(documentId) on each page to read it.
Then list the URLs of the pages that best answer the query.

Output format:
SOURCES
<url>
<url>
SOURCES

At most 6 URLs. Only include pages you browsed and presented.
Drop junk pages (challenge walls, login screens, empty pages).
If no pages are relevant, output: NONE`;
}

function deepReportOutputBlock(): string {
  return `Browse extensively, then write a structured report from what you find.

Structure:
## Executive Summary
Brief overview and overall confidence.

## Key Findings
Detailed findings with confidence (high/medium/low). Cite source URLs.

## Disagreements & Unknowns
Conflicting evidence, unresolved questions, gaps.

## Sources
- Title — URL (one line per source)`;
}

function workflowBlock(mode: ResearchMode, seedUrls: string[]): string {
  const hasSeeds = seedUrls.length > 0;
  const startStep = hasSeeds
    ? "Start from seed URLs, then use search discovery for additional links."
    : "Browse the search discovery URL to find relevant links.";

  switch (mode) {
    case "code":
      return [
        "Workflow:",
        `1. ${startStep}`,
        "2. Prioritize official documentation, GitHub repos, and Stack Overflow.",
        "3. Call present(documentId) on each page before citing.",
        "4. Provide source-linked examples. State uncertainty about APIs explicitly.",
      ].join("\n");

    case "company":
      return [
        "Workflow:",
        `1. ${hasSeeds ? "Start from seed/registry URLs before general search." : startStep}`,
        "2. Check company registries and directories before secondary blogs.",
        "3. Call present(documentId) on each page before citing.",
        "4. Include legal entity basics when available: name, jurisdiction, status.",
        "5. Mark missing data explicitly.",
      ].join("\n");

    case "similar":
      return [
        "Workflow:",
        "1. Browse the seed URL to understand the target site's category and purpose.",
        "2. Search for alternatives and competitors via discovery.",
        "3. Call present(documentId) on each candidate page.",
        "4. Return direct alternatives over generic articles or dictionary pages.",
        "5. Skip bot-wall/challenge pages (Cloudflare, access-denied) as evidence.",
      ].join("\n");

    case "deep":
      return [
        "Workflow:",
        `1. ${startStep}`,
        "2. Iterate: discover → browse → present → synthesize → gap-check → follow-up browse → final report.",
        "3. Cross-check major claims against independent sources when available.",
        "4. Surface disagreements between sources and note confidence impact.",
        "5. Mark uncertainty explicitly instead of filling gaps with assumptions.",
      ].join("\n");

    default:
      return [
        "Workflow:",
        `1. ${startStep}`,
        "2. Browse 3+ relevant sources when possible.",
        "3. Call present(documentId) on each page before citing.",
        "4. Prefer primary sources: official docs, repos, papers, first-party pages.",
      ].join("\n");
  }
}

function constraintsBlock(plan: ResearchPlan, searchDiscovery?: { engine: string; template: string }): string {
  const lines: string[] = [];

  lines.push(`Today: ${currentDateIso()}`);
  lines.push(`Page budget: ${plan.maxPages} unique pages max.`);
  lines.push(`Hop limit: ${plan.maxHops} hops from seed pages.`);

  if (searchDiscovery?.template) {
    lines.push(`Search discovery: browse ${searchDiscovery.template} to find links.`);
  }

  if (plan.sameDomainOnly && plan.seedHosts.size > 0) {
    lines.push(`Domain lock: only browse ${Array.from(plan.seedHosts).join(", ")}.`);
  }

  const policy = plan.policy;

  if (policy.includeDomains.length > 0) {
    lines.push(`Allowed domains: ${policy.includeDomains.join(", ")}. Search engine domains OK for discovery only.`);
  }
  if (policy.excludeDomains.length > 0) {
    lines.push(`Blocked domains: ${policy.excludeDomains.join(", ")}.`);
  }
  if (policy.preferredDomains.length > 0) {
    lines.push(`Preferred sources: ${policy.preferredDomains.join(", ")}.`);
  }
  if (policy.includeText.length > 0) {
    lines.push(`Required terms: evidence must mention ${policy.includeText.join(", ")}.`);
  }
  if (policy.excludeText.length > 0) {
    lines.push(`Excluded terms: skip evidence mentioning ${policy.excludeText.join(", ")}.`);
  }
  if (policy.startPublishedDate) {
    lines.push(`After: ${policy.startPublishedDate}.`);
  }
  if (policy.endPublishedDate) {
    lines.push(`Before: ${policy.endPublishedDate}.`);
  }
  if (policy.category) {
    lines.push(`Category: ${policy.category}.`);
  }
  if (policy.countryLabel) {
    lines.push(`Country: ${policy.countryLabel}. Prioritize country-specific registries.`);
  }
  if (policy.requestedResults > 0) {
    lines.push(`Target: ~${policy.requestedResults} sources.`);
  }
  if (policy.requestedMaxHops !== null) {
    lines.push(`Depth target: ~${policy.requestedMaxHops} hops.`);
  }
  if (policy.customInstruction) {
    lines.push(policy.customInstruction);
  }

  return lines.join("\n");
}

function seedsBlock(plan: ResearchPlan): string {
  if (plan.seedUrls.length === 0) return "";
  return `Seeds:\n${plan.seedUrls.map((url) => `- ${url}`).join("\n")}`;
}

function reinforcementLine(mode: ResearchMode): string {
  if (mode === "deep") {
    return "Follow the iterative workflow. Cite only what you browsed.";
  }
  return "Respond with SOURCES list only.";
}

// ---- Public prompt builder ----

export function buildSystemPrompt(plan: ResearchPlan, searchDiscovery?: { engine: string; template: string }): string {
  const mode = plan.policy.mode;

  const outputBlock = mode === "deep" ? deepReportOutputBlock() : collateOutputBlock();

  const isDeep = mode === "deep";

  const sections = isDeep
    ? [
        "You are YAGAMI, a web search agent.",
        "",
        outputBlock,
        "",
        toolsBlock(),
        "",
        workflowBlock(mode, plan.seedUrls),
        "",
        groundingBlock(),
        "",
        constraintsBlock(plan, searchDiscovery),
      ]
    : [
        "You are YAGAMI, a web search agent.",
        "",
        outputBlock,
        "",
        toolsBlock(),
        "",
        constraintsBlock(plan, searchDiscovery),
      ];

  const seeds = seedsBlock(plan);
  if (seeds) {
    sections.push("", seeds);
  }

  sections.push("", reinforcementLine(mode));

  return sections.join("\n");
}
