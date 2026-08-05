import { COPILOT_FOLDER_ROOT } from "@/constants";
import { CustomError } from "@/error";
import { AGENTS_FILE_NAME, CLAUDE_FILE_NAME } from "@/instructions/agentsFile";
import { PROJECT_CONFIG_FILE_NAME } from "@/projects/constants";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings, normalizeRootFolders, type CopilotSettings } from "@/settings/model";
import { getEffectiveProjectsFolder } from "@/settings/copilotFolder";
import { logFileManager } from "@/logFileManager";
import { getTagsFromNote, stripHash } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { App, Platform, TFile } from "obsidian";

export interface PatternCategory {
  tagPatterns?: string[];
  extensionPatterns?: string[];
  folderPatterns?: string[];
  notePatterns?: string[];
}

export async function getVectorLength(embeddingInstance: Embeddings | undefined): Promise<number> {
  if (!embeddingInstance) {
    throw new CustomError("Embedding instance not found.");
  }
  try {
    const sampleText = "Sample text for embedding";
    const sampleEmbedding = await embeddingInstance.embedQuery(sampleText);

    if (!sampleEmbedding || sampleEmbedding.length === 0) {
      throw new CustomError("Failed to get valid embedding vector length");
    }

    logInfo(
      `Detected vector length: ${sampleEmbedding.length} for model: ${EmbeddingsManager.getModelName(embeddingInstance)}`
    );
    return sampleEmbedding.length;
  } catch (error) {
    logError("Error getting vector length:", error);
    throw new CustomError(
      "Failed to determine embedding vector length. Please check your Copilot settings to make sure you have a working embedding model."
    );
  }
}

export async function getAllQAMarkdownContent(app: App): Promise<string> {
  let allContent = "";

  const { inclusions, exclusions } = getMatchingPatterns();

  const filteredFiles = app.vault.getMarkdownFiles().filter((file) => {
    return shouldIndexFile(app, file, inclusions, exclusions);
  });

  await Promise.all(filteredFiles.map((file) => app.vault.cachedRead(file))).then((contents) =>
    contents.map((c) => (allContent += c + " "))
  );

  return allContent;
}

/**
 * Get the decoded patterns from the settings string.
 * @param value - The settings string.
 * @returns An array of decoded patterns.
 */
export function getDecodedPatterns(value: string): string[] {
  const patterns: string[] = [];
  patterns.push(
    ...value
      .split(",")
      .map((item) => {
        const trimmed = item.trim();
        try {
          return decodeURIComponent(trimmed);
        } catch {
          // Return original value if decodeURIComponent fails (e.g., invalid % sequence)
          return trimmed;
        }
      })
      .filter((item) => item.length > 0)
  );

  return patterns;
}

/**
 * Get the exclusion patterns from the exclusion settings string.
 * @returns An array of exclusion patterns.
 */
function getExclusionPatterns(): string[] {
  if (!getSettings().qaExclusions) {
    return [];
  }

  return getDecodedPatterns(getSettings().qaExclusions);
}

/**
 * Get the inclusion patterns from the inclusion settings string.
 * @returns An array of inclusion patterns.
 */
function getInclusionPatterns(): string[] {
  if (!getSettings().qaInclusions) {
    return [];
  }

  return getDecodedPatterns(getSettings().qaInclusions);
}

/**
 * Get the inclusion and exclusion patterns from the settings or provided values.
 * NOTE: isProject is used to determine if the patterns should be used for a project, ignoring global inclusions and exclusions
 * @param options - Optional parameters for inclusions and exclusions.
 * @returns An object containing the inclusions and exclusions patterns strings.
 */
