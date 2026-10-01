import { COPILOT_FOLDER_ROOT } from "@/constants";
import { AGENTS_FILE_NAME, CLAUDE_FILE_NAME } from "@/instructions/agentsFile";
import { PROJECT_CONFIG_FILE_NAME } from "@/projects/constants";
import { logWarn } from "@/logger";
import { getSettings, normalizeRootFolders, type CopilotSettings } from "@/settings/model";
import { getEffectiveProjectsFolder } from "@/settings/copilotFolder";
import { logFileManager } from "@/logFileManager";
import { getPropertyValuesFromNote, getTagsFromNote, noteHasProperty, stripHash } from "@/utils";
import { hasCaseInsensitiveFilesystem } from "@/utils/vaultAdapterUtils";
import { App, TFile } from "obsidian";

export interface PatternCategory {
  tagPatterns?: string[];
  extensionPatterns?: string[];
  folderPatterns?: string[];
  notePatterns?: string[];
  propertyPatterns?: string[];
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
          return trimmed;
        }
      })
      .filter((item) => item.length > 0)
  );

  return patterns;
}

function getExclusionPatterns(): string[] {
  if (!getSettings().qaExclusions) {
    return [];
  }

  return getDecodedPatterns(getSettings().qaExclusions);
}

function getInclusionPatterns(): string[] {
  if (!getSettings().qaInclusions) {
    return [];
  }

  return getDecodedPatterns(getSettings().qaInclusions);
}

export function getMatchingPatterns(options?: {
  inclusions?: string;
  exclusions?: string;
  isProject?: boolean;
}): {
  inclusions: PatternCategory | null;
  exclusions: PatternCategory | null;
} {
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

export function getSystemExcludedFolders(settings: CopilotSettings): string[] {
  const history = Array.isArray(settings.copilotRootHistory) ? settings.copilotRootHistory : [];
  return normalizeRootFolders([COPILOT_FOLDER_ROOT, settings.copilotFolder, ...history]);
}

export function isSystemExcludedPath(filePath: string): boolean {
  return matchSystemRoots(filePath, getSystemExcludedFolders(getSettings()));
}

export function matchSystemRoots(filePath: string, systemRoots: string[]): boolean {
  if (!hasCaseInsensitiveFilesystem()) {
    return matchFilePathWithFolders(filePath, systemRoots);
  }
  return matchFilePathWithFolders(
    filePath.toLowerCase(),
    systemRoots.map((root) => root.toLowerCase())
  );
}

export function shouldIndexFile(
  app: App,
  file: TFile,
  inclusions: PatternCategory | null,
  exclusions: PatternCategory | null,
  isProject?: boolean
): boolean {
  if (isInternalExcludedFile(file)) {
    return false;
  }
  if (isSystemExcludedPath(file.path)) {
    return false;
  }
  if (exclusions && matchFilePathWithPatterns(app, file, exclusions)) {
    return false;
  }
  if (inclusions && !matchFilePathWithPatterns(app, file, inclusions)) {
    return false;
  }

  if (isProject && !inclusions) {
    return false;
  }

  return true;
}

export function createCopilotPatternFilter(app: App): (path: string) => boolean {
  const systemExcludedFolders = getSystemExcludedFolders(getSettings());
  const { inclusions, exclusions } = getMatchingPatterns();
  return (path: string) => {
    if (matchSystemRoots(path, systemExcludedFolders)) {
      return false;
    }
    if (isInternalExcludedPath(path)) {
      return false;
    }
    if (!inclusions && !exclusions) {
      return true;
    }
    if (exclusions && matchPathOnlyPatterns(path, exclusions)) {
      return false;
    }
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      // Miyo can return a stale or remote path that the current vault cannot
      // resolve. Folder, extension, and note-title rules still have enough path
      // data to evaluate. Tags and properties do not, so fail closed instead of
      // letting a possibly excluded current-vault result through.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
      if (hasMetadataPatterns(exclusions)) {
        return false;
      }
      if (!inclusions) {
        return true;
      }
      return matchPathOnlyPatterns(path, inclusions);
    }
    return shouldIndexFile(app, file, inclusions, exclusions);
  };
}

export function categorizePatterns(patterns: string[]) {
  const tagPatterns: string[] = [];
  const extensionPatterns: string[] = [];
  const folderPatterns: string[] = [];
  const notePatterns: string[] = [];
  const propertyPatterns: string[] = [];

  const tagRegex = /^#[^\s#]+$/;
  const extensionRegex = /^\*\.([a-zA-Z0-9.]+)$/;
  const noteRegex = /^\[\[(.*?)\]\]$/;
  const propertyRegex = /^\[([^[\]:]+):(.*)\]$/;

  patterns.forEach((pattern) => {
    if (tagRegex.test(pattern)) {
      tagPatterns.push(pattern);
    } else if (extensionRegex.test(pattern)) {
      extensionPatterns.push(pattern);
    } else if (noteRegex.test(pattern)) {
      notePatterns.push(pattern);
    } else if (propertyRegex.test(pattern)) {
      propertyPatterns.push(pattern);
    } else {
      folderPatterns.push(pattern);
    }
  });

  return { tagPatterns, extensionPatterns, folderPatterns, notePatterns, propertyPatterns };
}

