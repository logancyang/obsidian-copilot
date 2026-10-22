import { getCachedProjectRecordById } from "@/projects/state";
import { getMatchingPatterns, shouldIndexFile, type PatternCategory } from "@/search/searchUtils";
import { App, FileSystemAdapter, TFile, TFolder } from "obsidian";

export const MAX_MANIFEST_ENTRIES = 100;

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "epub",
  "rtf",
  "xls",
  "xlsx",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "tiff",
  "webp",
]);

export interface ManifestPathEntry {
  vaultPath: string;
  absPath?: string;
}

export interface ManifestSources {
  folders: ManifestPathEntry[];
  notes: ManifestPathEntry[];
  extensions: string[];
  tags: string[];
  properties: string[];
  propertyNotes: ManifestPathEntry[];
  documents: ManifestPathEntry[];
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
export const PROJECT_WORKSPACE_POLICY = `The working directory is this project's workspace. Write generated files, drafts and intermediates to outputs/ there (create it as needed), unless the user specifies another destination. Read/search there and in configured context sources, including external sources. Access other locations only when instructions or the user name them.`;

const UNAVAILABLE_PROJECT_CONTEXT_BLOCK = [
  "<project_context>",
  PROJECT_WORKSPACE_POLICY,
  "This project's context sources could not be loaded.",
  "</project_context>",
].join("\n");

const EMPTY_PROJECT_CONTEXT_BLOCK = [
  "<project_context>",
  PROJECT_WORKSPACE_POLICY,
  "No context sources are configured for this project.",
  "</project_context>",
].join("\n");

export function buildProjectContext(app: App, projectId: string): string {
  const record = getCachedProjectRecordById(projectId);
  if (!record) return UNAVAILABLE_PROJECT_CONTEXT_BLOCK;
  const contextSource = record.project.contextSource;
  if (!contextSource) return EMPTY_PROJECT_CONTEXT_BLOCK;

  const webUrls = splitLines(contextSource.webUrls);
  const youtubeUrls = splitLines(contextSource.youtubeUrls);
  const { inclusions, exclusions } = readProjectPatterns(contextSource);
  const folders = inclusions?.folderPatterns ?? [];
  const notes = inclusions?.notePatterns ?? [];
  const extensions = inclusions?.extensionPatterns ?? [];
  const tags = inclusions?.tagPatterns ?? [];
  const properties = inclusions?.propertyPatterns ?? [];

  const hasAnySource =
    webUrls.length > 0 ||
    youtubeUrls.length > 0 ||
    folders.length > 0 ||
    notes.length > 0 ||
    extensions.length > 0 ||
    tags.length > 0 ||
    properties.length > 0;
  if (!hasAnySource) return EMPTY_PROJECT_CONTEXT_BLOCK;

  const adapter = vaultAdapter(app);
  const noteEntries = resolveNotePaths(app, notes, adapter);
  const declaredNotePaths = new Set(noteEntries.map(manifestEntryKey));
  const propertyNoteEntries = resolvePropertyNotePaths(app, properties, exclusions, adapter).filter(
    (entry) => !declaredNotePaths.has(manifestEntryKey(entry))
  );

  // A document picked in the Files picker is already listed under Included notes, and a duplicate would spend the manifest cap. https://github.com/Brevilabs/obsidian-copilot-private/issues/657
  const documentEntries = resolveDocumentPaths(app, inclusions, exclusions, adapter).filter(
    (entry) => !declaredNotePaths.has(manifestEntryKey(entry))
  );

  return buildProjectContextBlock({
    folders: resolveFolderPaths(app, folders, adapter),
    notes: noteEntries,
    extensions,
    tags,
    properties,
    propertyNotes: propertyNoteEntries,
    documents: documentEntries,
    webUrls,
    youtubeUrls,
  });
}

export function buildProjectContextBlock(sources: ManifestSources): string {
  const pathText = (entry: ManifestPathEntry): string => `\`${entry.absPath ?? entry.vaultPath}\``;

  const declared: ManifestLine[] = [
    ...sources.folders.map((e) => line("Included folders", pathText(e))),
    ...sources.properties.map((p) => line("Included properties", p)),
    ...sources.notes.map((e) => line("Included notes", pathText(e))),
    ...sources.extensions.map((p) => line("Included file types", `\`${p}\``)),
    ...sources.tags.map((t) => line("Included tags", t)),
    ...sources.webUrls.map((u) => line("Included URLs", u)),
    ...sources.youtubeUrls.map((u) => line("Included YouTube", u)),
  ];
  const expanded: ManifestLine[] = [
    ...sources.documents.map((e) => line("Document files", pathText(e))),
    ...sources.propertyNotes.map((e) => line("Notes matching an included property", pathText(e))),
  ];
  const lines: ManifestLine[] = [...declared, ...expanded];

  const total = lines.length;
  const shown = lines.slice(0, MAX_MANIFEST_ENTRIES);
  const omitted = total - shown.length;

  const out: string[] = [
    "<project_context>",
    PROJECT_WORKSPACE_POLICY,
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

  if (omitted > 0) {
    out.push("", `> ${omitted} more sources are not listed; search the sources above for them.`);
  }
  out.push("</project_context>");
  return out.join("\n");
}

function line(section: string, text: string): ManifestLine {
  return { section, text };
}

function readProjectPatterns(contextSource: { inclusions?: string; exclusions?: string }): {
  inclusions: PatternCategory | null;
  exclusions: PatternCategory | null;
} {
  return getMatchingPatterns({
    inclusions: contextSource.inclusions,
    exclusions: contextSource.exclusions,
    isProject: true,
  });
}

function vaultAdapter(app: App): FileSystemAdapter | null {
  return app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter : null;
}

function manifestEntryKey(entry: ManifestPathEntry): string {
  return entry.absPath ?? entry.vaultPath;
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

function resolvePropertyNotePaths(
  app: App,
  propertyPatterns: string[],
  exclusions: PatternCategory | null,
  adapter: FileSystemAdapter | null
): ManifestPathEntry[] {
  if (propertyPatterns.length === 0) return EMPTY_MANIFEST_ENTRIES;
  const inclusions: PatternCategory = { propertyPatterns };
  return app.vault
    .getMarkdownFiles()
    .filter((file) => shouldIndexFile(app, file, inclusions, exclusions, true))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => toManifestEntry(file, adapter));
}

function resolveDocumentPaths(
  app: App,
  inclusions: PatternCategory | null,
  exclusions: PatternCategory | null,
  adapter: FileSystemAdapter | null
): ManifestPathEntry[] {
  if (!inclusions) return EMPTY_MANIFEST_ENTRIES;
  return app.vault
    .getFiles()
    .filter((file) => DOCUMENT_EXTENSIONS.has(file.extension.toLowerCase()))
    .filter((file) => shouldIndexFile(app, file, inclusions, exclusions, true))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => toManifestEntry(file, adapter));
}

function toManifestEntry(file: TFile, adapter: FileSystemAdapter | null): ManifestPathEntry {
  return adapter
    ? { vaultPath: file.path, absPath: adapter.getFullPath(file.path) }
    : { vaultPath: file.path };
}

function splitLines(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