export function getMatchingPatterns(options?: {
  inclusions?: string;
  exclusions?: string;
  isProject?: boolean;
}): {
  inclusions: PatternCategory | null;
  exclusions: PatternCategory | null;
} {
  // For projects, don't fall back to global patterns
  const inclusionPatterns = options?.inclusions
    ? getDecodedPatterns(options.inclusions)
    : options?.isProject
      ? []
      : getInclusionPatterns();

  const exclusionPatterns = options?.exclusions
    ? getDecodedPatterns(options.exclusions)
    : options?.isProject
      ? []
      : getExclusionPatterns();

  return {
    inclusions: inclusionPatterns.length > 0 ? categorizePatterns(inclusionPatterns) : null,
    exclusions: exclusionPatterns.length > 0 ? categorizePatterns(exclusionPatterns) : null,
  };
}

/**
 * The Copilot root folders excluded from QA indexing independent of the user's
 * patterns: `copilot`, the active root, and every root ever activated
 * ({@link CopilotSettings.copilotRootHistory}). Always-on privacy invariant so
 * content under any current OR former root never enters the index.
 *
 * @param settings - Current Copilot settings.
 * @returns Normalized, deduped root folders to exclude (never empty).
 */
export function getSystemExcludedFolders(settings: CopilotSettings): string[] {
  const history = Array.isArray(settings.copilotRootHistory) ? settings.copilotRootHistory : [];
  return normalizeRootFolders([COPILOT_FOLDER_ROOT, settings.copilotFolder, ...history]);
}

/**
 * Whether a vault-relative path falls under any live system-excluded Copilot root.
 *
 * Case-folded on case-insensitive filesystems, unlike the user's own qa*
 * patterns. A stored root keeps whatever spelling it was configured with —
 * nothing reconciles it against the real path, and an external sync, an OS-level
 * case-only rename, or simply typing `TeamAI` when the disk holds `teamai/` is
 * enough to make them differ. Comparing exact-case there fails OPEN, letting
 * chats under a Copilot root reach QA indexing and Miyo results. Folding is
 * confined to these roots: `qaExclusions` is the user's own literal, and on a
 * case-sensitive volume `Notes/` and `notes/` really are two folders — so this
 * gates on the platform, accepting that a case-sensitive APFS volume may
 * over-exclude, which fails closed.
 */
export function isSystemExcludedPath(filePath: string): boolean {
  return matchSystemRoots(filePath, getSystemExcludedFolders(getSettings()));
}

/** Whether the host filesystem treats paths case-insensitively. */
function hasCaseInsensitiveFilesystem(): boolean {
  return Platform.isWin || Platform.isMacOS || Platform.isIosApp;
}

/**
 * Match a raw path against Copilot roots the way the exclusion boundary does.
 *
 * Separate from {@link matchFilePathWithFolders} so the case-folding stays off
 * the user-pattern path — see {@link isSystemExcludedPath} for why.
 *
 * Exported for COVERAGE questions only — "does this root cover that path" — so a
 * guard deciding whether a candidate root would swallow the user's notes agrees
 * with the boundary that later enforces it.
 *
 * Deliberately NOT for IDENTITY questions such as "is this candidate the root I
 * used before" (see `isKnownCopilotRoot`). The platform check here is a
 * heuristic that treats every macOS volume as case-insensitive, which is safe
 * while it only ever over-excludes. Reused to grant an exemption it inverts:
 * on a case-sensitive volume it would accept a genuinely different folder as
 * "already known" and skip the content guard entirely.
 *
 * @param filePath - Vault-relative path, as the vault or Miyo reported it.
 * @param systemRoots - Roots from {@link getSystemExcludedFolders}, or a
 *   candidate root being evaluated before it is committed.
 */
export function matchSystemRoots(filePath: string, systemRoots: string[]): boolean {
  if (!hasCaseInsensitiveFilesystem()) {
    return matchFilePathWithFolders(filePath, systemRoots);
  }
  return matchFilePathWithFolders(
    filePath.toLowerCase(),
    systemRoots.map((root) => root.toLowerCase())
  );
}

/**
 * Should index the file based on the inclusions and exclusions patterns.
 * @param file - The file to check.
 * @param inclusions - The inclusions patterns.
 * @param exclusions - The exclusions patterns.
 * @param isProject - Project: Only the included files need to be processed, setting vault embedding： All files not excluded need to be processed.
 * @returns True if the file should be indexed, false otherwise.
 */
