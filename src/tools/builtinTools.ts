import { getSettings } from "@/settings/model";
import { Vault } from "obsidian";
import { isDesktopRuntime } from "@/services/obsidianCli/ObsidianCliClient";
import { replaceInFileTool, writeToFileTool } from "./ComposerTools";
import { createGetFileTreeTool } from "./FileTreeTools";
import { updateMemoryTool } from "./memoryTools";
import { readNoteTool } from "./NoteTools";
import { obsidianRandomReadTool } from "./ObsidianCliDailyTools";
import {
  obsidianBasesTool,
  obsidianDailyNoteTool,
  obsidianLinksTool,
  obsidianPropertiesTool,
  obsidianTasksTool,
  obsidianTemplatesTool,
} from "./ObsidianCliTools";
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

For broad searches:
- If the user wants a comprehensive list, use getFileTree to get all note titles as reference. This helps verify search completeness and identify notes the search may have missed.`,
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
 * Register desktop-only Obsidian CLI tools.
 * These tools are completely invisible on mobile — not registered, not shown in any UI.
 */
export function registerCliTools(): void {
  const registry = ToolRegistry.getInstance();

  registry.register({
    tool: obsidianDailyNoteTool,
    metadata: {
      id: "obsidianDailyNote",
      displayName: "Daily Note",
      description: "Read, append, or prepend to today's daily note, or get its path",
      category: "cli",
      requiresVault: true,
      customPromptInstructions: `For obsidianDailyNote:
- Use for all daily note operations: reading content, appending text, prepending text, or getting the file path.
- Use readNote for reading specific notes by path. Use obsidianDailyNote only for today's daily note.
- daily:read — read today's daily note content.
- daily:append — append text to the end. Requires content parameter. Use inline=true to append without a newline.
- daily:prepend — prepend text to the beginning. Requires content parameter. Use inline=true to prepend without a newline.
- daily:path — get the vault-relative file path (useful for follow-up readNote calls).
- daily:append and daily:prepend auto-create the daily note if it doesn't exist.
- Use \\n for newlines and \\t for tabs in content strings.
- Template workflow: use obsidianTemplates 'templates' to list templates, then 'template:read' to get resolved content (variables like {{date}} expanded), then daily:prepend to populate.
- For arbitrary file writes beyond daily notes, use writeToFile or replaceInFile instead.
- If the user names a specific vault, pass it using the vault parameter.`,
    },
  });

  registry.register({
    tool: obsidianRandomReadTool,
    metadata: {
      id: "obsidianRandomRead",
      displayName: "Random Note",
      description: "Read a random note using the official Obsidian CLI",
      category: "cli",
      requiresVault: true,
      customPromptInstructions: `For obsidianRandomRead:
- Use when the user explicitly asks for a random note or random note content.
- If the user names a specific vault, pass it using the vault parameter.
- Do not use when the user asks for a specific note; use readNote/getFileTree for specific targets.`,
    },
  });

  registry.register({
    tool: obsidianPropertiesTool,
    metadata: {
      id: "obsidianProperties",
      displayName: "Properties",
      description: "Read frontmatter properties from notes or list all property names in the vault",
      category: "cli",
      requiresVault: true,
      customPromptInstructions: `For obsidianProperties:
- Use to inspect frontmatter properties across the vault or within a specific note.
- properties (no file/path): list all property names used vault-wide. Add counts=true for occurrence counts. Add sort=count to sort by frequency.
- properties with file= or path=: list that note's key-value property pairs.
- property:read: read a single property value from a specific note. Requires name parameter.
- file= resolves like a wikilink (name only, no path or extension). path= uses exact vault-relative path.
- Do not use for full note content — use readNote for that.
- To modify properties, use writeToFile or replaceInFile to update the frontmatter YAML.`,
    },
  });

  registry.register({
    tool: obsidianTasksTool,
    metadata: {
      id: "obsidianTasks",
      displayName: "Tasks",
      description: "List tasks across the vault with filters for status, file, and daily note",
      category: "cli",
      requiresVault: true,
      customPromptInstructions: `For obsidianTasks:
