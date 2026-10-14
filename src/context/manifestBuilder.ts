import { listProjectDocumentFiles } from "@/context/projectDocumentFiles";
import { getProjectContextSignature } from "@/projects/projectContextSignature";
import { getCachedProjectRecordById } from "@/projects/state";
import { getMatchingPatterns, shouldIndexFile, type PatternCategory } from "@/search/searchUtils";
import { App, FileSystemAdapter, TFile, TFolder } from "obsidian";

export const MAX_MANIFEST_ENTRIES = 100;

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

export interface ProjectContext {
  additionalDirectories: string[];
  projectContextBlock: string;
  contextSignature?: string;
}

interface ManifestLine {
  section: string;
  text: string;
}

const EMPTY_DIRECTORIES: string[] = Object.freeze([] as string[]) as string[];
const EMPTY_MANIFEST_ENTRIES: ManifestPathEntry[] = Object.freeze(
  [] as ManifestPathEntry[]
) as ManifestPathEntry[];

const UNAVAILABLE_PROJECT_CONTEXT: ProjectContext = Object.freeze({
  additionalDirectories: EMPTY_DIRECTORIES,
  projectContextBlock: [
    "<project_context>",
    "This session runs in a project workspace: the working directory is the project's",
    "folder. This project's context sources could not be loaded for this session.",
    "</project_context>",
  ].join("\n"),
});

const EMPTY_PROJECT_CONTEXT_BLOCK = [
  "<project_context>",
  "This session runs in a project workspace: the working directory is the project's",
  "folder. No context sources are configured for this project.",
  "</project_context>",
].join("\n");

export function buildProjectContext(app: App, projectId: string, cwd: string): ProjectContext {
  const record = getCachedProjectRecordById(projectId);
  if (!record) return UNAVAILABLE_PROJECT_CONTEXT;
  const contextSignature = getProjectContextSignature(record);
  const contextSource = record.project.contextSource;
  const emptyContext: ProjectContext = {
    additionalDirectories: EMPTY_DIRECTORIES,
    projectContextBlock: EMPTY_PROJECT_CONTEXT_BLOCK,
    contextSignature,
  };
  if (!contextSource) return emptyContext;

  const webUrls = splitLines(contextSource.webUrls);
  const youtubeUrls = splitLines(contextSource.youtubeUrls);
  const { inclusions, exclusions } = getMatchingPatterns({
    inclusions: contextSource.inclusions,
    exclusions: contextSource.exclusions,
    isProject: true,
  });
  const folders = inclusions?.folderPatterns ?? [];
  const notes = inclusions?.notePatterns ?? [];
  const extensions = inclusions?.extensionPatterns ?? [];
  const tags = inclusions?.tagPatterns ?? [];
  const properties = inclusions?.propertyPatterns ?? [];

  const adapter = app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter : null;
  const { entries: folderEntries, additionalDirectories } = resolveFolderPaths(
    app,
    folders,
    cwd,
    adapter
  );
  const noteEntries = resolveNotePaths(app, notes, adapter);
  const declaredNotePaths = new Set(noteEntries.map(manifestEntryKey));
  const propertyNoteEntries = resolvePropertyNotePaths(app, properties, exclusions, adapter).filter(
    (entry) => !declaredNotePaths.has(manifestEntryKey(entry))
  );

  // A document picked in the Files picker is already listed under Included notes, and a duplicate would spend the manifest cap. https://github.com/Brevilabs/obsidian-copilot-private/issues/657
  const documentEntries = listProjectDocumentFiles(app, contextSource)
    .map((file) => toManifestEntry(file, adapter))
    .filter((entry) => !declaredNotePaths.has(manifestEntryKey(entry)));

  const hasAnySource =
    webUrls.length > 0 ||
    youtubeUrls.length > 0 ||
    documentEntries.length > 0 ||
    folders.length > 0 ||
    notes.length > 0 ||
    extensions.length > 0 ||
    tags.length > 0 ||
    properties.length > 0;
  if (!hasAnySource) return emptyContext;

  return {
    additionalDirectories,
    projectContextBlock: buildProjectContextBlock({
      folders: folderEntries,
      notes: noteEntries,
      extensions,
      tags,
      properties,
      propertyNotes: propertyNoteEntries,
      documents: documentEntries,
      webUrls,
      youtubeUrls,
    }),
    contextSignature,
  };
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
    "Context sources for this project, with absolute paths. Folders and tags are",
    "listed as sources, not expanded into member files — use your own search",
    "(grep/glob/read) to enumerate them. Properties are listed as source labels and",
    'also expanded into the notes they match, under "Notes matching an included',
    'property" (the label is listed first so it survives the entry cap).',
    "URLs and YouTube videos are listed as links and are not fetched in advance:",
    "read one when a question needs it, with your own web fetch tool or the",
    "copilot-web-fetch or copilot-youtube-transcript skill when it is available.",
    "Document files (PDFs, Office files, EPUBs, images) are not converted: each is",
    "listed by the absolute path of the original file — open it with your own tools.",
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
    out.push(
      "",
      `> Only the first ${shown.length} of ${total} sources are listed; ${omitted} more are omitted. ` +
        `Use the declared context sources above with grep/glob/read to find the rest.`
    );
  }
  out.push("</project_context>");
  return out.join("\n");
}

function line(section: string, text: string): ManifestLine {
  return { section, text };
}

function manifestEntryKey(entry: ManifestPathEntry): string {
  return entry.absPath ?? entry.vaultPath;
}

function resolveFolderPaths(
  app: App,
  folderPatterns: string[],
  cwd: string,
  adapter: FileSystemAdapter | null
): { entries: ManifestPathEntry[]; additionalDirectories: string[] } {
  const entries: ManifestPathEntry[] = [];
  const external = new Set<string>();
  for (const pattern of folderPatterns) {
    const vaultPath = pattern.replace(/\/+$/, "");
    const folder = app.vault.getAbstractFileByPath(vaultPath);
    if (adapter && folder instanceof TFolder) {
      const abs = adapter.getFullPath(folder.path);
      entries.push({ vaultPath, absPath: abs });
      if (!isUnderCwd(cwd, abs)) external.add(abs);
    } else {
      entries.push({ vaultPath });
    }
  }
  return {
    entries,
    additionalDirectories: external.size > 0 ? [...external] : EMPTY_DIRECTORIES,
  };
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

function toManifestEntry(file: TFile, adapter: FileSystemAdapter | null): ManifestPathEntry {
  return adapter
    ? { vaultPath: file.path, absPath: adapter.getFullPath(file.path) }
    : { vaultPath: file.path };
}

function isUnderCwd(cwd: string, abs: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(cwd);
  const target = norm(abs);
  return target === base || target.startsWith(`${base}/`);
}

function splitLines(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
