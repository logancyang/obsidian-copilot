import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { getSettings } from "@/settings/model";
import { getTagsFromNote, isPathInList, stripHash } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { App, TFile } from "obsidian";

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
 * Get the exclusion patterns the exclusion settings string.
 * @returns An array of exclusion patterns.
 */
function getExclusionPatterns(): string[] {
  if (!getSettings().qaExclusions) {
    return [];
  }
  const exclusions: string[] = [];
  exclusions.push(...extractAppIgnoreSettings(app));

  if (getSettings().qaExclusions) {
    exclusions.push(
      ...getSettings()
        .qaExclusions.split(",")
        .map((item) => item.trim())
    );
  }

  return exclusions;
}

/**
 * Get the inclusion patterns from the inclusion settings string.
 * @returns An array of inclusion patterns.
 */
function getInclusionPatterns(): string[] {
  if (!getSettings().qaInclusions) {
    return [];
  }
  const inclusions: string[] = [];
  inclusions.push(
    ...getSettings()
      .qaInclusions.split(",")
      .map((item) => item.trim())
  );

  return inclusions;
}

/**
 * Get the inclusion and exclusion patterns from the settings.
 * @returns An object containing the inclusions and exclusions patterns strings.
 */
export function getMatchingPatterns(): { inclusions: string[]; exclusions: string[] } {
  const inclusions = getInclusionPatterns();
  const exclusions = getExclusionPatterns();
  return { inclusions, exclusions };
}

export function shouldIndexFile(file: TFile, inclusions: string[], exclusions: string[]): boolean {
  if (exclusions.length > 0 && matchFilePathWithPatterns(file.path, exclusions)) {
    return false;
  }
  if (inclusions.length > 0 && !matchFilePathWithPatterns(file.path, inclusions)) {
    return false;
  }
  return true;
}

/**
 * Match the file path with the patterns.
 * @param filePath - The file path to match.
 * @param patterns - The patterns to match the file path with.
 * @returns True if the file path matches the patterns, false otherwise.
 */
function matchFilePathWithPatterns(filePath: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;

  // Group patterns by type for more efficient processing
  const tagPatterns: string[] = [];
  const extensionPatterns: string[] = [];
  const pathPatterns: string[] = [];

  patterns.forEach((pattern) => {
    if (pattern.startsWith("#")) {
      tagPatterns.push(stripHash(pattern));
    } else if (pattern.startsWith("*")) {
      extensionPatterns.push(pattern.slice(1).toLowerCase());
    } else {
      pathPatterns.push(pattern);
    }
  });

  // Check extension patterns
  if (extensionPatterns.length > 0) {
    const fileExt = filePath.toLowerCase();
    if (extensionPatterns.some((ext) => fileExt.endsWith(ext))) {
      return true;
    }
  }

  // Check path patterns
  if (pathPatterns.length > 0) {
    if (pathPatterns.some((pattern) => isPathInList(filePath, pattern))) {
      return true;
    }
  }

  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    const tags = getTagsFromNote(file);
    if (tagPatterns.some((pattern) => tags.includes(pattern))) {
      return true;
    }
  }

  return false;
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
