import { randomUUID } from "node:crypto";

import { DEEP_EFFORT_LEVELS } from "./constants.js";
import { clampInteger, normalizeWhitespace } from "./helpers.js";
import { normalizeUniqueUrls } from "./url-utils.js";
import type {
  DeepEffort,
  DeepEffortProfile,
  DeepResearchTaskRecord,
  SearchResultEntry,
  WebSearchLikeResult,
} from "../types/engine.js";

export function resolveDeepEffort(value: unknown): DeepEffort {
  const requested = String(value ?? "balanced")
    .trim()
    .toLowerCase() as DeepEffort;
  return DEEP_EFFORT_LEVELS.has(requested) ? requested : "balanced";
}

export function getDeepEffortProfile(effort: DeepEffort): DeepEffortProfile {
  if (effort === "thorough") {
    return {
      numResults: 24,
      maxHops: 5,
      refinementPasses: 3,
      minPrimarySources: 8,
      thinkingLevel: "high",
      queryTimeoutMs: 8 * 60 * 1000,
      textMaxCharacters: 5600,
      contextMaxCharacters: 42000,
    };
  }

  if (effort === "balanced") {
    return {
      numResults: 14,
      maxHops: 3,
      refinementPasses: 1,
      minPrimarySources: 4,
      thinkingLevel: "medium",
      queryTimeoutMs: 5 * 60 * 1000,
      textMaxCharacters: 4400,
      contextMaxCharacters: 28000,
    };
  }

  return {
    numResults: 8,
    maxHops: 2,
    refinementPasses: 1,
    minPrimarySources: 3,
    thinkingLevel: "low",
    queryTimeoutMs: 3 * 60 * 1000,
    textMaxCharacters: 3400,
    contextMaxCharacters: 18000,
  };
}

export function buildDeepCustomInstruction(effort: DeepEffort, profile: DeepEffortProfile): string {
  const hint =
    effort === "thorough"
      ? "Prioritize completeness and source triangulation over speed."
      : effort === "balanced"
        ? "Balance thoroughness with speed."
        : "Prioritize speed. Focus on the strongest sources.";

  return `${hint} Target at least ${profile.minPrimarySources} primary sources (official docs, papers, first-party).`;
}

export function buildDeepFollowUpPrompts(effort: DeepEffort, profile: DeepEffortProfile): string[] {
  const prompts: string[] = [];

  if (profile.refinementPasses >= 1) {
    prompts.push(
      [
        "Run a gap-check pass now.",
        "Identify the weakest-supported claims in your current draft and browse additional sources to strengthen or revise them.",
        "Prioritize primary sources and contradiction checks.",
        "Then provide a revised report with confidence notes and updated sources.",
      ].join(" "),
    );
  }

  if (profile.refinementPasses >= 2 || effort === "thorough") {
    prompts.push(
      [
        "Run an adversarial verification pass.",
        "Challenge your top conclusions, verify key dates/numbers against independent sources, and resolve remaining ambiguities where possible.",
        "Revise any weakly supported claims and keep disagreements explicit.",
      ].join(" "),
    );
  }

  if (profile.refinementPasses >= 3) {
    prompts.push(
      [
        "Run a final quality polish pass.",
        "Re-read the full report for clarity and evidence traceability.",
        "Ensure every major claim has supporting sources, confidence notes are explicit, and unresolved unknowns remain clearly marked.",
        "Then produce the final report in the required deep structure.",
      ].join(" "),
    );
  }

  return prompts;
}

export function createDeepResearchTask(instructions: string, effort: DeepEffort): DeepResearchTaskRecord {
  return {
    researchId: randomUUID(),
    status: "pending",
    instructions,
    effort,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    durationMs: null,
    report: null,
    citations: [],
    error: null,
    costDollars: 0,
  };
}

export function evictOldDeepResearchTasks(tasks: Map<string, DeepResearchTaskRecord>, maxTasks = 100): void {
  const cap = Math.max(1, clampInteger(maxTasks, 100, { min: 1, max: 1000 }));
  while (tasks.size > cap) {
    const oldest = tasks.keys().next().value;
    if (!oldest) break;
    tasks.delete(oldest);
  }
}

export function composeDeepResearchReport(
  instructions: string,
  effort: DeepEffort,
  searchResult: WebSearchLikeResult,
): string {
  const successful = (searchResult.results ?? []).filter((entry) => !entry.error);
  const failed = (searchResult.results ?? []).filter((entry) => entry.error);

  const lines: string[] = [];
  lines.push("# Deep Research Report");
  lines.push("");
  lines.push("## Prompt");
  lines.push(instructions);
  lines.push("");
  lines.push("## Summary");

  if (successful.length === 0) {
    lines.push("No successful pages were extracted for this run.");
  } else {
    lines.push(
      `Collected ${successful.length} source(s)${failed.length ? `, with ${failed.length} failed crawl(s)` : ""}.`,
    );
    const depthLabel = effort === "thorough" ? "high depth" : effort === "balanced" ? "standard depth" : "fast depth";
    lines.push(`Depth profile: ${effort} (${depthLabel}).`);
  }

  lines.push("");
  lines.push("## Findings");

  if (successful.length === 0) {
    lines.push("- Unable to extract reliable findings from available pages.");
  } else {
    for (const entry of successful) {
      const title = entry.title || entry.url;
      const snippet = entry.snippet || "No snippet available.";
      const contentPreview = normalizeWhitespace(entry.content || "").slice(0, 260);

      lines.push(`- **${title}** (${entry.url})`);
      lines.push(`  - Snippet: ${snippet}`);
      if (contentPreview) {
        lines.push(`  - Extracted: ${contentPreview}${contentPreview.length >= 260 ? "…" : ""}`);
      }
    }
  }

  if (failed.length > 0) {
    lines.push("");
    lines.push("## Failed Crawls");
    for (const entry of failed) {
      lines.push(`- ${entry.url}: ${entry.error}`);
    }
  }

  lines.push("");
  lines.push("## Sources");
  if (successful.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of successful) {
      lines.push(`- ${entry.title || entry.url}: ${entry.url}`);
    }
  }

  return lines.join("\n");
}

export function extractDeepResearchCitations(searchResult: WebSearchLikeResult): string[] {
  const urls = (searchResult.results ?? [])
    .filter((entry: SearchResultEntry) => !entry.error)
    .map((entry: SearchResultEntry) => entry.url);

  return normalizeUniqueUrls(urls);
}
