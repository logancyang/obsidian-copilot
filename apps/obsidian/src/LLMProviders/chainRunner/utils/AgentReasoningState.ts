export interface ReasoningStep {
  timestamp: number;
  summary: string;
  toolName?: string;
}

export type ReasoningStatus = "idle" | "reasoning" | "collapsed" | "complete";

export interface AgentReasoningState {
  status: ReasoningStatus;
  startTime: number | null;
  elapsedSeconds: number;
  steps: ReasoningStep[];
}

export function createInitialReasoningState(): AgentReasoningState {
  return {
    status: "idle",
    startTime: null,
    elapsedSeconds: 0,
    steps: [],
  };
}

export function serializeReasoningBlock(state: AgentReasoningState): string {
  if (state.status === "idle") {
    return "";
  }

  const stepsJson = JSON.stringify(state.steps.map((s) => s.summary));
  return `<!--AGENT_REASONING:${state.status}:${state.elapsedSeconds}:${stepsJson}-->`;
}

export interface ParsedReasoningBlock {
  hasReasoning: boolean;
  status: ReasoningStatus;
  elapsedSeconds: number;
  steps: string[];
  contentAfter: string;
}

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

export interface QueryExpansionInfo {
  originalQuery: string;
  salientTerms: string[];
  expandedQueries: string[];
  recallTerms: string[];
}

export interface LocalSearchSourceInfo {
  titles: string[];
  count: number;
  queryExpansion?: QueryExpansionInfo;
}

export function summarizeToolResult(
  toolName: string,
  result: { success: boolean; result?: string },
  sourceInfo?: LocalSearchSourceInfo,
  args?: Record<string, unknown>
): string {
  if (!result.success) {
    return `${summarizeToolCall(toolName, args)} failed`;
  }

  switch (toolName) {
    case "localSearch": {
      if (sourceInfo && sourceInfo.count > 0) {
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
    case "youtubeTranscription":
      return "Fetched video transcript";
    case "fetchUrl":
      return "Fetched URL content";
    case "getFileTree":
      return "Retrieved vault file tree";
    case "getTagList":
      return "Retrieved vault tags";
    case "getCurrentTime":
      return "Got current time";
    case "getTimeInfoByEpoch":
      return "Converted timestamp";
    case "convertTimeBetweenTimezones":
      return "Converted timezone";
    case "obsidianDailyNote": {
      const command = args?.command as string | undefined;
      const vault = args?.vault as string | undefined;
      const vaultSuffix = vault && vault.trim().length > 0 ? ` from "${vault}"` : "";
      if (command === "daily:path") return `Got daily note path${vaultSuffix}`;
      return `Loaded today's daily note${vaultSuffix}`;
    }
    case "obsidianRandomRead": {
      const vault = args?.vault as string | undefined;
      if (vault && vault.trim().length > 0) {
        return `Loaded a random note from "${vault}"`;
      }
      return "Loaded a random note";
    }
    case "obsidianProperties": {
      const command = args?.command as string | undefined;
      if (command === "property:read") {
        const name = args?.name as string | undefined;
        return name ? `Read property "${name}"` : "Read property";
      }
      return "Listed vault properties";
    }
    case "obsidianTasks":
      return "Listed vault tasks";
    case "obsidianLinks": {
      const command = args?.command as string | undefined;
      if (command === "backlinks") return "Listed backlinks";
      if (command === "links") return "Listed outgoing links";
      if (command === "orphans") return "Listed orphaned notes";
      if (command === "unresolved") return "Listed unresolved links";
      return "Queried link graph";
    }
    case "obsidianTemplates": {
      const command = args?.command as string | undefined;
      if (command === "template:read") {
        const name = args?.name as string | undefined;
        return name ? `Read template "${name}"` : "Read template";
      }
      return "Listed templates";
    }
    case "obsidianBases": {
      const command = args?.command as string | undefined;
      if (command === "base:views") return "Listed base views";
      if (command === "base:query") return "Queried base data";
      return "Listed bases";
    }
    case "updateMemory":
      return "Updated memory";
    case "writeFile":
    case "editFile": {
      const filePath = args?.path as string | undefined;
      const fileName = filePath ? filePath.split("/").pop() || filePath : "file";

      const resultStr = result.result || "";
      if (resultStr.includes('"rejected"') || resultStr.includes("rejected")) {
        return `Edit rejected for "${fileName}"`;
      }
      if (resultStr.includes('"failed"') || resultStr.includes("Error")) {
        return `Edit failed for "${fileName}"`;
      }
      return toolName === "writeFile" ? `Wrote to "${fileName}"` : `Edited "${fileName}"`;
    }
    default:
      return "Done";
  }
}

export function summarizeToolCall(toolName: string, args?: Record<string, unknown>): string {
  switch (toolName) {
    case "localSearch": {
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
    case "youtubeTranscription":
      return "Fetching video transcript";
    case "fetchUrl":
      return "Fetching URL content";
    case "getFileTree":
      return "Browsing vault file tree";
    case "getTagList":
      return "Loading vault tags";
    case "getCurrentTime":
      return "Getting current time";
    case "getTimeInfoByEpoch":
      return "Converting timestamp";
    case "convertTimeBetweenTimezones":
      return "Converting timezone";
    case "obsidianDailyNote": {
      const command = args?.command as string | undefined;
      const vault = args?.vault as string | undefined;
      const vaultSuffix = vault && vault.trim().length > 0 ? ` from "${vault}"` : "";
      if (command === "daily:path") return `Getting daily note path${vaultSuffix}`;
      return `Reading today's daily note${vaultSuffix}`;
    }
    case "obsidianRandomRead": {
      const vault = args?.vault as string | undefined;
      if (vault && vault.trim().length > 0) {
        return `Reading a random note from "${vault}"`;
      }
      return "Reading a random note";
    }
    case "obsidianProperties": {
      const command = args?.command as string | undefined;
      if (command === "property:read") {
        const name = args?.name as string | undefined;
        return name ? `Reading property "${name}"` : "Reading property";
      }
      return "Listing vault properties";
    }
    case "obsidianTasks":
      return "Listing vault tasks";
    case "obsidianLinks": {
      const command = args?.command as string | undefined;
      if (command === "backlinks") return "Listing backlinks";
      if (command === "links") return "Listing outgoing links";
      if (command === "orphans") return "Listing orphaned notes";
      if (command === "unresolved") return "Listing unresolved links";
      return "Querying link graph";
    }
    case "obsidianTemplates": {
      const command = args?.command as string | undefined;
      if (command === "template:read") {
        const name = args?.name as string | undefined;
        return name ? `Reading template "${name}"` : "Reading template";
      }
      return "Listing templates";
    }
    case "obsidianBases": {
      const command = args?.command as string | undefined;
      if (command === "base:views") return "Listing base views";
      if (command === "base:query") return "Querying base data";
      return "Listing bases";
    }
    case "updateMemory":
      return "Saving to memory";
    case "writeFile": {
      const filePath = args?.path as string | undefined;
      if (filePath) {
        const fileName = filePath.split("/").pop() || filePath;
        return `Writing to "${fileName}"`;
      }
      return "Writing to file";
    }
    case "editFile": {
      const filePath = args?.path as string | undefined;
      if (filePath) {
        const fileName = filePath.split("/").pop() || filePath;
        return `Editing "${fileName}"`;
      }
      return "Editing file";
    }
    default:
      return "Processing";
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}

export function extractFirstSentence(content: string): string | null {
  if (!content || content.trim().length === 0) {
    return null;
  }

  const firstLine = content.trim().split("\n")[0];
  return truncate(firstLine, 100);
}
