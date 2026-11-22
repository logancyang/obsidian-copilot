import { getProjectLinkPatterns } from "@/projects/projectLinks";
import { getCachedProjectRecordById } from "@/projects/state";
import { App, FileSystemAdapter, TFolder } from "obsidian";

export const MAX_MANIFEST_ENTRIES = 100;

export interface ManifestPathEntry {
  vaultPath: string;
  absPath?: string;
}

export interface ManifestSources {
  folders: ManifestPathEntry[];
  notes: ManifestPathEntry[];
  tags: string[];
  properties: string[];
  webUrls: string[];
  youtubeUrls: string[];
}

interface ManifestLine {
  section: string;
  text: string;
}

const EMPTY_MANIFEST_ENTRIES: ManifestPathEntry[] = Object.freeze(
  [] as ManifestPathEntry[]
) as ManifestPathEntry[];

// The system prompt is shared by every chat on a backend, so this policy rides the block only project chats get.
// https://github.com/logancyang/obsidian-copilot/issues/3801
export const PROJECT_WORKSPACE_POLICY = `The working directory is this project's workspace. Write generated files, drafts and intermediates directly in it, unless the user specifies another destination. Read/search there and in configured context sources, including external sources. Access other locations only when instructions or the user name them.`;

// A tag or property can match thousands of notes, so the manifest names it and the agent resolves its notes on demand.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/838
export const LINKED_QUERY_INSTRUCTION =
  "Tags and properties are queries: find their notes with the Obsidian CLI tool (`tag name=<tag> verbose`, or `search` with `[property:value]`) when it is available, otherwise by searching note text and frontmatter.";

const UNAVAILABLE_PROJECT_CONTEXT_BLOCK = [
  "<project_context>",
  PROJECT_WORKSPACE_POLICY,
  "This project's context sources could not be loaded.",
  "</project_context>",
].join("\n");

export function buildProjectContext(app: App, projectId: string): string {
  const record = getCachedProjectRecordById(projectId);
  if (!record) return UNAVAILABLE_PROJECT_CONTEXT_BLOCK;
  const description = record.project.description;
  const contextSource = record.project.contextSource;
  if (!contextSource) return buildEmptyProjectContextBlock(description);

  const webUrls = splitLines(contextSource.webUrls);
  const youtubeUrls = splitLines(contextSource.youtubeUrls);
  const linkPatterns = getProjectLinkPatterns(record.project);
  const folders = linkPatterns?.folderPatterns ?? [];
  const notes = linkPatterns?.notePatterns ?? [];
  const tags = linkPatterns?.tagPatterns ?? [];
  const properties = linkPatterns?.propertyPatterns ?? [];

  const hasAnySource =
    webUrls.length > 0 ||
    youtubeUrls.length > 0 ||
    folders.length > 0 ||
    notes.length > 0 ||
    tags.length > 0 ||
    properties.length > 0;
  if (!hasAnySource) return buildEmptyProjectContextBlock(description);

  const adapter = vaultAdapter(app);
  return buildProjectContextBlock(
    {
      folders: resolveFolderPaths(app, folders, adapter),
      notes: resolveNotePaths(app, notes, adapter),
      tags,
      properties,
      webUrls,
      youtubeUrls,
    },
    description
  );
}

function buildEmptyProjectContextBlock(description: string | undefined): string {
  return [
    "<project_context>",
    ...projectContextPreamble(description),
    "No context sources are configured for this project.",
    "</project_context>",
  ].join("\n");
}

// The edit form asks for the project's purpose and goals, so the agent needs it to act on them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/901
function projectContextPreamble(description: string | undefined): string[] {
  if (!description) return [PROJECT_WORKSPACE_POLICY];
  return [PROJECT_WORKSPACE_POLICY, `Project description: ${description}`];
}

export function buildProjectContextBlock(sources: ManifestSources, description?: string): string {
  const pathText = (entry: ManifestPathEntry): string => `\`${entry.absPath ?? entry.vaultPath}\``;

  const lines: ManifestLine[] = [
    ...sources.folders.map((e) => line("Included folders", pathText(e))),
    ...sources.properties.map((p) => line("Included properties", p)),
    ...sources.notes.map((e) => line("Included notes", pathText(e))),
    ...sources.tags.map((t) => line("Included tags", t)),
    ...sources.webUrls.map((u) => line("Included URLs", u)),
    ...sources.youtubeUrls.map((u) => line("Included YouTube", u)),
  ];

  const total = lines.length;
  const shown = lines.slice(0, MAX_MANIFEST_ENTRIES);
  const omitted = total - shown.length;

  const out: string[] = [
    "<project_context>",
    ...projectContextPreamble(description),
    "Context sources for this project.",
  ];

  let currentSection = "";
  for (const item of shown) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      out.push("", `## ${currentSection}`);
    }
    out.push(`- ${item.text}`);
  }

  if (sources.tags.length > 0 || sources.properties.length > 0) {
    out.push("", LINKED_QUERY_INSTRUCTION);
  }
  if (omitted > 0) {
    out.push("", `> ${omitted} more sources are not listed; search the sources above for them.`);
  }
  out.push("</project_context>");
  return out.join("\n");
}

function line(section: string, text: string): ManifestLine {
  return { section, text };
}

function vaultAdapter(app: App): FileSystemAdapter | null {
  return app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter : null;
}

function resolveFolderPaths(
  app: App,
  folderPatterns: string[],
  adapter: FileSystemAdapter | null
): ManifestPathEntry[] {
  return folderPatterns.map((pattern) => {
    const vaultPath = pattern.replace(/\/+$/, "");
    const folder = app.vault.getAbstractFileByPath(vaultPath);
    return adapter && folder instanceof TFolder
      ? { vaultPath, absPath: adapter.getFullPath(folder.path) }
      : { vaultPath };
  });
}

function resolveNotePaths(
  app: App,
  notePatterns: string[],
  adapter: FileSystemAdapter | null
): ManifestPathEntry[] {
  if (notePatterns.length === 0) return EMPTY_MANIFEST_ENTRIES;
  const files = adapter ? app.vault.getFiles() : [];
  return notePatterns.flatMap((pattern) => {
    const title = pattern.slice(2, -2);
    if (!adapter) return [{ vaultPath: pattern }];
    const matches = files.filter((file) => file.basename === title);
    if (matches.length === 0) return [{ vaultPath: pattern }];
    return matches.map((file) => ({
      vaultPath: file.path,
      absPath: adapter.getFullPath(file.path),
    }));
  });
}

function splitLines(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
