import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { getSettings } from "@/settings/model";
import { getTagsFromNote, stripHash } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { App, TFile } from "obsidian";

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

    console.log(
      `Detected vector length: ${sampleEmbedding.length} for model: ${EmbeddingsManager.getModelName(embeddingInstance)}`
    );
    return sampleEmbedding.length;
  } catch (error) {
    console.error("Error getting vector length:", error);
    throw new CustomError(
      "Failed to determine embedding vector length. Please check your embedding model settings."
    );
  }
}

export async function getAllQAMarkdownContent(app: App): Promise<string> {
  let allContent = "";

  const { inclusions, exclusions } = getMatchingPatterns();

  const filteredFiles = app.vault.getMarkdownFiles().filter((file) => {
    return shouldIndexFile(file, inclusions, exclusions);
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
      .map((item) => decodeURIComponent(item.trim()))
      .filter((item) => item.length > 0)
  );

  return patterns;
}

/**
 * Get the exclusion patterns the exclusion settings string.
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
 * Should index the file based on the inclusions and exclusions patterns.
 * @param file - The file to check.
 * @param inclusions - The inclusions patterns.
 * @param exclusions - The exclusions patterns.
 * @returns True if the file should be indexed, false otherwise.
 */
export function shouldIndexFile(
  file: TFile,
  inclusions: PatternCategory | null,
  exclusions: PatternCategory | null
): boolean {
  if (exclusions && matchFilePathWithPatterns(file.path, exclusions)) {
    return false;
  }
  if (inclusions && !matchFilePathWithPatterns(file.path, inclusions)) {
    return false;
  }
  return true;
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
function matchFilePathWithTags(filePath: string, tagPatterns: string[]): boolean {
  if (tagPatterns.length === 0) return false;

  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    const tags = getTagsFromNote(file);
    if (tagPatterns.some((pattern) => tags.includes(stripHash(pattern)))) {
      return true;
    }
  }
  return false;
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
function matchFilePathWithNotes(filePath: string, noteTitles: string[]): boolean {
  if (noteTitles.length === 0) return false;

  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    if (noteTitles.some((title) => title.slice(2, -2) === file.basename)) {
      return true;
    }
  }
  return false;
}

/**
 * Match the file path with the patterns.
 * @param filePath - The file path to match.
 * @param patterns - The patterns to match the file path with.
 * @returns True if the file path matches the patterns, false otherwise.
 */
function matchFilePathWithPatterns(filePath: string, patterns: PatternCategory): boolean {
  if (!patterns) return false;

  const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } = patterns;

  return (
    matchFilePathWithTags(filePath, tagPatterns ?? []) ||
    matchFilePathWithExtensions(filePath, extensionPatterns ?? []) ||
    matchFilePathWithFolders(filePath, folderPatterns ?? []) ||
    matchFilePathWithNotes(filePath, notePatterns ?? [])
  );
}

export function extractAppIgnoreSettings(app: App): string[] {
  const appIgnoreFolders: string[] = [];
  try {
    const userIgnoreFilters: unknown = (app.vault as any).getConfig("userIgnoreFilters");

    if (!!userIgnoreFilters && Array.isArray(userIgnoreFilters)) {
      userIgnoreFilters.forEach((it) => {
        if (typeof it === "string") {
          appIgnoreFolders.push(it.endsWith("/") ? it.slice(0, -1) : it);
        }
      });
    }
  } catch (e) {
    console.warn("Error getting userIgnoreFilters from Obsidian config", e);
  }

  return appIgnoreFolders;
}

export function getTagPattern(tag: string): string {
  return `#${tag}`;
}

export function getFilePattern(file: TFile): string {
  return `[[${file.basename}]]`;
}

export function getExtensionPattern(extension: string): string {
  return `*.${extension}`;
}