- Use to list and filter tasks across the vault.
- todo=true: show only incomplete tasks. done=true: show only completed tasks.
- status="x": filter by specific status character (e.g., "/" for in-progress, "x" for done, " " for open).
- daily=true: show tasks from today's daily note only.
- verbose=true: group tasks by file with line numbers.
- total=true: return only the task count.
- file= resolves like a wikilink (name only). path= uses exact vault-relative path.`,
    },
  });

  registry.register({
    tool: obsidianLinksTool,
    metadata: {
      id: "obsidianLinks",
      displayName: "Links",
      description: "Query the vault link graph: backlinks, outgoing links, orphans, unresolved",
      category: "cli",
      requiresVault: true,
      customPromptInstructions: `For obsidianLinks:
- Use to explore the vault's link graph.
- backlinks: list notes that link TO a given file. Use file= or path= to target a note. Add counts=true for link counts.
- links: list outgoing links FROM a given file. Use file= or path= to target a note.
- orphans: list all notes with no incoming links. Use total=true for just the count. Add all=true to include non-markdown files.
- unresolved: list wikilinks that don't resolve to any existing file. Use counts=true for occurrence counts, verbose=true to see source files.
- file= resolves like a wikilink (name only). path= uses exact vault-relative path. Without either, targets the active file.`,
    },
  });

  registry.register({
    tool: obsidianTemplatesTool,
    metadata: {
      id: "obsidianTemplates",
      displayName: "Templates",
      description: "List available templates or read template content",
      category: "cli",
      requiresVault: true,
      customPromptInstructions: `For obsidianTemplates:
- Use 'templates' to list all available templates when you need to find the right template for a task.
- Use 'template:read' with a template name to get its content with variables resolved. Requires name parameter.
- This is useful for creating daily notes from templates — read the template first, then use obsidianDailyNote's daily:prepend to populate the note.`,
    },
  });

  registry.register({
    tool: obsidianBasesTool,
    metadata: {
      id: "obsidianBases",
      displayName: "Bases",
      description: "List Base files, views, query data, or create new items in Obsidian Bases",
      category: "cli",
      requiresVault: true,
      customPromptInstructions: `For obsidianBases:
- Use to explore and manage structured data in Obsidian Base (.base) database files.
- bases: list all Base files in the vault. Use total=true for just the count.
- base:views: list the views defined in a Base file. Requires file= or path=.
- base:query: query data from a specific Base view. Requires file= or path=, optionally view= and format= (e.g., format=csv).
- base:create: create a new item (row) in a Base. Requires file= or path=. Optional: view= (target view), name= (file name for the item), content= (initial note content).
  - The created item appears as a new note that matches the Base's filter criteria.
  - Use base:query first to understand the Base's structure and existing data before creating items.
  - If the Base filters by a specific tag or folder, ensure the new item will match those filters.

Base file YAML reference (for creating new .base files with writeToFile):
- filters: nested and/or/not objects or single filter strings. Use file.hasTag("tag"), file.inFolder("folder"), and operators (==, !=, >, <, >=, <=). Example: filters: { and: ['file.hasTag("project")', 'status != "done"'] }
- formulas: computed properties. Functions: date(), now(), today(), if(cond, true, false), duration(). Duration fields: .days, .hours, .minutes. Example: days_left: 'if(due, (date(due) - today()).days, "")'
- properties: display config per property (displayName, width, hidden).
- views: table (default), cards, list, or map. Each view can have its own filters, order (property display list), groupBy, summaries.
- Property types: note properties (from frontmatter), file properties (file.name, file.mtime, file.ctime, file.tags, file.links, file.backlinks), formula properties (formula.my_formula).
- YAML quoting: single-quote formulas containing double quotes: 'if(done, "Yes", "No")'. Quote strings with special chars (:, {, }, [, ]).
- Embed in notes with ![[MyBase.base]] or ![[MyBase.base#View Name]].`,
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

    // Register desktop-only CLI tools (invisible on mobile)
    if (isDesktopRuntime()) {
      registerCliTools();
    }
  }
}
