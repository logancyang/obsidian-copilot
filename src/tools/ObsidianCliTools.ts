import { z } from "zod";
import { runObsidianCliCommand } from "@/services/obsidianCli/ObsidianCliClient";
import { throwCliFailure } from "@/services/obsidianCli/cliErrors";
import { createLangChainTool } from "./createLangChainTool";

// ---------------------------------------------------------------------------
// obsidianDailyNote — daily note category tool (v1)
// ---------------------------------------------------------------------------

const dailyNoteSchema = z.object({
  command: z
    .enum(["daily:read", "daily:append", "daily:prepend", "daily:path"])
    .describe(
      "daily:read — read today's daily note content. daily:append — append text to the end. daily:prepend — prepend text to the beginning. daily:path — get the vault-relative file path."
    ),
  content: z
    .string()
    .optional()
    .describe("Text to append or prepend. Required for daily:append and daily:prepend."),
  inline: z
    .boolean()
    .optional()
    .describe(
      "For daily:append: append without a leading newline. For daily:prepend: prepend without a trailing newline."
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
    "Read, append, or prepend content to today's daily note, or get its vault path, via the official Obsidian CLI. Use readNote for reading specific notes by path. Use obsidianRandomRead for picking a random note.",
  schema: dailyNoteSchema,
  func: async ({ command, content, inline, vault }) => {
    if ((command === "daily:append" || command === "daily:prepend") && !content) {
      throw new Error(`content is required for ${command}`);
    }

    const params: Record<string, string | boolean> = {};
    if (content !== undefined) params.content = content;
    if (inline !== undefined) params.inline = inline;

    const result = await runObsidianCliCommand({ command, vault, params });

    if (!result.ok) throwCliFailure(result);

    return {
      type: "obsidian_cli_daily_note",
      command: result.command,
      vault: vault ?? null,
      content: result.stdout.trim(),
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
  func: async ({ command, name, file, path, counts, sort, total, vault }) => {
    if (command === "property:read" && !name) {
      throw new Error("name is required for property:read");
    }

    const params: Record<string, string | boolean> = {};
    if (name !== undefined) params.name = name;
    if (file !== undefined) params.file = file;
    if (path !== undefined) params.path = path;
    if (counts !== undefined) params.counts = counts;
    if (sort !== undefined) params.sort = sort;
    if (total !== undefined) params.total = total;

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
  command: z.literal("tasks").describe("List tasks across the vault with optional filters."),
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
  func: async ({ command, file, path, todo, done, status, daily, verbose, total, vault }) => {
    const params: Record<string, string | boolean> = {};
    if (file !== undefined) params.file = file;
    if (path !== undefined) params.path = path;
    if (todo !== undefined) params.todo = todo;
    if (done !== undefined) params.done = done;
    if (status !== undefined) params.status = status;
    if (daily !== undefined) params.daily = daily;
    if (verbose !== undefined) params.verbose = verbose;
    if (total !== undefined) params.total = total;

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
  file: z
    .string()
    .optional()
    .describe("Target file by name (for backlinks and links commands)."),
  path: z
    .string()
    .optional()
    .describe("Target file by vault-relative path (for backlinks and links commands)."),
  counts: z
    .boolean()
    .optional()
    .describe("Include link counts per source file (for backlinks and unresolved)."),
  verbose: z
    .boolean()
    .optional()
    .describe("Include source file for each entry (for unresolved)."),
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
  func: async ({ command, file, path, counts, verbose, total, all, vault }) => {
    const params: Record<string, string | boolean> = {};
    if (file !== undefined) params.file = file;
    if (path !== undefined) params.path = path;
    if (counts !== undefined) params.counts = counts;
    if (verbose !== undefined) params.verbose = verbose;
    if (total !== undefined) params.total = total;
    if (all !== undefined) params.all = all;

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
