import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { countWords, truncateText } from "./helpers.js";
import { normalizeUrl } from "./url-utils.js";

const execFileAsync = promisify(execFile);
let ghCliAvailablePromise: Promise<boolean> | null = null;

interface GitHubRepoReference {
  owner: string;
  repo: string;
  repoUrl: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseGitHubRepoReference(input: string): GitHubRepoReference | null {
  let normalizedInput: string;
  try {
    normalizedInput = normalizeUrl(input);
  } catch {
    return null;
  }

  try {
    const url = new URL(normalizedInput);
    const host = String(url.hostname || "")
      .trim()
      .toLowerCase();

    if (host !== "github.com" && host !== "www.github.com") {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) {
      return null;
    }

    const owner = String(parts[0] || "").trim();
    const repo = String(parts[1] || "")
      .replace(/\.git$/i, "")
      .trim();

    if (!owner || !repo) return null;

    return {
      owner,
      repo,
      repoUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

function decodeBase64ToUtf8(rawValue: unknown): string {
  const encoded = String(rawValue ?? "")
    .replace(/\s+/g, "")
    .trim();

  if (!encoded) return "";

  try {
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

async function hasGhCli(): Promise<boolean> {
  if (!ghCliAvailablePromise) {
    ghCliAvailablePromise = execFileAsync("gh", ["--version"], {
      timeout: 2000,
      windowsHide: true,
    })
      .then(() => true)
      .catch(() => false);
  }

  return await ghCliAvailablePromise;
}

async function runGhApi(endpoint: string, timeoutMs = 12000): Promise<unknown> {
  const { stdout } = await execFileAsync("gh", ["api", endpoint], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  const raw = String(stdout || "").trim();
  if (!raw) return null;

  return JSON.parse(raw) as unknown;
}

export async function tryFetchGitHubRepoContent(
  requestedUrl: string,
  maxCharacters: number,
  options: { log?: (message: string) => void } = {},
): Promise<Record<string, unknown> | null> {
  const repoRef = parseGitHubRepoReference(requestedUrl);
  if (!repoRef) return null;

  if (!(await hasGhCli())) {
    return null;
  }

  const startedAt = Date.now();
  const baseEndpoint = `repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}`;

  try {
    const repoPayload = asObject(await runGhApi(baseEndpoint));
    if (!repoPayload) {
      return null;
    }

    const repoUrl = String(repoPayload.html_url || repoRef.repoUrl).trim() || repoRef.repoUrl;
    const repoName = String(repoPayload.full_name || `${repoRef.owner}/${repoRef.repo}`).trim();
    const description = String(repoPayload.description || "").trim();
    const defaultBranch = String(repoPayload.default_branch || "").trim();
    const language = String(repoPayload.language || "").trim();
    const homepage = String(repoPayload.homepage || "").trim();
    const pushedAt = String(repoPayload.pushed_at || "").trim();
    const updatedAt = String(repoPayload.updated_at || "").trim();
    const starsRaw = Number(repoPayload.stargazers_count || 0);
    const forksRaw = Number(repoPayload.forks_count || 0);
    const openIssuesRaw = Number(repoPayload.open_issues_count || 0);
    const stars = Number.isFinite(starsRaw) ? Math.max(0, Math.trunc(starsRaw)) : 0;
    const forks = Number.isFinite(forksRaw) ? Math.max(0, Math.trunc(forksRaw)) : 0;
    const openIssues = Number.isFinite(openIssuesRaw) ? Math.max(0, Math.trunc(openIssuesRaw)) : 0;

    const licensePayload = asObject(repoPayload.license);
    const license = String(licensePayload?.spdx_id || licensePayload?.name || "").trim();

    const topics = Array.isArray(repoPayload.topics)
      ? repoPayload.topics
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];

    let readmeName = "";
    let readmeContent = "";
    try {
      const readmePayload = asObject(await runGhApi(`${baseEndpoint}/readme`));
      if (readmePayload) {
        readmeName = String(readmePayload.name || "README").trim() || "README";
        readmeContent = decodeBase64ToUtf8(readmePayload.content).trim();
      }
    } catch {
      // README can be missing; continue with metadata-only output.
    }

    let topLevelEntries: string[] = [];
    try {
      const contentsPayload = await runGhApi(`${baseEndpoint}/contents`);
      if (Array.isArray(contentsPayload)) {
        topLevelEntries = contentsPayload
          .map((entry) => {
            const parsed = asObject(entry);
            if (!parsed) return "";

            const name = String(parsed.name || "").trim();
            if (!name) return "";

            const type = String(parsed.type || "").trim();
            if (type === "dir") return `${name}/`;
            if (type === "symlink") return `${name}@`;
            if (type === "submodule") return `${name} (submodule)`;
            return name;
          })
          .filter(Boolean)
          .slice(0, 30);
      }
    } catch {
      // Top-level listing is optional.
    }

    const lines: string[] = [`# ${repoName}`];
    if (description) {
      lines.push("", description);
    }

    lines.push("", `Repository: ${repoUrl}`);
    if (requestedUrl !== repoUrl) {
      lines.push(`Requested URL: ${requestedUrl}`);
    }

    if (defaultBranch) {
      lines.push(`Default branch: ${defaultBranch}`);
    }

    lines.push(`Stars: ${stars}`);
    lines.push(`Forks: ${forks}`);
    lines.push(`Open issues: ${openIssues}`);

    if (language) {
      lines.push(`Primary language: ${language}`);
    }
    if (license) {
      lines.push(`License: ${license}`);
    }
    if (homepage) {
      lines.push(`Homepage: ${homepage}`);
    }
    if (updatedAt) {
      lines.push(`Updated at: ${updatedAt}`);
    }
    if (pushedAt) {
      lines.push(`Pushed at: ${pushedAt}`);
    }
    if (topics.length > 0) {
      lines.push(`Topics: ${topics.join(", ")}`);
    }

    if (topLevelEntries.length > 0) {
      lines.push("", "Top-level files:");
      lines.push(...topLevelEntries.map((entry) => `- ${entry}`));
    }

    if (readmeContent) {
      lines.push("", `## ${readmeName || "README"}`, "", readmeContent);
    }

    const rawContent = lines.join("\n").trim();
    const content = truncateText(rawContent, maxCharacters, "YAGAMI_MAX_MARKDOWN_CHARS");
    const truncated = content.length < rawContent.length;
    const durationMs = Date.now() - startedAt;

    return {
      url: repoUrl,
      requestedUrl,
      title: repoName,
      author: repoRef.owner,
      published: pushedAt || updatedAt || "Unknown",
      wordCount: countWords(content),
      content,
      truncated,
      documentId: `gh-${randomUUID()}`,
      status: 200,
      cache: {
        browse: "gh",
        present: "gh",
      },
      timing: {
        totalMs: durationMs,
        browseMs: null,
        presentMs: null,
        ghMs: durationMs,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log?.(
      `gh fetch failed for ${repoRef.owner}/${repoRef.repo}; falling back to browser fetch (${message.slice(0, 220)})`,
    );
    return null;
  }
}
