import { ToolDefinition, ToolRegistry } from "./ToolRegistry";
import { localSearchTool, webSearchTool } from "./SearchTools";
import {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  pomodoroTool,
  convertTimeBetweenTimezonesTool,
} from "./TimeTools";
import { youtubeTranscriptionTool } from "./YoutubeTools";
import { writeToFileTool, replaceInFileTool } from "./ComposerTools";
import { createGetFileTreeTool } from "./FileTreeTools";
import { Vault } from "obsidian";

/**
 * Define all built-in tools with their metadata
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  // Search tools
  {
    tool: localSearchTool,
    metadata: {
      id: "localSearch",
      displayName: "Vault Search",
      description: "Search through your vault notes",
      category: "search",
      customPromptInstructions: `For localSearch (searching notes in the vault):
- You MUST always provide both "query" (string) and "salientTerms" (array of strings)
- salientTerms MUST be extracted from the user's original query - never invent new terms
- They are keywords used for BM25 full-text search to find notes containing those exact words
- Extract meaningful content words from the query (nouns, verbs, names, etc.)
- Exclude common words like "what", "I", "do", "the", "a", etc.
- Exclude time expressions like "last month", "yesterday", "last week"
- Preserve the original language - do NOT translate terms to English

Example usage:
<use_tool>
<name>localSearch</name>
<query>piano learning practice</query>
<salientTerms>["piano", "learning", "practice"]</salientTerms>
</use_tool>

For localSearch with time range (e.g., "what did I do last week"):
Step 1 - Get time range:
<use_tool>
<name>getTimeRangeMs</name>
<timeExpression>last week</timeExpression>
</use_tool>

Step 2 - Search with time range (after receiving time range result):
<use_tool>
<name>localSearch</name>
<query>what did I do</query>
<salientTerms>[]</salientTerms>
<timeRange>{"startTime": {...}, "endTime": {...}}</timeRange>
</use_tool>

For localSearch with meaningful terms (e.g., "python debugging notes from yesterday"):
Step 1 - Get time range:
<use_tool>
<name>getTimeRangeMs</name>
<timeExpression>yesterday</timeExpression>
</use_tool>

Step 2 - Search with time range:
<use_tool>
<name>localSearch</name>
<query>python debugging notes</query>
<salientTerms>["python", "debugging", "notes"]</salientTerms>
<timeRange>{"startTime": {...}, "endTime": {...}}</timeRange>
</use_tool>

For localSearch with non-English query (PRESERVE ORIGINAL LANGUAGE):
<use_tool>
<name>localSearch</name>
<query>钢琴学习</query>
<salientTerms>["钢琴", "学习"]</salientTerms>
</use_tool>`,
    },
  },
  {
    tool: webSearchTool,
    metadata: {
      id: "webSearch",
      displayName: "Web Search",
      description: "Search the internet for information",
      category: "search",
      customPromptInstructions: `For webSearch:
- Only use when the user explicitly requests web/internet search
- Always provide an empty chatHistory array

Example usage:
<use_tool>
<name>webSearch</name>
<query>piano learning techniques</query>
<chatHistory>[]</chatHistory>
</use_tool>`,
    },
  },

  // Time tools (always enabled)
  {
    tool: getCurrentTimeTool,
    metadata: {
      id: "getCurrentTime",
      displayName: "Get Current Time",
      description: "Get the current time in any timezone",
      category: "time",
      isAlwaysEnabled: true,
      customPromptInstructions: `For time queries (IMPORTANT: Always use UTC offsets, not timezone names):

Example 1 - "what time is it" (local time):
<use_tool>
<name>getCurrentTime</name>
</use_tool>

Example 2 - "what time is it in Tokyo" (UTC+9):
<use_tool>
<name>getCurrentTime</name>
<timezoneOffset>+9</timezoneOffset>
</use_tool>

Example 3 - "what time is it in New York" (UTC-5 or UTC-4 depending on DST):
<use_tool>
<name>getCurrentTime</name>
<timezoneOffset>-5</timezoneOffset>
</use_tool>`,
    },
  },
  {
    tool: getTimeInfoByEpochTool,
    metadata: {
      id: "getTimeInfoByEpoch",
      displayName: "Get Time Info",
      description: "Convert epoch timestamp to human-readable format",
      category: "time",
      isAlwaysEnabled: true,
    },
  },
  {
    tool: getTimeRangeMsTool,
    metadata: {
      id: "getTimeRangeMs",
      displayName: "Get Time Range",
      description: "Convert time expressions to date ranges",
      category: "time",
      isAlwaysEnabled: true,
      customPromptInstructions: `For time-based queries:
- Use this tool to convert time expressions like "last week", "yesterday", "last month" to proper time ranges
- This is typically the first step before using localSearch with a time range

Example:
<use_tool>
<name>getTimeRangeMs</name>
<timeExpression>last week</timeExpression>
</use_tool>`,
    },
  },
  {
    tool: convertTimeBetweenTimezonesTool,
    metadata: {
      id: "convertTimeBetweenTimezones",
      displayName: "Convert Timezones",
      description: "Convert time between different timezones",
      category: "time",
      isAlwaysEnabled: true,
      customPromptInstructions: `For timezone conversions:

Example - "what time is 6pm PT in Tokyo" (PT is UTC-8 or UTC-7, Tokyo is UTC+9):
<use_tool>
<name>convertTimeBetweenTimezones</name>
<time>6pm</time>
<fromOffset>-8</fromOffset>
<toOffset>+9</toOffset>
</use_tool>`,
    },
  },
  {
    tool: pomodoroTool,
    metadata: {
      id: "pomodoro",
      displayName: "Pomodoro Timer",
      description: "Manage time with Pomodoro technique",
      category: "time",
    },
  },

  // File tools
  {
    tool: writeToFileTool,
    metadata: {
      id: "writeToFile",
      displayName: "Write to File",
      description: "Create or modify files in your vault",
      category: "file",
      requiresVault: true,
      customPromptInstructions: `For writeToFile:
- NEVER display the file content directly in your response
- Always pass the complete file content to the tool
- Include the full path to the file
- You MUST explicitly call writeToFile for any intent of updating or creating files
- Do not call writeToFile tool again if the result is not accepted
- Do not call writeToFile tool if no change needs to be made

Example usage:
<use_tool>
<name>writeToFile</name>
<path>path/to/note.md</path>
<content>FULL CONTENT OF THE NOTE</content>
</use_tool>`,
    },
  },
  {
    tool: replaceInFileTool,
    metadata: {
      id: "replaceInFile",
      displayName: "Replace in File (Experimental)",
      description:
        "Make targeted changes to existing files using SEARCH/REPLACE blocks. (This tool is experimental and may not work reliably)",
      category: "file",
      requiresVault: true,
      customPromptInstructions: `For replaceInFile:
- Remember: Small edits → replaceInFile, Major rewrites → writeToFile
- SEARCH text must match EXACTLY including all whitespace

Example usage:
<use_tool>
<name>replaceInFile</name>
<path>notes/meeting.md</path>
<diff>\`\`\`
------- SEARCH
## Attendees
- John Smith
- Jane Doe
=======
## Attendees
- John Smith
- Jane Doe
- Bob Johnson
+++++++ REPLACE
\`\`\`</diff>
</use_tool>`,
    },
  },

  // Media tools
  {
    tool: youtubeTranscriptionTool,
    metadata: {
      id: "youtubeTranscription",
      displayName: "YouTube Transcription",
      description: "Get transcripts from YouTube videos",
      category: "media",
      customPromptInstructions: `For youtubeTranscription:
- Use when user provides YouTube URLs
- No parameters needed - the tool will process URLs from the conversation

Example usage:
<use_tool>
<name>youtubeTranscription</name>
</use_tool>`,
    },
  },
];

/**
 * Register the file tree tool separately as it needs vault access
 */
