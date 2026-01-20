/**
 * Agent Reasoning Block State Management
 *
 * This module provides state management for the Agent Reasoning Block UI component,
 * which replaces the old tool call banner with a more informative reasoning display.
 */

/**
 * Represents a single reasoning step in the agent loop
 */
export interface ReasoningStep {
  timestamp: number;
  summary: string;
  toolName?: string;
}

/**
 * Status of the reasoning block
 * - idle: No agent activity
 * - reasoning: Agent is actively processing/executing tools
 * - collapsed: Reasoning complete, block is collapsed
 * - complete: Response complete, block can be expanded
 */
export type ReasoningStatus = "idle" | "reasoning" | "collapsed" | "complete";

/**
 * Full state for the Agent Reasoning Block
 */
export interface AgentReasoningState {
  status: ReasoningStatus;
  startTime: number | null;
  elapsedSeconds: number;
  steps: ReasoningStep[];
}

/**
 * Creates the initial reasoning state
 */
export function createInitialReasoningState(): AgentReasoningState {
  return {
    status: "idle",
    startTime: null,
    elapsedSeconds: 0,
    steps: [],
  };
}

/**
 * Data structure for serialized reasoning block (embedded in message)
 */
export interface SerializedReasoningData {
  elapsed: number;
  steps: string[];
}

/**
 * Serialize reasoning state to a marker format for embedding in messages.
 * Format: <!--AGENT_REASONING:status:elapsedSeconds:["step1","step2"]-->
 *
 * @param state - The reasoning state to serialize
 * @returns Marker string to embed in message
 */
export function serializeReasoningBlock(state: AgentReasoningState): string {
  if (state.status === "idle") {
    return "";
  }

  const stepsJson = JSON.stringify(state.steps.map((s) => s.summary));
  return `<!--AGENT_REASONING:${state.status}:${state.elapsedSeconds}:${stepsJson}-->`;
}

/**
 * Parsed reasoning data from a marker
 */
export interface ParsedReasoningBlock {
  hasReasoning: boolean;
  status: ReasoningStatus;
  elapsedSeconds: number;
  steps: string[];
  contentAfter: string;
}

/**
 * Parse reasoning block marker from message content.
 *
 * @param content - Message content that may contain reasoning marker
 * @returns Parsed reasoning data or null if no marker found
 */
export function parseReasoningBlock(content: string): ParsedReasoningBlock | null {
  const match = content.match(/<!--AGENT_REASONING:(\w+):(\d+):(.+?)-->/);
  if (!match) {
    return null;
  }

  const [fullMatch, status, elapsed, stepsJson] = match;

  let steps: string[] = [];
  try {
    steps = JSON.parse(stepsJson) as string[];
  } catch {
    // Invalid JSON, return empty steps
    steps = [];
  }

  return {
    hasReasoning: true,
    status: status as ReasoningStatus,
    elapsedSeconds: parseInt(elapsed, 10),
    steps,
    contentAfter: content.replace(fullMatch, "").trim(),
  };
}

/**
 * Query expansion info for localSearch.
 * Contains both the individual expansion components and a combined list of all recall terms.
 */
export interface QueryExpansionInfo {
  originalQuery: string;
  salientTerms: string[]; // Terms from original query (used for ranking)
  expandedQueries: string[]; // Alternative phrasings (used for recall)
  expandedTerms: string[]; // LLM-generated related terms (used for recall)
  recallTerms: string[]; // All terms combined that were used for recall
}

/**
 * Source info for localSearch results
 */
export interface LocalSearchSourceInfo {
  titles: string[];
  count: number;
  queryExpansion?: QueryExpansionInfo;
}

/**
 * Generate a human-readable summary for a tool result.
 *
 * @param toolName - Name of the tool that was executed
 * @param result - Result from the tool execution
 * @param sourceInfo - Optional source info for localSearch results
 * @param args - Optional original tool call arguments for context
 * @returns Human-readable summary string
 */
