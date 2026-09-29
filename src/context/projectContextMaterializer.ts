import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { err2String } from "@/errorFormat";
import { logInfo, logWarn } from "@/logger";
import { getCachedProjectRecordById } from "@/projects/state";
import { getProjectContextSignature } from "@/projects/projectContextSignature";
import { getMatchingPatterns, shouldIndexFile, type PatternCategory } from "@/search/searchUtils";
import { listMaterializeCandidates } from "@/context/materializeCandidates";
import { Mutex } from "async-mutex";
import { App, FileSystemAdapter, TFile, TFolder } from "obsidian";
import { createNodeContextCacheFs } from "./contextCacheFs";
import {
  cacheRoot,
  filesDir,
  markersDir,
  remotesDir,
  snapshotAbsPath,
} from "./conversionsLocation";
import {
  materializeSources,
  reconcileMarkers,
  type ContextConverters,
  type FileSource,
  type MaterializedSourceType,
  type MaterializeSourceIdentity,
  type RemoteSource,
  type SourceFailure,
} from "./contextCacheStore";
import { buildProjectContextBlock, type ManifestPathEntry } from "./manifestBuilder";

export interface ContextMaterializationResult {
  additionalDirectories: string[];
  projectContextBlock?: string;
  contextSignature?: string;
}

export type ContextMaterializeProgress =
  | { phase: "resolve"; resolved: number }
  | { phase: "prefetch"; done: number; total: number }
  | { phase: "parse"; done: number; total: number }
  | { phase: "itemStart"; item: MaterializeSourceIdentity }
  | { phase: "itemFailed"; item: MaterializeSourceIdentity; failure: SourceFailure }
  | { phase: "itemSettled"; item: MaterializeSourceIdentity }
  | { phase: "failures"; failures: SourceFailure[] };

export type ContextMaterializeProgressFn = (progress: ContextMaterializeProgress) => void;

const EMPTY_DIRECTORIES: string[] = Object.freeze([] as string[]) as string[];
const EMPTY_MANIFEST_ENTRIES: ManifestPathEntry[] = Object.freeze(
  [] as ManifestPathEntry[]
) as ManifestPathEntry[];

function manifestEntryKey(entry: ManifestPathEntry): string {
  return entry.absPath ?? entry.vaultPath;
}
const UNAVAILABLE_PROJECT_CONTEXT_BLOCK = [
  "<project_context>",
  "This session runs in a project workspace: the working directory is the project's",
  "folder. This project's context sources could not be loaded for this session.",
  "</project_context>",
].join("\n");

export const EMPTY_CONTEXT_MATERIALIZATION_RESULT: ContextMaterializationResult = Object.freeze({
  additionalDirectories: EMPTY_DIRECTORIES,
  projectContextBlock: UNAVAILABLE_PROJECT_CONTEXT_BLOCK,
});
const EMPTY_RESULT = EMPTY_CONTEXT_MATERIALIZATION_RESULT;

const EMPTY_PROJECT_CONTEXT_BLOCK = [
  "<project_context>",
  "This session runs in a project workspace: the working directory is the project's",
  "folder. No context sources are configured for this project.",
  "</project_context>",
].join("\n");

interface InFlightMaterialization {
  promise: Promise<ContextMaterializationResult>;
  forceRetryFailed: boolean;
  revision: string | undefined;
}

const inFlightMaterializations = new Map<string, InFlightMaterialization>();

const sourceArtifactMutexes = new Map<string, Mutex>();

function getSourceArtifactMutex(key: string): Mutex {
  let mutex = sourceArtifactMutexes.get(key);
  if (!mutex) {
    mutex = new Mutex();
    sourceArtifactMutexes.set(key, mutex);
  }
  return mutex;
}

function withSourceLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  return getSourceArtifactMutex(key).runExclusive(run);
}