export function registerFileTreeTool(vault: Vault): void {
  const registry = ToolRegistry.getInstance();

  registry.register({
    tool: createGetFileTreeTool(vault.getRoot()),
    metadata: {
      id: "getFileTree",
      displayName: "File Tree",
      description: "Browse vault file structure",
      category: "file",
      isAlwaysEnabled: true,
      requiresVault: true,
      customPromptInstructions: `For getFileTree:
- Use to browse the vault's file structure
- No parameters needed

Example usage:
<use_tool>
<name>getFileTree</name>
</use_tool>`,
    },
  });
}

/**
 * Initialize all built-in tools in the registry.
 * This function registers tool definitions, not user preferences.
 * User-enabled tools are filtered dynamically when retrieved.
 *
 * @param vault - Optional Obsidian vault. When provided, enables registration of vault-dependent tools like file tree
 */
export function initializeBuiltinTools(vault?: Vault): void {
  const registry = ToolRegistry.getInstance();

  // Only reinitialize if tools have changed or vault status has changed
  const hasFileTree = registry.getToolMetadata("getFileTree") !== undefined;
  const shouldHaveFileTree = vault !== undefined;

  if (registry.getAllTools().length === 0 || hasFileTree !== shouldHaveFileTree) {
    // Clear any existing tools
    registry.clear();

    // Register all built-in tools
    registry.registerAll(BUILTIN_TOOLS);

    // Register vault-dependent tools if vault is available
    if (vault) {
      registerFileTreeTool(vault);
    }
  }
}
