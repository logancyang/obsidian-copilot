import { getSettings } from "@/settings/model";
import { Vault } from "obsidian";
import { replaceInFileTool, writeToFileTool } from "./ComposerTools";
import { createGetFileTreeTool } from "./FileTreeTools";
import { memoryTool } from "./memoryTools";
import { readNoteTool } from "./NoteTools";
import { localSearchTool, webSearchTool } from "./SearchTools";
import {
  convertTimeBetweenTimezonesTool,
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
} from "./TimeTools";
import { ToolDefinition, ToolRegistry } from "./ToolRegistry";
import { youtubeTranscriptionTool } from "./YoutubeTools";

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
      copilotCommands: ["@vault"],
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
      copilotCommands: ["@websearch", "@web"],
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

  // File tools
  {
    tool: readNoteTool,
    metadata: {
      id: "readNote",
      displayName: "Read Note",
      description: "Read a specific note in sequential chunks using the vault chunking pipeline.",
      category: "file",
      requiresVault: true,
      isAlwaysEnabled: true,
      customPromptInstructions: `For readNote:
- Decide based on the user's request: only call this tool when the question requires reading note content.
- If the user is asking about a note that is already mentioned or linked in <active_note> or <note_context> blocks, call readNote directly—do not use localSearch to look it up. Skip the tool when a note is irrelevant.
- If the user asks about notes linked from that note, read the original note first, then follow the "linkedNotes" paths returned in the tool result to inspect those linked notes.
- Always start with chunk 0 (omit <chunkIndex> or set it to 0). Only request the next chunk if the previous chunk did not answer the question.
- Pass vault-relative paths without a leading slash. If a call fails, adjust the path (for example, add ".md" or use an alternative candidate) and retry only if necessary.
- Every tool result may include a "linkedNotes" array. If the user needs information from those linked notes, call readNote again with one of the provided candidate paths, starting again at chunk 0. Do not expand links you don't need.
- Stop calling readNote as soon as you have the required information.

Example (first chunk):
<use_tool>
<name>readNote</name>
<notePath>Projects/launch-plan.md</notePath>
</use_tool>

Example (next chunk):
<use_tool>
<name>readNote</name>
<notePath>Projects/launch-plan.md</notePath>
<chunkIndex>1</chunkIndex>
</use_tool>`,
    },
  },
  {
    tool: writeToFileTool,
    metadata: {
      id: "writeToFile",
      displayName: "Write to File",
      description: "Create or modify files in your vault",
      category: "file",
      requiresVault: true,
      copilotCommands: ["@composer"],
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
      displayName: "Replace in File",
      description: "Make targeted changes to existing files using SEARCH/REPLACE blocks",
      category: "file",
      requiresVault: true,
      customPromptInstructions: `For replaceInFile:
- Remember: Small edits → replaceInFile, Major rewrites → writeToFile
- SEARCH text must match EXACTLY including all whitespace

Example usage:
<use_tool>
<name>replaceInFile</name>
<path>notes/meeting.md</path>
<diff>
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
</diff>
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
 * Register the memory tool separately as it depends on saved memory setting
 */
export function registerMemoryTool(): void {
  const registry = ToolRegistry.getInstance();

  registry.register({
    tool: memoryTool,
    metadata: {
      id: "memoryTool",
      displayName: "Save Memory",
      description: "Save information to user memory when explicitly asked to remember something",
      category: "memory",
      copilotCommands: ["@memory"],
      isAlwaysEnabled: true,
      customPromptInstructions: `For memoryTool:
- Use ONLY when the user explicitly asks you to remember something (phrases like "remember that", "don't forget", etc.)
- DO NOT use for general information - only for personal facts, preferences, or specific things the user wants stored
- Extract the key information to remember from the user's message

Example usage:
<use_tool>
<name>memoryTool</name>
<memoryContent>User's favorite programming language is Python and they prefer functional programming style</memoryContent>
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
  const settings = getSettings();

  // Only reinitialize if tools have changed or vault/memory status has changed
  const hasFileTree = registry.getToolMetadata("getFileTree") !== undefined;
  const shouldHaveFileTree = vault !== undefined;
  const hasMemoryTool = registry.getToolMetadata("memoryTool") !== undefined;
  const shouldHaveMemoryTool = settings.enableSavedMemory;

  if (
    registry.getAllTools().length === 0 ||
    hasFileTree !== shouldHaveFileTree ||
    hasMemoryTool !== shouldHaveMemoryTool
  ) {
    // Clear any existing tools
    registry.clear();

    // Register all built-in tools
    registry.registerAll(BUILTIN_TOOLS);

    // Register vault-dependent tools if vault is available
    if (vault) {
      registerFileTreeTool(vault);
    }

    // Register memory tool if saved memory is enabled
    if (settings.enableSavedMemory) {
      registerMemoryTool();
    }
  }
}