export function summarizeToolResult(
  toolName: string,
  result: { success: boolean; result?: string },
  sourceInfo?: LocalSearchSourceInfo,
  args?: Record<string, unknown>
): string {
  if (!result.success) {
    return `${toolName} failed`;
  }

  switch (toolName) {
    case "localSearch": {
      if (sourceInfo && sourceInfo.count > 0) {
        // Show just the count and first few note titles (terms are shown in tool call summary)
        const titleList = sourceInfo.titles.slice(0, 3);
        const remaining = sourceInfo.count - titleList.length;
        let result = `Found ${sourceInfo.count} note${sourceInfo.count !== 1 ? "s" : ""}: ${titleList.join(", ")}`;
        if (remaining > 0) {
          result += ` +${remaining} more`;
        }
        return result;
      }
      return "No matching notes found";
    }
    case "webSearch":
      return "Retrieved web search results";
    case "getTimeRangeMs":
      return "Calculated time range";
    case "readFile":
      return "Read file content";
    case "readNote": {
      const notePath = args?.notePath as string | undefined;
      if (notePath) {
        const noteTitle = notePath.split("/").pop()?.replace(/\.md$/i, "") || notePath;
        return `Read "${noteTitle}"`;
      }
      return "Read note content";
    }
    case "createNote":
      return "Created new note";
    case "appendToNote":
      return "Appended to note";
    case "editNote":
      return "Edited note";
    case "deleteNote":
      return "Deleted note";
    case "youtubeTranscript":
      return "Fetched video transcript";
    case "fetchUrl":
      return "Fetched URL content";
    default:
      return `Completed ${toolName}`;
  }
}

/**
 * Generate a summary for when a tool is being called.
 *
 * @param toolName - Name of the tool being called
 * @param args - Arguments being passed to the tool
 * @param expansion - Optional pre-expanded query data for localSearch
 * @returns Human-readable summary string
 */
export function summarizeToolCall(
  toolName: string,
  args?: Record<string, unknown>,
  expansion?: QueryExpansionInfo
): string {
  switch (toolName) {
    case "localSearch": {
      // If we have pre-expanded terms, show all recall terms
      if (expansion && expansion.recallTerms && expansion.recallTerms.length > 0) {
        // Filter to valid strings only, excluding "[object Object]" artifacts
        const validTerms = expansion.recallTerms.filter(
          (t): t is string =>
            typeof t === "string" &&
            t.trim().length > 0 &&
            !t.includes("[object ") &&
            t !== "[object Object]"
        );
        if (validTerms.length > 0) {
          const terms = validTerms
            .slice(0, 6)
            .map((t) => `"${t}"`)
            .join(", ");
          const moreCount = validTerms.length - 6;
          const termsSuffix = moreCount > 0 ? ` +${moreCount} more` : "";
          return `Searching notes for ${terms}${termsSuffix}`;
        }
      }
      // Fallback to query if no expansion available
      const query = args?.query as string | undefined;
      if (query) {
        const truncatedQuery = query.length > 50 ? query.slice(0, 50) + "..." : query;
        return `Searching notes for "${truncatedQuery}"`;
      }
      return "Searching notes";
    }
    case "webSearch": {
      const query = args?.query as string | undefined;
      if (query) {
        const truncatedQuery = query.length > 30 ? query.slice(0, 30) + "..." : query;
        return `Searching web for "${truncatedQuery}"`;
      }
      return "Searching the web";
    }
    case "getTimeRangeMs":
      return "Calculating time range";
    case "readFile": {
      const path = args?.path as string | undefined;
      if (path) {
        const fileName = path.split("/").pop() || path;
        return `Reading "${fileName}"`;
      }
      return "Reading file";
    }
    case "readNote": {
      const notePath = args?.notePath as string | undefined;
      if (notePath) {
        // Extract note title from path (remove .md extension and get last segment)
        const noteTitle = notePath.split("/").pop()?.replace(/\.md$/i, "") || notePath;
        return `Reading "${noteTitle}"`;
      }
      return "Reading note";
    }
    case "createNote":
      return "Creating new note";
    case "appendToNote":
      return "Appending to note";
    case "editNote":
      return "Editing note";
    case "deleteNote":
      return "Deleting note";
    case "youtubeTranscript":
      return "Fetching video transcript";
    case "fetchUrl":
      return "Fetching URL content";
    default:
      return `Calling ${toolName}`;
  }
}