export function shouldIndexFile(
  app: App,
  file: TFile,
  inclusions: PatternCategory | null,
  exclusions: PatternCategory | null,
  isProject?: boolean
): boolean {
  // Always exclude Copilot's internal files from Copilot searches/indexing.
  if (isInternalExcludedFile(file)) {
    return false;
  }
  // Exclude the system Copilot roots (active + historical) before user patterns.
  if (isSystemExcludedPath(file.path)) {
    return false;
  }
  if (exclusions && matchFilePathWithPatterns(app, file, exclusions)) {
    return false;
  }
  if (inclusions && !matchFilePathWithPatterns(app, file, inclusions)) {
    return false;
  }

  // Project: Only the included files need to be processed.
  if (isProject && !inclusions) {
    return false;
  }

  return true;
}

/**
 * Build a predicate deciding whether a vault-relative path passes Copilot's QA
 * rules (resolved once for reuse). Unresolvable paths are kept, but the system
 * root exclusion is applied to the raw path first, so a former root's content is
 * dropped even with no user QA patterns configured.
 *
 * @param app - The Obsidian app instance.
 * @returns Predicate returning true when the path should be kept.
 */
export function createCopilotPatternFilter(app: App): (path: string) => boolean {
  const systemExcludedFolders = getSystemExcludedFolders(getSettings());
  const { inclusions, exclusions } = getMatchingPatterns();
  return (path: string) => {
    // System root exclusion runs first on the raw path (no TFile), holding even
    // in the no-user-pattern fast path below. Case-folded where the filesystem
    // is — see isSystemExcludedPath.
    if (matchSystemRoots(path, systemExcludedFolders)) {
      return false;
    }
    // Instruction files (AGENTS.md/CLAUDE.md/project.md) are excluded on the raw
    // path for the same reason: with no user patterns configured the TFile branch
    // below never runs, and the agent already receives these files as instructions.
    if (isInternalExcludedPath(path)) {
      return false;
    }
    if (!inclusions && !exclusions) {
      return true;
    }
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return true;
    }
    return shouldIndexFile(app, file, inclusions, exclusions);
  };
}

/**
 * Break down the patterns into their respective categories.
 * @param patterns - The patterns to categorize.
 * @returns An object containing the categorized patterns.
 */
export function categorizePatterns(patterns: string[]) {
  const tagPatterns: string[] = [];
  const extensionPatterns: string[] = [];
  const folderPatterns: string[] = [];
  const notePatterns: string[] = [];

  const tagRegex = /^#[^\s#]+$/; // Matches #tag format
  const extensionRegex = /^\*\.([a-zA-Z0-9.]+)$/; // Matches *.extension format
  const noteRegex = /^\[\[(.*?)\]\]$/; // Matches [[note name]] format - removed global flag and added ^ $

  patterns.forEach((pattern) => {
    if (tagRegex.test(pattern)) {
      tagPatterns.push(pattern);
    } else if (extensionRegex.test(pattern)) {
      extensionPatterns.push(pattern);
    } else if (noteRegex.test(pattern)) {
      notePatterns.push(pattern);
    } else {
      folderPatterns.push(pattern);
    }
  });

  return { tagPatterns, extensionPatterns, folderPatterns, notePatterns };
}

/**
 * Convert the pattern settings value to a preview string.
 * @param value - The value to preview.
 * @returns The previewed value.
 */
export function previewPatternValue(value: string): string {
  const patterns = getDecodedPatterns(value);
  return patterns.join(", ");
}

/**
 * Create the pattern settings value from the categorized patterns.
 * @param tagPatterns - The tag patterns.
 * @param extensionPatterns - The extension patterns.
 * @param folderPatterns - The folder patterns.
 * @param notePatterns - The note patterns.
 * @returns The pattern settings value.
 */
