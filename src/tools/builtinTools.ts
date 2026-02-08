import { getSettings } from "@/settings/model";
import { Vault } from "obsidian";
import { replaceInFileTool, writeToFileTool } from "./ComposerTools";
import { createGetFileTreeTool } from "./FileTreeTools";
import { updateMemoryTool } from "./memoryTools";
import { readNoteTool } from "./NoteTools";
import { localSearchTool, webSearchTool } from "./SearchTools";
import { createGetTagListTool } from "./TagTools";
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
      customPromptInstructions: `For localSearch (searching notes based on their contents in the vault):
- You MUST always provide both "query" (string) and "salientTerms" (array of strings)
- salientTerms MUST be extracted from the user's original query - never invent new terms
- They are keywords used for BM25 full-text search to find notes containing those exact words
- Treat every token that begins with "#" as a high-priority salient term. Keep the leading "#" and the full tag hierarchy (e.g., "#project/phase1").
- Include tagged terms alongside other meaningful words; never strip hashes or rewrite tags into plain words.
- Extract meaningful content words from the query (nouns, verbs, names, etc.)
- Exclude common words like "what", "I", "do", "the", "a", etc.
- Exclude time expressions like "last month", "yesterday", "last week"
- Preserve the original language - do NOT translate terms to English

Evaluating search results and re-searching:
- Results include a relevance quality summary: high (score ≥0.7), medium (0.3-0.7), low (<0.3)
- If most results are low relevance or miss key concepts from the user's question:
  1. Try searching again with synonyms or related terms
  2. Use more specific phrasing if query was too broad
  3. Use more general phrasing if query was too narrow
- Example: "machine learning algorithms" returned low results → try "ML models", "neural networks", or "AI techniques"

Examples:
- Query "piano learning practice" → query: "piano learning practice", salientTerms: ["piano", "learning", "practice"]
- Query "#projectx status update" → query: "#projectx status update", salientTerms: ["#projectx", "status", "update"]
- Query "钢琴学习" (Chinese) → query: "钢琴学习", salientTerms: ["钢琴", "学习"] (preserve original language)

For time-based searches (e.g., "what did I do last week"):
1. First call getTimeRangeMs with timeExpression: "last week"
2. Then use localSearch with the returned timeRange, query matching the user's question, and salientTerms: [] (empty for generic time queries)

For time-based searches with meaningful terms (e.g., "python debugging notes from yesterday"):
1. First call getTimeRangeMs with timeExpression: "yesterday"
2. Then use localSearch with the returned timeRange, query: "python debugging notes", salientTerms: ["python", "debugging", "notes"]

For exhaustive "find all" searches:
- Set returnAll: true when the user wants ALL matching notes (e.g., "find all my X", "list every Y", "show me all Z", "how many notes about W")
- Keep returnAll: false (or omit) for normal questions seeking specific information
- When setting returnAll: true, also call getFileTree to get all note titles as reference. This helps verify search completeness and identify notes the search may have missed.`,
    },
  },
  {
    tool: webSearchTool,
    metadata: {
      id: "webSearch",
      displayName: "Web Search",
      description:
        "Search the INTERNET (NOT vault notes) when user explicitly asks for web/online information",
      category: "search",
      copilotCommands: ["@websearch", "@web"],
      customPromptInstructions: `For webSearch:
- ONLY use when the user's query contains explicit web-search intent like:
  * "web search", "internet search", "online search"
  * "Google", "search online", "look up online", "search the web"
- Always provide an empty chatHistory array

Example: "search the web for python tutorials" → query: "python tutorials", chatHistory: []`,
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

- If the user mentions a specific city, country, or timezone name (e.g., "Tokyo", "Japan", "JST"), you MUST convert it to the correct UTC offset and pass it via the timezoneOffset parameter (e.g., "+9").
- Only omit timezoneOffset when the user asks for the current local time without naming any location or timezone.
- If you cannot confidently determine the offset from the user request, ask the user to clarify before calling the tool.

Examples:
- "what time is it" (local time) → call with no parameters
- "what time is it in Tokyo" (UTC+9) → timezoneOffset: "+9"
- "what time is it in New York" (UTC-5 or UTC-4 depending on DST) → timezoneOffset: "-5"`,
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

Example: For "last week" → timeExpression: "last week"`,
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

Example: "what time is 6pm PT in Tokyo" (PT is UTC-8 or UTC-7, Tokyo is UTC+9) → time: "6pm", fromOffset: "-8", toOffset: "+9"`,
    },
  },

  // File tools
  {
    tool: readNoteTool,
    metadata: {
      id: "readNote",
      displayName: "Read Note",
      description: "Read a specific note in sequential chunks using its own line-chunking logic.",
      category: "file",
      requiresVault: true,
      isAlwaysEnabled: true,
      customPromptInstructions: `For readNote:
- Decide based on the user's request: only call this tool when the question requires reading note content.
- If the user asks about a note title that is already mentioned in the current or previous turns of the conversation, or linked in <active_note> or <note_context> blocks, call readNote directly—do not use localSearch to look it up. Even if the note title mention is partial but similar to what you have seen in the context, try to infer the correct note path from context. Skip the tool when a note is irrelevant to the user query.
- If the user asks about notes linked from that note, read the original note first, then follow the "linkedNotes" paths returned in the tool result to inspect those linked notes.
- Always start with chunk 0 (omit chunkIndex or set it to 0). Only request the next chunk if the previous chunk did not answer the question.
- Pass vault-relative paths without a leading slash. If a call fails, adjust the path (for example, add ".md" or use an alternative candidate) and retry only if necessary.
- Every tool result may include a "linkedNotes" array. If the user needs information from those linked notes, call readNote again with one of the provided candidate paths, starting again at chunk 0. Do not expand links you don't need.
- Stop calling readNote as soon as you have the required information.
- Always call getFileTree to get the exact note path if it is not provided in the context before calling readNote.

Examples:
- First chunk: notePath: "Projects/launch-plan.md" (chunkIndex omitted or 0)
- Next chunk: notePath: "Projects/launch-plan.md", chunkIndex: 1`,
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
      timeoutMs: 0, // No timeout - waits for user preview decision
      copilotCommands: ["@composer"],
      customPromptInstructions: `For writeToFile:
- NEVER display the file content directly in your response
- Always pass the complete file content to the tool
- Include the full path to the file
- You MUST explicitly call writeToFile for any intent of updating or creating files
- Do not call writeToFile tool again if the result is not accepted
- Do not call writeToFile tool if no change needs to be made
- Always create new notes in root folder or folders the user explicitly specifies
- When creating a new note in a folder, you MUST use getFileTree to get the exact folder path first

Examples:
- Basic: path: "path/to/note.md", content: "FULL CONTENT OF THE NOTE"
- Skip confirmation: path: "path/to/note.md", content: "FULL CONTENT", confirmation: false`,
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
      timeoutMs: 0, // No timeout - waits for user preview decision
      customPromptInstructions: `For replaceInFile:
- Remember: Small edits → replaceInFile, Major rewrites → writeToFile
- SEARCH text must match EXACTLY including all whitespace
- The diff parameter uses SEARCH/REPLACE block format

Example: To add "Bob Johnson" to attendees list in notes/meeting.md:
path: "notes/meeting.md"
diff: "------- SEARCH\\n## Attendees\\n- John Smith\\n- Jane Doe\\n=======\\n## Attendees\\n- John Smith\\n- Jane Doe\\n- Bob Johnson\\n+++++++ REPLACE"`,
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
      isPlusOnly: true,
      requiresUserMessageContent: true,
      customPromptInstructions: `For youtubeTranscription:
- Use when user provides YouTube URLs
- No parameters needed - the tool will process URLs from the conversation`,
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
      isBackground: true,
      customPromptInstructions: `For getFileTree:
- Use to browse the vault's file structure including paths of notes and folders
- Always call this tool to explore the exact path of notes or folders when you are not given the exact path.
- DO NOT use this tool to look up note contents or metadata - use localSearch or readNote instead.
- No parameters needed

Example queries that should use getFileTree:
- "Create a new note in the projects folder" → call getFileTree to get the exact folder path
- "Create a new note using the quick note template" → call getFileTree to look up the template path
- "How many files are in the projects folder" → call getFileTree to list all files`,
    },
  });
}

/**
 * Register the tag list tool separately to ensure metadata cache access is available.
 */
export function registerTagListTool(): void {
  const registry = ToolRegistry.getInstance();

  registry.register({
    tool: createGetTagListTool(),
    metadata: {
      id: "getTagList",
      displayName: "Tag List",
      description: "List vault tags with occurrence statistics",
      category: "file",
      isAlwaysEnabled: true,
      requiresVault: true,
      isBackground: true,
      customPromptInstructions: `For getTagList:
- Use to inspect existing tags before suggesting new ones or reorganizing notes.
- Omit parameters to include both frontmatter and inline tags.
- Set includeInline to false when you only need frontmatter-defined tags.
- Use maxEntries to limit output for very large vaults.

Examples:
- Default (all tags): call with no parameters
- Frontmatter only: includeInline: false`,
    },
  });
}

/**
 * Register the memory tool separately as it depends on saved memory setting
 */
export function registerMemoryTool(): void {
  const registry = ToolRegistry.getInstance();

  registry.register({
    tool: updateMemoryTool,
    metadata: {
      id: "updateMemory",
      displayName: "Update Memory",
      description:
        "Save information to user memory when the user explicitly asks to remember something or update the memory",
      category: "memory",
      copilotCommands: ["@memory"],
      isAlwaysEnabled: true,
      customPromptInstructions: `For updateMemory:
- Use this tool to update the memory when the user explicitly asks to update the memory
- DO NOT use for general information - only for personal facts, preferences, or specific things the user wants stored

Example: statement: "I'm studying Japanese and I'm preparing for JLPT N3"`,
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
  const hasUpdateMemoryTool = registry.getToolMetadata("updateMemory") !== undefined;
  const shouldHaveMemoryTool = settings.enableSavedMemory;

  if (
    registry.getAllTools().length === 0 ||
    hasFileTree !== shouldHaveFileTree ||
    hasUpdateMemoryTool !== shouldHaveMemoryTool
  ) {
    // Clear any existing tools
    registry.clear();

    // Register all built-in tools
    registry.registerAll(BUILTIN_TOOLS);

    // Register vault-dependent tools if vault is available
    if (vault) {
      registerFileTreeTool(vault);
      registerTagListTool();
    }

    // Register memory tool if saved memory is enabled
    if (settings.enableSavedMemory) {
      registerMemoryTool();
    }
  }
}
