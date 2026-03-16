import { z } from "zod";
import { runObsidianCliCommand } from "@/services/obsidianCli/ObsidianCliClient";
import { throwCliFailure } from "@/services/obsidianCli/cliErrors";
import { createLangChainTool } from "./createLangChainTool";

/**
 * Build CLI params from a tool args object, excluding `command` and `vault`.
 * Filters out undefined values so only explicitly provided params are sent.
 */
function buildCliParams(args: Record<string, unknown>): Record<string, string | boolean> {
  return Object.fromEntries(
    Object.entries(args).filter(([k, v]) => k !== "command" && k !== "vault" && v !== undefined)
  ) as Record<string, string | boolean>;
}

// ---------------------------------------------------------------------------
// obsidianDailyNote — daily note category tool (v1)
// ---------------------------------------------------------------------------

const dailyNoteSchema = z.object({
  command: z
    .enum(["daily", "daily:read", "daily:path"])
    .describe(
      "daily — create today's daily note (applies configured template). daily:read — read today's daily note content. daily:path — get the vault-relative file path."
    ),
  vault: z
    .string()
    .optional()
    .describe("Optional vault name to target. Omit to use the active vault."),
});

/**
 * Category tool for all daily note operations via the official Obsidian CLI.
 * Supports reading, appending, prepending, and path resolution.
 */
export const obsidianDailyNoteTool = createLangChainTool({
  name: "obsidianDailyNote",
  description:
    "Create or read today's daily note, or get its vault path, via the official Obsidian CLI. Use readNote for reading specific notes by path. Use obsidianRandomRead for picking a random note.",
  schema: dailyNoteSchema,
  func: async (args) => {
    const { command, vault } = args;

    const params = buildCliParams(args as Record<string, unknown>);
    const result = await runObsidianCliCommand({ command, vault, params });

    if (!result.ok) throwCliFailure(result);

    // Preserve raw stdout for read commands — trimming may alter meaningful Markdown whitespace.
    const content = command === "daily:read" ? result.stdout : result.stdout.trim();

    return {
      type: "obsidian_cli_daily_note",
      command: result.command,
      vault: vault ?? null,
      content,
      durationMs: result.durationMs,
    };
  },
});

// ---------------------------------------------------------------------------
// obsidianProperties — frontmatter property access (v1, read-only)
// ---------------------------------------------------------------------------

const propertiesSchema = z.object({
  command: z
    .enum(["properties", "property:read"])
    .describe(
      "properties — list property names vault-wide or key-value pairs for a specific note. property:read — read a single property value from a note."
    ),
  name: z
    .string()
    .optional()
    .describe(
      "For property:read: the property name to read (required). For properties vault-wide: filter to this property name."
    ),
  file: z.string().optional().describe("Target file by name (without extension)."),
  path: z.string().optional().describe("Target file by vault-relative path."),
  counts: z
    .boolean()
    .optional()
    .describe("Include occurrence counts alongside property names (vault-wide mode)."),
  sort: z
    .string()
    .optional()
    .describe("Sort order for vault-wide listing. Use 'count' to sort by occurrence count."),
  total: z.boolean().optional().describe("Return only the total property count."),
  vault: z
    .string()
    .optional()
    .describe("Optional vault name to target. Omit to use the active vault."),
});

/**
 * Tool for reading frontmatter properties via the official Obsidian CLI.
 * Supports vault-wide property listing and per-note property lookup.
 */
export const obsidianPropertiesTool = createLangChainTool({
  name: "obsidianProperties",
  description:
    "Read frontmatter properties from your vault via the official Obsidian CLI: list all property names used vault-wide, or read specific property values from a note.",
  schema: propertiesSchema,
  func: async (args) => {
    const { command, vault } = args;
    if (command === "property:read" && !args.name) {
      throw new Error("name is required for property:read");
    }

    const params = buildCliParams(args as Record<string, unknown>);
    const result = await runObsidianCliCommand({ command, vault, params });

    if (!result.ok) throwCliFailure(result);

    return {
      type: "obsidian_cli_properties",
      command: result.command,
      vault: vault ?? null,
      content: result.stdout.trim(),
      durationMs: result.durationMs,
    };
  },
});

