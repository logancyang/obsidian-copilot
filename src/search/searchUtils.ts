import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { getSettings } from "@/settings/model";
import { getFilePathsFromPatterns } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { App } from "obsidian";

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

  const includedFiles = await getFilePathsForQA("inclusions", app);
  const excludedFiles = await getFilePathsForQA("exclusions", app);

  const filteredFiles = app.vault.getMarkdownFiles().filter((file) => {
    if (includedFiles.size > 0) {
      return includedFiles.has(file.path);
    }
    return !excludedFiles.has(file.path);
  });

  await Promise.all(filteredFiles.map((file) => app.vault.cachedRead(file))).then((contents) =>
    contents.map((c) => (allContent += c + " "))
  );

  return allContent;
}

export async function getFilePathsForQA(
  filterType: "exclusions" | "inclusions",
  app: App
): Promise<Set<string>> {
  const targetFiles = new Set<string>();

  if (filterType === "exclusions") {
    const exclusions: string[] = [];
    exclusions.push(...extractAppIgnoreSettings(app));

    if (getSettings().qaExclusions) {
      exclusions.push(
        ...getSettings()
          .qaExclusions.split(",")
          .map((item) => item.trim())
      );
    }

    const excludedFilePaths = await getFilePathsFromPatterns(exclusions, app.vault);
    excludedFilePaths.forEach((filePath) => targetFiles.add(filePath));
  } else if (filterType === "inclusions" && getSettings().qaInclusions) {
    const inclusions = getSettings()
      .qaInclusions.split(",")
      .map((item) => item.trim());
    const includedFilePaths = await getFilePathsFromPatterns(inclusions, app.vault);
    includedFilePaths.forEach((filePath) => targetFiles.add(filePath));
  }

  return targetFiles;
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
