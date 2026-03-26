import type { YagamiEngine } from "./engine.js";

export type JsonObject = Record<string, unknown>;

export const MCP_DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export const MCP_SUPPORTED_PROTOCOL_VERSIONS = new Set<string>([MCP_DEFAULT_PROTOCOL_VERSION, "2025-03-26"]);

export type McpToolContent = {
  type: "text";
  text: string;
};

export type McpToolCallResult = {
  content: McpToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
};

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "web_search",
    title: "Yagami Search",
    description: "Search the web for any topic and get clean, ready-to-use content. Returns collated source content.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Web search query",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_code_context",
    title: "Yagami Code Search",
    description:
      "Find code examples, documentation, and programming solutions from sources like GitHub, Stack Overflow, and official docs.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for code context",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_content",
    title: "Yagami Fetch",
    description: "Fetch and extract full content from a specific URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to crawl and extract content from",
        },
        maxCharacters: {
          type: "number",
          description: "Maximum characters to extract (default: 3000)",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "company_research",
    title: "Yagami Company Research",
    description: "Research a company using Yagami's company-search mode.",
    inputSchema: {
      type: "object",
      properties: {
        companyName: {
          type: "string",
          description: "Name of the company to research",
        },
      },
      required: ["companyName"],
      additionalProperties: false,
    },
  },
  {
    name: "web_search_advanced",
    title: "Yagami Advanced Search",
    description: "Advanced web search with optional domain and category filtering.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        includeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Only include results from these domains",
        },
        excludeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Exclude results from these domains",
        },
        category: {
          type: "string",
          description: "Filter results to a specific category",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "find_similar",
    title: "Yagami Similar",
    description: "Find pages similar to a given URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to find similar pages for",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "deep_research_start",
    title: "Yagami Deep Research Start",
    description: "Start an async deep research task.",
    inputSchema: {
      type: "object",
      properties: {
        instructions: {
          type: "string",
          description: "Complex research question or detailed instructions",
        },
        effort: {
          type: "string",
          enum: ["fast", "balanced", "thorough"],
          description: "Research effort level",
        },
      },
      required: ["instructions"],
      additionalProperties: false,
    },
  },
  {
    name: "deep_research_check",
    title: "Yagami Deep Research Check",
    description: "Check status and result of a deep research task.",
    inputSchema: {
      type: "object",
      properties: {
        researchId: {
          type: "string",
          description: "Research ID returned by deep_research_start",
        },
      },
      required: ["researchId"],
      additionalProperties: false,
    },
  },
];

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
}

function getTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function formatToolTextResult(result: unknown): string {
  if (typeof result === "string") return result;

  const obj = asObject(result);
  if (typeof obj.answer === "string") return obj.answer;
  if (typeof obj.text === "string") return obj.text;

  return JSON.stringify(result, null, 2);
}

function toMcpToolResult(result: unknown): McpToolCallResult {
  const payload: McpToolCallResult = {
    content: [{ type: "text", text: formatToolTextResult(result) }],
  };

  if (typeof result === "object" && result !== null) {
    payload.structuredContent = result;
  }

  return payload;
}

function defaultFindSimilarQuery(url: string): string {
  return `Find web pages similar to ${url}. Focus on same product category, target users, and use-case overlap. Avoid dictionary/synonym pages.`;
}

function assertRequiredString(value: unknown, fieldName: string): string {
  const normalized = getTrimmedString(value);
  if (!normalized) {
    throw new Error(`Missing required field: ${fieldName}`);
  }
  return normalized;
}

export async function executeMcpTool(
  engine: YagamiEngine,
  toolName: string,
  rawArgs: unknown,
): Promise<McpToolCallResult> {
  const args = asObject(rawArgs);

  switch (toolName) {
    case "web_search": {
      const query = assertRequiredString(args.query, "query");
      const result = await engine.enqueueQuery(query, {});
      return toMcpToolResult(result);
    }

    case "web_search_advanced": {
      const query = assertRequiredString(args.query, "query");
      const result = await engine.enqueueQuery(query, {
        researchPolicy: args,
      });
      return toMcpToolResult(result);
    }

    case "get_code_context": {
      const query = assertRequiredString(args.query, "query");
      const result = await engine.enqueueQuery(query, {
        researchPolicy: {
          mode: "code",
          ...args,
        },
      });
      return toMcpToolResult(result);
    }

    case "fetch_content": {
      const url = assertRequiredString(args.url, "url");
      const result = await engine.enqueueOperation(() =>
        engine.fetchContent(url, {
          maxCharacters: args.maxCharacters,
          noCache: args.noCache,
        }),
      );
      return toMcpToolResult(result);
    }

    case "company_research": {
      const companyName = assertRequiredString(args.companyName ?? args.query, "companyName");
      const query = getTrimmedString(args.query || companyName);

      const result = await engine.enqueueQuery(query, {
        researchPolicy: {
          mode: "company",
          ...args,
          companyName,
        },
      });
      return toMcpToolResult(result);
    }

    case "find_similar": {
      const url = assertRequiredString(args.url, "url");
      const query = getTrimmedString(args.query || defaultFindSimilarQuery(url));
      const seedUrls = [url, ...normalizeStringArray(args.seedUrls)];

      const result = await engine.enqueueQuery(query, {
        researchPolicy: {
          mode: "similar",
          ...args,
          seedUrls,
        },
      });
      return toMcpToolResult(result);
    }

    case "deep_research_start": {
      const instructions = assertRequiredString(args.instructions, "instructions");

      if (args.model !== undefined) {
        throw new Error("Field 'model' has been removed. Use 'effort' (fast|balanced|thorough).");
      }

      const result = await engine.deepResearchStart(instructions, {
        effort: args.effort,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }

    case "deep_research_check": {
      const researchId = assertRequiredString(args.researchId, "researchId");
      const result = await engine.deepResearchCheck(researchId);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export function isKnownMcpTool(toolName: string): boolean {
  return MCP_TOOL_DEFINITIONS.some((tool) => tool.name === toolName);
}