// ---------------------------------------------------------------------------
// obsidianTasks — task listing across vault (v1, read-only)
// ---------------------------------------------------------------------------

const tasksSchema = z.object({
  command: z
    .literal("tasks")
    .describe('Must be exactly "tasks". Lists tasks across the vault with optional filters.'),
  file: z.string().optional().describe("Filter tasks by file name."),
  path: z.string().optional().describe("Filter tasks by vault-relative file path."),
  todo: z.boolean().optional().describe("Show only incomplete (todo) tasks."),
  done: z.boolean().optional().describe("Show only completed tasks."),
  status: z
    .string()
    .optional()
    .describe("Filter by a specific status character (e.g. '/' for in-progress)."),
  daily: z.boolean().optional().describe("Show tasks from today's daily note only."),
  verbose: z.boolean().optional().describe("Group tasks by file with line numbers."),
  total: z.boolean().optional().describe("Return only the total task count."),
  vault: z
    .string()
    .optional()
    .describe("Optional vault name to target. Omit to use the active vault."),
});

/**
 * Tool for listing tasks across the vault via the official Obsidian CLI.
 * Supports filtering by completion status, file, daily note, and more.
 */
export const obsidianTasksTool = createLangChainTool({
  name: "obsidianTasks",
  description:
    "List tasks across your vault via the official Obsidian CLI with filters for completion status, file, daily note, and more.",
  schema: tasksSchema,
  func: async (args) => {
    const { command, vault } = args;
    const params = buildCliParams(args as Record<string, unknown>);
    const result = await runObsidianCliCommand({ command, vault, params });

    if (!result.ok) throwCliFailure(result);

    return {
      type: "obsidian_cli_tasks",
      command: result.command,
      vault: vault ?? null,
      content: result.stdout.trim(),
      durationMs: result.durationMs,
    };
  },
});

// ---------------------------------------------------------------------------
// obsidianLinks — link graph queries (v1, read-only)
// ---------------------------------------------------------------------------

const linksSchema = z.object({
  command: z
    .enum(["backlinks", "links", "orphans", "unresolved"])
    .describe(
      "backlinks — list notes that link TO a given file. links — list outgoing links FROM a file. orphans — list files with no incoming links. unresolved — list wikilinks that don't resolve to any file."
    ),
  file: z.string().optional().describe("Target file by name (for backlinks and links commands)."),
  path: z
    .string()
    .optional()
    .describe("Target file by vault-relative path (for backlinks and links commands)."),
  counts: z
    .boolean()
    .optional()
    .describe("Include link counts per source file (for backlinks and unresolved)."),
  verbose: z.boolean().optional().describe("Include source file for each entry (for unresolved)."),
  total: z.boolean().optional().describe("Return only the count."),
  all: z
    .boolean()
    .optional()
    .describe("Include non-markdown files such as images and PDFs (for orphans)."),
  vault: z
    .string()
    .optional()
    .describe("Optional vault name to target. Omit to use the active vault."),
});

/**
 * Tool for querying the vault link graph via the official Obsidian CLI.
 * Supports backlinks, outgoing links, orphaned notes, and unresolved wikilinks.
 */
export const obsidianLinksTool = createLangChainTool({
  name: "obsidianLinks",
  description:
    "Query the vault link graph via the official Obsidian CLI: list backlinks to a file, outgoing links from a file, orphaned notes with no incoming links, or unresolved wikilinks.",
  schema: linksSchema,
  func: async (args) => {
    const { command, vault } = args;
    const params = buildCliParams(args as Record<string, unknown>);
    const result = await runObsidianCliCommand({ command, vault, params });

    if (!result.ok) throwCliFailure(result);

    return {
      type: "obsidian_cli_links",
      command: result.command,
      vault: vault ?? null,
      content: result.stdout.trim(),
      durationMs: result.durationMs,
    };
  },
});