function cacheRootRelativeDir(root: string, absoluteDir: string): string {
  const normRoot = toPosix(root).replace(/\/+$/, "");
  const normDir = toPosix(absoluteDir).replace(/\/+$/, "");
  if (normDir === normRoot) return "";
  const prefix = `${normRoot}/`;
  if (!normDir.startsWith(prefix)) {
    throw new Error(`context-cache directory escapes root: ${absoluteDir}`);
  }
  return normDir.slice(prefix.length);
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function ensureProjectContextMaterialized(
  app: App,
  projectId: string,
  cwd: string,
  onProgress?: ContextMaterializeProgressFn,
  forceRetryFailed?: boolean,
  revisionKey?: string
): Promise<ContextMaterializationResult> {
  const force = forceRetryFailed ?? false;
  const record = getCachedProjectRecordById(projectId);
  const currentSignature = record ? getProjectContextSignature(record) : undefined;
  const currentRevision = revisionKey ?? currentSignature;
  const existing = inFlightMaterializations.get(projectId);
  if (existing && existing.revision === currentRevision && (!force || existing.forceRetryFailed)) {
    return existing.promise;
  }

  const prior = existing?.promise;
  const promise = (async () => {
    if (prior) await prior.catch(() => undefined);
    return runMaterialize(app, projectId, cwd, onProgress, force);
  })().finally(() => {
    if (inFlightMaterializations.get(projectId)?.promise === promise) {
      inFlightMaterializations.delete(projectId);
    }
  });
  inFlightMaterializations.set(projectId, {
    promise,
    forceRetryFailed: force,
    revision: currentRevision,
  });
  return promise;
}

async function runMaterialize(
  app: App,
  projectId: string,
  cwd: string,
  onProgress?: ContextMaterializeProgressFn,
  forceRetryFailed?: boolean
): Promise<ContextMaterializationResult> {
  try {
    const record = getCachedProjectRecordById(projectId);
    if (!record) return EMPTY_RESULT;
    const contextSignature = getProjectContextSignature(record);
    const contextSource = record.project.contextSource;
    if (!contextSource) {
      return {
        additionalDirectories: EMPTY_DIRECTORIES,
        projectContextBlock: EMPTY_PROJECT_CONTEXT_BLOCK,
        contextSignature,
      };
    }

    const webUrls = splitLines(contextSource.webUrls);
    const youtubeUrls = splitLines(contextSource.youtubeUrls);
    const remotes: RemoteSource[] = [
      ...webUrls.map((url): RemoteSource => ({ type: "web", url })),
      ...youtubeUrls.map((url): RemoteSource => ({ type: "youtube", url })),
    ];

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

    const adapter = getVaultFileSystemAdapter(app);
    const { entries: folderEntries, additionalDirectories } = resolveFolderPaths(
      app,
      folders,
      cwd,
      adapter
    );
    const noteEntries = resolveNotePaths(app, notes, adapter);
    const declaredNotePaths = new Set(noteEntries.map(manifestEntryKey));
    const propertyNoteEntries = resolvePropertyNotePaths(
      app,
      properties,
      exclusions,
      adapter
    ).filter((entry) => !declaredNotePaths.has(manifestEntryKey(entry)));

    const files: FileSource[] = inclusions
      ? listMaterializeCandidates(app, contextSource).map((file) => ({
          vaultPath: file.path,
          ext: file.extension.toLowerCase(),
          mtime: file.stat.mtime,
          size: file.stat.size,
          read: () => app.vault.readBinary(file),
        }))
      : [];

    const hasAnySource =
      remotes.length > 0 ||
      files.length > 0 ||
      folders.length > 0 ||
      notes.length > 0 ||
      extensions.length > 0 ||
      tags.length > 0 ||
      properties.length > 0 ||
      additionalDirectories.length > 0;
    if (!hasAnySource) {
      return {
        additionalDirectories: EMPTY_DIRECTORIES,
        projectContextBlock: EMPTY_PROJECT_CONTEXT_BLOCK,
        contextSignature,
      };
    }

    onProgress?.({ phase: "resolve", resolved: files.length });

    const root = cacheRoot(app);
    const fs = createNodeContextCacheFs(root);
    const remotesRel = cacheRootRelativeDir(root, remotesDir(app));
    const filesRel = cacheRootRelativeDir(root, filesDir(app));
    const markersRel = cacheRootRelativeDir(root, markersDir(app, projectId));

    const { entries, wantedMarkerNames, failures } = await materializeSources({
      remotesDir: remotesRel,
      filesDir: filesRel,
      markerDir: markersRel,
      fs,
      converters: createConverters(),
      remotes,
      files,
      nowMs: Date.now(),
      forceRetryFailed,
      onProgress,
      withSourceLock,
    });

    onProgress?.({ phase: "failures", failures });

    const manifestEntries = entries.map((entry) => ({
      ...entry,
      snapshotAbsPath: snapshotAbsPath(app, entry.type, entry.cacheFileName),
    }));

    const projectContextBlock = buildProjectContextBlock({
      folders: folderEntries,
      notes: noteEntries,
      extensions,
      tags,
      properties,
      propertyNotes: propertyNoteEntries,
      webUrls,
      youtubeUrls,
      materialized: manifestEntries,
    });
    await reconcileMarkers(fs, markersRel, wantedMarkerNames);

    logInfo(
      `[project-context] materialized ${entries.length} source(s) for ${projectId}; ` +
        `add-dir=${additionalDirectories.length}, failures=${failures.length}`
    );

    return {
      additionalDirectories:
        additionalDirectories.length > 0 ? additionalDirectories : EMPTY_DIRECTORIES,
      projectContextBlock,
      contextSignature,
    };
  } catch (err) {
    const error = err2String(err);
    logWarn(`[project-context] materialize failed for ${projectId}; continuing`, err);
    onProgress?.({
      phase: "failures",
      failures: [{ source: "Project context", kind: "file", error, usedStaleSnapshot: false }],
    });
    return EMPTY_RESULT;
  }
}

function createConverters(): ContextConverters {
  return {
    fetchRemote: async (source) => {
      const client = BrevilabsClient.getInstance();
      const content =
        source.type === "youtube"
          ? ((await client.youtube4llm(source.url)).response?.transcript ?? "")
          : ((await client.url4llm(source.url)).response ?? "");
      if (!content.trim()) throw new Error(`empty content for ${source.url}`);
      return content;
    },
    parseFile: async (bytes, ext) => {
      const { response } = await BrevilabsClient.getInstance().docs4llm(bytes, ext);
      const content = docs4llmToText(response);
      if (!content.trim()) throw new Error(`empty parse result for .${ext}`);
      return content;
    },
  };
}

export async function materializeProjectContextSource(
  app: App,
  projectId: string,
  item: { kind: MaterializedSourceType; source: string }
): Promise<SourceFailure[]> {
  const record = getCachedProjectRecordById(projectId);
  if (!record) {
    return [
      {
        source: item.source,
        kind: item.kind,
        error: "Project not found",
        usedStaleSnapshot: false,
      },
    ];
  }

  let remotes: RemoteSource[] = [];
  let files: FileSource[] = [];
  if (item.kind === "file") {
    const file = app.vault.getAbstractFileByPath(item.source);
    if (!(file instanceof TFile)) {
      return [
        {
          source: item.source,
          kind: "file",
          error: "File not found in vault",
          usedStaleSnapshot: false,
        },
      ];
    }
    files = [
      {
        vaultPath: file.path,
        ext: file.extension.toLowerCase(),
        mtime: file.stat.mtime,
        size: file.stat.size,
        read: () => app.vault.readBinary(file),
      },
    ];
  } else {
    remotes = [{ type: item.kind, url: item.source }];
  }

  try {
    const root = cacheRoot(app);
    const fs = createNodeContextCacheFs(root);
    const { failures } = await materializeSources({
      remotesDir: cacheRootRelativeDir(root, remotesDir(app)),
      filesDir: cacheRootRelativeDir(root, filesDir(app)),
      markerDir: cacheRootRelativeDir(root, markersDir(app, projectId)),
      fs,
      converters: createConverters(),
      remotes,
      files,
      nowMs: Date.now(),
      forceRetryFailed: true,
      withSourceLock,
    });
    return failures;
  } catch (err) {
    return [
      { source: item.source, kind: item.kind, error: err2String(err), usedStaleSnapshot: false },
    ];
  }
}

function docs4llmToText(response: unknown): string {
  if (typeof response === "string") return response;
  try {
    return JSON.stringify(response, null, 2);
  } catch (err) {
    logWarn(`[project-context] could not stringify docs4llm response: ${err2String(err)}`);
    return "";
  }
}

function getVaultFileSystemAdapter(app: App): FileSystemAdapter | null {
  const adapter = app.vault.adapter;
  return adapter instanceof FileSystemAdapter ? adapter : null;
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
  if (notePatterns.length === 0) return [];
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
    .map((file) =>
      adapter
        ? { vaultPath: file.path, absPath: adapter.getFullPath(file.path) }
        : { vaultPath: file.path }
    );
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