export function createPatternSettingsValue({
  tagPatterns,
  extensionPatterns,
  folderPatterns,
  notePatterns,
}: PatternCategory) {
  const patterns = [
    ...(tagPatterns ?? []),
    ...(extensionPatterns ?? []),
    ...(notePatterns ?? []),
    ...(folderPatterns ?? []),
  ].map((pattern) => encodeURIComponent(pattern));

  return patterns.join(",");
}

/**
 * Match the file path with the tag patterns.
 * @param filePath - The file path to match.
 * @param tagPatterns - The tag patterns to match the file path with.
 * @returns True if the file path matches the tags, false otherwise.
 */
function matchFilePathWithTags(app: App, file: TFile, tagPatterns: string[]): boolean {
  if (tagPatterns.length === 0) return false;

  const tags = getTagsFromNote(app, file);
  return tagPatterns.some((pattern) =>
    tags.some((tag) => tag.toLowerCase() === stripHash(pattern).toLowerCase())
  );
}

/**
 * Match the file path with the extension patterns.
 * @param filePath - The file path to match.
 * @param extensionPatterns - The extension patterns to match the file path with.
 * @returns True if the file path matches the extensions, false otherwise.
 */
function matchFilePathWithExtensions(filePath: string, extensionPatterns: string[]): boolean {
  if (extensionPatterns.length === 0) return false;

  // Convert file path to lowercase for case-insensitive matching
  const normalizedPath = filePath.toLowerCase();

  // Check if the file path ends with any of the extension patterns
  return extensionPatterns.some((pattern) => {
    // Convert *.extension to .extension
    const patternExt = pattern.slice(1).toLowerCase();
    return normalizedPath.endsWith(patternExt);
  });
}

/**
 * Match the file path with the folder patterns.
 * @param filePath - The file path to match.
 * @param folderPatterns - The folder patterns to match the file path with.
 * @returns True if the file path matches the folders, false otherwise.
 */
function matchFilePathWithFolders(filePath: string, folderPatterns: string[]): boolean {
  if (folderPatterns.length === 0) return false;

  // Normalize path separators to forward slashes to ensure cross-platform compatibility
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  return folderPatterns.some((pattern) => {
    // Normalize pattern path separators and remove trailing slashes
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/\/$/, "");

    // Check if the path starts with the pattern
    return (
      normalizedFilePath.startsWith(normalizedPattern) &&
      // Ensure it's a proper folder match by checking for / after pattern
      (normalizedFilePath.length === normalizedPattern.length ||
        normalizedFilePath[normalizedPattern.length] === "/")
    );
  });
}

/**
 * Match the file path with the note title patterns.
 * @param filePath - The file path to match.
 * @param notePatterns - The note patterns to match the file path with.
 * @returns True if the file path matches the note titles, false otherwise.
 */
function matchFilePathWithNotes(file: TFile, noteTitles: string[]): boolean {
  if (noteTitles.length === 0) return false;

  return noteTitles.some((title) => title.slice(2, -2) === file.basename);
}

/**
 * Match the file path with the patterns.
 * @param filePath - The file path to match.
 * @param patterns - The patterns to match the file path with.
 * @returns True if the file path matches the patterns, false otherwise.
 */
function matchFilePathWithPatterns(app: App, file: TFile, patterns: PatternCategory): boolean {
  if (!patterns) return false;

  const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } = patterns;

  return (
    matchFilePathWithTags(app, file, tagPatterns ?? []) ||
    matchFilePathWithExtensions(file.path, extensionPatterns ?? []) ||
    matchFilePathWithFolders(file.path, folderPatterns ?? []) ||
    matchFilePathWithNotes(file, notePatterns ?? [])
  );
}