export function parsePropertyPattern(pattern: string): { key: string; value: string } | null {
  const match = pattern.match(/^\[([^[\]:]+):(.*)\]$/);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

export function createPatternSettingsValue({
  tagPatterns,
  extensionPatterns,
  folderPatterns,
  notePatterns,
  propertyPatterns,
}: PatternCategory) {
  const patterns = [
    ...(tagPatterns ?? []),
    ...(extensionPatterns ?? []),
    ...(notePatterns ?? []),
    ...(propertyPatterns ?? []),
    ...(folderPatterns ?? []),
  ].map((pattern) => encodeURIComponent(pattern));

  return patterns.join(",");
}

function matchFilePathWithTags(app: App, file: TFile, tagPatterns: string[]): boolean {
  if (tagPatterns.length === 0) return false;

  const tags = getTagsFromNote(app, file);
  return tagPatterns.some((pattern) =>
    tags.some((tag) => tag.toLowerCase() === stripHash(pattern).toLowerCase())
  );
}

function matchFilePathWithProperties(app: App, file: TFile, propertyPatterns: string[]): boolean {
  if (propertyPatterns.length === 0) return false;

  return propertyPatterns.some((pattern) => {
    const parsed = parsePropertyPattern(pattern);
    if (!parsed) return false;
    if (parsed.value === "") return noteHasProperty(app, file, parsed.key);
    const values = getPropertyValuesFromNote(app, file, parsed.key);
    const target = parsed.value.toLowerCase();
    return values.some((value) => value.trim().toLowerCase() === target);
  });
}

function matchFilePathWithExtensions(filePath: string, extensionPatterns: string[]): boolean {
  if (extensionPatterns.length === 0) return false;

  const normalizedPath = filePath.toLowerCase();

  return extensionPatterns.some((pattern) => {
    const patternExt = pattern.slice(1).toLowerCase();
    return normalizedPath.endsWith(patternExt);
  });
}

function matchFilePathWithFolders(filePath: string, folderPatterns: string[]): boolean {
  if (folderPatterns.length === 0) return false;

  const normalizedFilePath = filePath.replace(/\\/g, "/");

  return folderPatterns.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/\/$/, "");

    return (
      normalizedFilePath.startsWith(normalizedPattern) &&
      (normalizedFilePath.length === normalizedPattern.length ||
        normalizedFilePath[normalizedPattern.length] === "/")
    );
  });
}

function matchPathOnlyPatterns(filePath: string, patterns: PatternCategory): boolean {
  const { extensionPatterns, folderPatterns, notePatterns } = patterns;
  return (
    matchFilePathWithExtensions(filePath, extensionPatterns ?? []) ||
    matchFilePathWithFolders(filePath, folderPatterns ?? []) ||
    matchFilePathWithNoteTitles(filePath, notePatterns ?? [])
  );
}

function hasMetadataPatterns(patterns: PatternCategory | null): boolean {
  return Boolean(patterns?.tagPatterns?.length || patterns?.propertyPatterns?.length);
}

function matchFilePathWithNoteTitles(filePath: string, noteTitles: string[]): boolean {
  if (noteTitles.length === 0) return false;

  const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const basename = fileName.replace(/\.[^./]+$/, "");
  return noteTitles.some((title) => title.slice(2, -2) === basename);
}

function matchFilePathWithNotes(file: TFile, noteTitles: string[]): boolean {
  if (noteTitles.length === 0) return false;

  return noteTitles.some((title) => title.slice(2, -2) === file.basename);
}

function matchFilePathWithPatterns(app: App, file: TFile, patterns: PatternCategory): boolean {
  if (!patterns) return false;

  const { tagPatterns, extensionPatterns, folderPatterns, notePatterns, propertyPatterns } =
    patterns;

  return (
    matchFilePathWithTags(app, file, tagPatterns ?? []) ||
    matchFilePathWithExtensions(file.path, extensionPatterns ?? []) ||
    matchFilePathWithFolders(file.path, folderPatterns ?? []) ||
    matchFilePathWithNotes(file, notePatterns ?? []) ||
    matchFilePathWithProperties(app, file, propertyPatterns ?? [])
  );
}

export function extractAppIgnoreSettings(app: App): string[] {
  const appIgnoreFolders: string[] = [];
  try {
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
    if (process.env.NODE_ENV !== "test") {
      logWarn("Error getting userIgnoreFilters from Obsidian config", e);
    }
  }

  return appIgnoreFolders;
}

export function getTagPattern(tag: string): string {
  return `#${tag}`;
}

export function getPropertyPattern(key: string, value?: string): string {
  return value ? `[${key}:${value}]` : `[${key}:]`;
}

export function getFilePattern(file: TFile): string {
  return `[[${file.basename}]]`;
}

function getInternalExcludePaths(): string[] {
  return [logFileManager.getLogPath(), AGENTS_FILE_NAME, CLAUDE_FILE_NAME];
}

function getInternalExcludeFolderPrefixes(): string[] {
  const projectsFolder = getEffectiveProjectsFolder().trim();
  if (projectsFolder) {
    const normalized = projectsFolder.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
    return [`${normalized}/`];
  }
  return [];
}

export function isInternalExcludedPath(filePath: string): boolean {
  const fold = hasCaseInsensitiveFilesystem()
    ? (value: string) => value.toLowerCase()
    : (value: string) => value;
  const foldedPath = fold(filePath);
  const excludes = new Set(getInternalExcludePaths().map(fold));
  if (excludes.has(foldedPath)) return true;

  const prefixes = getInternalExcludeFolderPrefixes();
  if (prefixes.length === 0) return false;
  const internalBasenames = [PROJECT_CONFIG_FILE_NAME, AGENTS_FILE_NAME, CLAUDE_FILE_NAME].map(
    fold
  );
  for (const prefix of prefixes.map(fold)) {
    if (!foldedPath.startsWith(prefix)) continue;
    const relativePath = foldedPath.slice(prefix.length);
    const parts = relativePath.split("/");
    if (parts.length === 2 && internalBasenames.includes(parts[1])) return true;
    if (relativePath.startsWith("unsupported/") || relativePath === "unsupported") return true;
  }
  return false;
}

export function isInternalExcludedFile(file: TFile): boolean {
  return isInternalExcludedPath(file.path);
}
