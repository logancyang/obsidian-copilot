// helper contains business-related tools；
// generally, util contains business-independent tools

import { parseYaml, TFile, Vault } from "obsidian";

export function isPathInList(filePath: string, pathList: string): boolean {
  if (!pathList) return false;

  // Extract the file name from the filePath
  const fileName = filePath.split("/").pop()?.toLowerCase();

  // Normalize the file path for case-insensitive comparison
  const normalizedFilePath = filePath.toLowerCase();

  return pathList
    .split(",")
    .map(
      (path) =>
        path
          .trim() // Trim whitespace
          .replace(/^\[\[|\]\]$/g, "") // Remove surrounding [[ and ]]
          .replace(/^\//, "") // Remove leading slash
          .toLowerCase() // Convert to lowercase for case-insensitive comparison
    )
    .some((normalizedPath) => {
      // Check for exact match or proper segmentation
      const isExactMatch =
        normalizedFilePath === normalizedPath ||
        normalizedFilePath.startsWith(normalizedPath + "/") ||
        normalizedFilePath.endsWith("/" + normalizedPath) ||
        normalizedFilePath.includes("/" + normalizedPath + "/");
      // Check for file name match (for cases like [[note1]])
      const isFileNameMatch = fileName === normalizedPath + ".md";

      return isExactMatch || isFileNameMatch;
    });
}

export const getNotesFromPath = async (vault: Vault, path: string): Promise<TFile[]> => {
  const files = vault.getMarkdownFiles();

  // Special handling for the root path '/'
  if (path === "/") {
    return files;
  }

  // Normalize the input path
  const normalizedPath = path.toLowerCase().replace(/^\/|\/$/g, "");

  return files.filter((file) => {
    // Normalize the file path
    const normalizedFilePath = file.path.toLowerCase();
    const filePathParts = normalizedFilePath.split("/");
    const pathParts = normalizedPath.split("/");

    // Check if the file path contains all parts of the input path in order
    let filePathIndex = 0;
    for (const pathPart of pathParts) {
      while (filePathIndex < filePathParts.length) {
        if (filePathParts[filePathIndex] === pathPart) {
          break;
        }
        filePathIndex++;
      }
      if (filePathIndex >= filePathParts.length) {
        return false;
      }
    }

    return true;
  });
};

export async function getTagsFromNote(file: TFile, vault: Vault): Promise<string[]> {
  const fileContent = await vault.cachedRead(file);
  // Check if the file starts with frontmatter delimiter
  if (fileContent.startsWith("---")) {
    const frontMatterBlock = fileContent.split("---", 3);
    // Ensure there's a closing delimiter for frontmatter
    if (frontMatterBlock.length >= 3) {
      const frontMatterContent = frontMatterBlock[1];
      try {
        const frontMatter = parseYaml(frontMatterContent) || {};
        const tags = frontMatter.tags || [];
        // Strip any '#' from the frontmatter tags. Obsidian sometimes has '#' sometimes doesn't...
        return tags
          .map((tag: string) => tag.replace("#", ""))
          .map((tag: string) => tag.toLowerCase());
      } catch (error) {
        console.error("Error parsing YAML frontmatter:", error);
        return [];
      }
    }
  }
  return [];
}

export async function getNotesFromTags(
  vault: Vault,
  tags: string[],
  noteFiles?: TFile[]
): Promise<TFile[]> {
  if (tags.length === 0) {
    return [];
  }

  // Strip any '#' from the tags set from the user
  tags = tags.map((tag) => tag.replace("#", ""));

  const files = noteFiles && noteFiles.length > 0 ? noteFiles : await getNotesFromPath(vault, "/");
  const filesWithTag = [];

  for (const file of files) {
    const noteTags = await getTagsFromNote(file, vault);
    if (tags.some((tag) => noteTags.includes(tag))) {
      filesWithTag.push(file);
    }
  }

  return filesWithTag;
}

export async function getNoteFileFromTitle(vault: Vault, noteTitle: string): Promise<TFile | null> {
  // Get all markdown files in the vault
  const files = vault.getMarkdownFiles();

  // Iterate through all files to find a match by title
  for (const file of files) {
    // Extract the title from the filename by removing the extension
    const title = file.basename;

    if (title === noteTitle) {
      // If a match is found, return the file path
      return file;
    }
  }

  // If no match is found, return null
  return null;
}

export function getNoteTitleAndTags(noteWithTag: {
  name: string;
  content: string;
  tags?: string[];
}): string {
  return (
    `[[${noteWithTag.name}]]` +
    (noteWithTag.tags && noteWithTag.tags.length > 0 ? `\ntags: ${noteWithTag.tags.join(",")}` : "")
  );
}

export const isFolderMatch = (fileFullpath: string, inputPath: string): boolean => {
  const fileSegments = fileFullpath.split("/").map((segment) => segment.toLowerCase());
  return fileSegments.includes(inputPath.toLowerCase());
};

export async function getFileContent(file: TFile, vault: Vault): Promise<string | null> {
  if (file.extension != "md") return null;
  return await vault.cachedRead(file);
}

export function getFileName(file: TFile): string {
  return file.basename;
}

export async function getAllNotesContent(vault: Vault): Promise<string> {
  let allContent = "";

  const markdownFiles = vault.getMarkdownFiles();

  for (const file of markdownFiles) {
    const fileContent = await vault.cachedRead(file);
    allContent += fileContent + " ";
  }

  return allContent;
}
