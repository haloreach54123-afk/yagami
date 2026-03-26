export type ProgressEventType =
  | "query_start"
  | "turn_start"
  | "first_token"
  | "assistant_delta"
  | "tool_start"
  | "tool_end"
  | "turn_end"
  | "query_end";

export interface ProgressEventBase {
  type: ProgressEventType;
  timestamp?: number;
}

export interface AssistantDeltaProgressEvent extends ProgressEventBase {
  type: "assistant_delta";
  turn: number;
  message: number;
  delta: string;
}

export interface QueryResult {
  query: string;
  answer: string;
  findings?: SearchResultEntry[];
  citations: string[];
  durationMs: number;
  model: string;
  createdAt?: string;
}

export interface DeepResearchStartResult {
  success: true;
  researchId: string;
  effort: "fast" | "balanced" | "thorough";
  status: "pending";
  message: string;
}

export interface DeepResearchCheckResult {
  success?: boolean;
  status: "pending" | "running" | "completed" | "failed";
  effort: "fast" | "balanced" | "thorough";
  report?: string;
  citations?: string[];
  costDollars?: number;
  durationMs?: number;
  error?: string;
  message?: string;
}

export type DeepEffort = "fast" | "balanced" | "thorough";

export type ResearchMode = "general" | "code" | "company" | "similar" | "deep";

export type RetrievalType = "auto" | "fast" | "neural";

export type LivecrawlMode = "never" | "fallback" | "always" | "preferred";

export type SearchCategory =
  | "company"
  | "research paper"
  | "news"
  | "pdf"
  | "github"
  | "tweet"
  | "personal site"
  | "people"
  | "financial report";

export interface RawResearchPolicy {
  mode?: unknown;
  type?: unknown;
  livecrawl?: unknown;
  category?: unknown;
  country?: unknown;
  includeDomains?: unknown;
  excludeDomains?: unknown;
  includeText?: unknown;
  excludeText?: unknown;
  preferredDomains?: unknown;
  seedUrls?: unknown;
  customInstruction?: unknown;
  instructions?: unknown;
  instruction?: unknown;
  numResults?: unknown;
  maxHops?: unknown;
  startPublishedDate?: unknown;
  endPublishedDate?: unknown;
  sites?: unknown;
  companyName?: unknown;
  query?: unknown;
  [key: string]: unknown;
}

export interface CountryProfile {
  label: string;
  domains: string[];
  seedUrls: (query: string) => string[];
}

export interface CategoryProfile {
  queryHint: string;
  includeDomains: string[];
  includeText: string[];
}

export interface NormalizedResearchPolicy {
  advanced: boolean;
  mode: ResearchMode;
  type: RetrievalType;
  livecrawl: LivecrawlMode;
  category: string | null;
  country: string | null;
  countryLabel: string | null;
  includeDomains: string[];
  excludeDomains: string[];
  includeText: string[];
  excludeText: string[];
  preferredDomains: string[];
  seedUrls: string[];
  customInstruction: string | null;
  requestedResults: number;
  requestedMaxPages: number | null;
  requestedMaxHops: number | null;
  startPublishedDate: string | null;
  endPublishedDate: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

export interface EngineResearchConfig {
  researchMaxPages: number;
  researchMaxHops: number;
  researchSameDomainOnly: boolean;
}

export interface ResearchPlan {
  maxPages: number;
  maxHops: number;
  sameDomainOnly: boolean;
  seedUrls: string[];
  seedHosts: Set<string>;
  policy: NormalizedResearchPolicy;
}

export interface SearchResultEntry {
  url: string;
  title?: string;
  snippet?: string;
  author?: string;
  published?: string;
  content?: string;
  wordCount?: number;
  status?: number;
  cache?: Record<string, unknown>;
  rank?: number;
  domain?: string;
  error?: string;
}

export interface WebSearchLikeResult {
  results: SearchResultEntry[];
  [key: string]: unknown;
}

export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface DeepEffortProfile {
  numResults: number;
  maxHops: number;
  refinementPasses: number;
  minPrimarySources: number;
  thinkingLevel: AgentThinkingLevel;
  queryTimeoutMs: number;
  textMaxCharacters: number;
  contextMaxCharacters: number;
}

export interface DeepResearchTaskRecord {
  researchId: string;
  status: "pending" | "running" | "completed" | "failed";
  instructions: string;
  effort: DeepEffort;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  report: string | null;
  citations: string[];
  error: string | null;
  costDollars: number;
}