export function extractAppIgnoreSettings(app: App): string[] {
  const appIgnoreFolders: string[] = [];
  try {
    // Check if getConfig method exists (it won't in tests)
    const vaultWithConfig = app.vault as unknown as { getConfig?: (key: string) => unknown };
    if (typeof vaultWithConfig.getConfig === "function") {
      const userIgnoreFilters: unknown = vaultWithConfig.getConfig("userIgnoreFilters");

      if (!!userIgnoreFilters && Array.isArray(userIgnoreFilters)) {
        userIgnoreFilters.forEach((it) => {
          if (typeof it === "string") {
            appIgnoreFolders.push(it.endsWith("/") ? it.slice(0, -1) : it);
          }
        });
      }
    }
  } catch (e) {
    // Only log in non-test environments
    if (process.env.NODE_ENV !== "test") {
      logWarn("Error getting userIgnoreFilters from Obsidian config", e);
    }
  }

  return appIgnoreFolders;
}

export function getTagPattern(tag: string): string {
  return `#${tag}`;
}

export function getFilePattern(file: TFile): string {
  return `[[${file.basename}]]`;
}

/**
 * Generate extension pattern from user input.
 * Note: User input is used as-is. If user inputs ".md", the result will be "*..md".
 * This is intentional - user is responsible for correct input format (e.g., "md" not ".md").
 */
export function getExtensionPattern(extension: string): string {
  return `*.${extension}`;
}

/**
 * Get a list of internal Copilot file paths that must be excluded from searches.
 * Includes the rolling log file path (e.g., "copilot/copilot-log.md").
 */
function getInternalExcludePaths(): string[] {
  return [logFileManager.getLogPath(), AGENTS_FILE_NAME, CLAUDE_FILE_NAME];
}

/**
 * Get a list of internal Copilot folder prefixes that must be excluded from searches.
 * Any file whose path starts with one of these prefixes is considered internal.
 */
function getInternalExcludeFolderPrefixes(): string[] {
  // Reason: derive the projects folder from the configurable root instead of the
  // retired `settings.projectsFolder`, so a custom root excludes its own
  // project-config files rather than the stale default path.
  const projectsFolder = getEffectiveProjectsFolder().trim();
  if (projectsFolder) {
    // Reason: normalize to forward slashes, collapse duplicates, strip trailing slash,
    // then append exactly one "/" for prefix matching. Mirrors normalizePath behavior
    // without depending on Obsidian runtime (needed for testability).
    const normalized = projectsFolder.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
    return [`${normalized}/`];
  }
  return [];
}

/**
 * Check whether a file path is an internal Copilot file that should be excluded from searches.
 * Checks both exact path matches (log file) and folder prefix matches (projects folder).
 * Exported so callers that only have a vault path (e.g. a delete/rename event whose `TFile`
 * no longer resolves) can apply the same internal-file exclusion as {@link isInternalExcludedFile}.
 * @param filePath - Full path to the file in the vault
 */
export function isInternalExcludedPath(filePath: string): boolean {
  const excludes = new Set(getInternalExcludePaths());
  if (excludes.has(filePath)) return true;

  // Reason: only exclude internal project files (project.md configs and unsupported/ backups),
  // not user-created files that may live alongside project configs in the projects folder.
  // Check exact depth: only <projectsFolder>/<folderName>/project.md (one level deep).
  const prefixes = getInternalExcludeFolderPrefixes();
  if (prefixes.length === 0) return false;
  for (const prefix of prefixes) {
    if (!filePath.startsWith(prefix)) continue;
    const relativePath = filePath.slice(prefix.length);
    const parts = relativePath.split("/");
    // Exact match: <folderName>/<file> (2 segments). Exclude the metadata record and
    // instruction files so internal guidance does not leak into semantic search results.
    if (
      parts.length === 2 &&
      [PROJECT_CONFIG_FILE_NAME, AGENTS_FILE_NAME, CLAUDE_FILE_NAME].includes(parts[1])
    )
      return true;
    if (relativePath.startsWith("unsupported/") || relativePath === "unsupported") return true;
  }
  return false;
}

/**
 * Check whether a TFile is an internal Copilot file that should be excluded from searches.
 * @param file - Obsidian file object
 */
export function isInternalExcludedFile(file: TFile): boolean {
  return isInternalExcludedPath(file.path);
}
