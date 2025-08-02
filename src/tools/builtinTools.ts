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

For time-based queries:
1. First call getTimeRangeMs to convert the time expression
2. Then use localSearch with the timeRange parameter
3. Only use words from the original query for salientTerms`,
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
      displayName: "Replace in File",
      description: "Make targeted changes to existing files using SEARCH/REPLACE blocks",
      category: "file",
      requiresVault: true,
      customPromptInstructions: `When using replaceInFile, provide exact SEARCH/REPLACE blocks with precise content matching. Use this for surgical edits to existing files.`,
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