// ---------------------------------------------------------------------------
// obsidianTemplates — template listing and reading (v1, read-only)
// ---------------------------------------------------------------------------

const templatesSchema = z.object({
  command: z
    .enum(["templates", "template:read"])
    .describe(
      "templates — list all available template names. template:read — read a template's content with variable resolution."
    ),
  name: z.string().optional().describe("Template name to read. Required for template:read."),
  vault: z
    .string()
    .optional()
    .describe("Optional vault name to target. Omit to use the active vault."),
});

/**
 * Tool for listing and reading templates via the official Obsidian CLI.
 * Supports listing available templates and reading template content.
 */
export const obsidianTemplatesTool = createLangChainTool({
  name: "obsidianTemplates",
  description:
    "List available templates or read template content via the official Obsidian CLI. Use before creating notes to find the right template.",
  schema: templatesSchema,
  func: async (args) => {
    const { command, vault } = args;
    if (command === "template:read" && !args.name) {
      throw new Error("name is required for template:read");
    }

    const params = buildCliParams(args as Record<string, unknown>);
    const result = await runObsidianCliCommand({ command, vault, params });

    if (!result.ok) throwCliFailure(result);

    return {
      type: "obsidian_cli_templates",
      command: result.command,
      vault: vault ?? null,
      content: result.stdout.trim(),
      durationMs: result.durationMs,
    };
  },
});

// ---------------------------------------------------------------------------
// obsidianBases — Base database queries (read-only)
// ---------------------------------------------------------------------------

const basesSchema = z.object({
  command: z
    .enum(["bases", "base:views", "base:query", "base:create"])
    .describe(
      "bases — list all Base files in the vault. base:views — list views defined in a Base file. base:query — query data from a Base view. base:create — create a new item (row) in a Base."
    ),
  file: z
    .string()
    .optional()
    .describe(
      "Target Base file by name (without extension). Used for base:views, base:query, and base:create."
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Target Base file by vault-relative path. Alternative to file= for base:views, base:query, and base:create."
    ),
  view: z
    .string()
    .optional()
    .describe("View name. For base:query: view to query. For base:create: view to add item to."),
  name: z.string().optional().describe("New file name for the created item. For base:create only."),
  content: z
    .string()
    .optional()
    .describe("Initial content for the created item. For base:create only."),
  format: z
    .string()
    .optional()
    .describe("Output format for base:query (e.g., 'csv'). Omit for default text output."),
  total: z.boolean().optional().describe("Return only the count."),
  vault: z
    .string()
    .optional()
    .describe("Optional vault name to target. Omit to use the active vault."),
});

/**
 * Commands that require a target Base file (file or path parameter).
 */
const BASE_COMMANDS_REQUIRING_FILE = ["base:views", "base:query", "base:create"] as const;

/**
 * Tool for interacting with Obsidian Base (database) files via the official Obsidian CLI.
 * Supports listing bases, listing views, querying data from views, and creating new items.
 */
export const obsidianBasesTool = createLangChainTool({
  name: "obsidianBases",
  description:
    "Interact with Obsidian Base (database) files via the official Obsidian CLI: list all bases, list views in a base, query data from a base view, or create a new item in a base.",
  schema: basesSchema,
  func: async (args) => {
    const { command, vault } = args;
    if (
      (BASE_COMMANDS_REQUIRING_FILE as readonly string[]).includes(command) &&
      !args.file &&
      !args.path
    ) {
      throw new Error(`file or path is required for ${command}`);
    }

    const params = buildCliParams(args as Record<string, unknown>);
    const result = await runObsidianCliCommand({ command, vault, params });

    if (!result.ok) throwCliFailure(result);

    return {
      type: "obsidian_cli_bases",
      command: result.command,
      vault: vault ?? null,
      content: result.stdout.trim(),
      durationMs: result.durationMs,
    };
  },
});
