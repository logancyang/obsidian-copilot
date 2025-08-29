import { ChainType } from "@/chainFactory";
import { App, TFile } from "obsidian";
import { isAllowedFileForChainContext } from "@/utils";
import { extractAppIgnoreSettings, shouldIndexFile } from "@/search/searchUtils";

interface FileItem {
  id: string;
  name: string;
  type: "markdown" | "folder" | "other";
  path: string;
  extension?: string;
  isActive?: boolean;
}

export function getMarkdownFiles(
  app: App,
  chainType: ChainType,
  excludeNotePaths: string[],
  activeNote: TFile | null
): FileItem[] {
  const recentFiles = app.workspace
    .getLastOpenFiles()
    .map((filePath) => app.vault.getAbstractFileByPath(filePath))
    .filter(
      (file): file is TFile =>
        file instanceof TFile &&
        (file.extension === "md" || file.extension === "canvas") &&
        isAllowedFileForChainContext(file, chainType) &&
        !excludeNotePaths.includes(file.path) &&
        file.path !== activeNote?.path
    );

  // Get all other files
  const allFiles = app.vault
    .getFiles()
    .filter(
      (file) =>
        (file.extension === "md" || file.extension === "canvas") &&
        isAllowedFileForChainContext(file, chainType)
    );

  const otherFiles = allFiles.filter(
    (file) =>
      !recentFiles.some((recent) => recent.path === file.path) &&
      !excludeNotePaths.includes(file.path) &&
      file.path !== activeNote?.path
  );

  // Combine active files (if they exist and are permitted)
  const activeNoteArray =
    activeNote &&
    (activeNote.extension === "md" || activeNote.extension === "canvas") &&
    isAllowedFileForChainContext(activeNote, chainType)
      ? [activeNote]
      : [];

  const allOrderedFiles = [...activeNoteArray, ...recentFiles, ...otherFiles];

  return allOrderedFiles.map((file, index) => ({
    id: file.path,
    name: file.basename,
    type: "markdown",
    path: file.path,
    extension: file.extension,
    isActive: file.path === activeNote?.path,
  }));
}

export function getFolders(app: App): FileItem[] {
  const folderSet = new Set<string>();
  const ignoredFolders = extractAppIgnoreSettings(app);

  // Get all loaded files
  app.vault.getAllLoadedFiles().forEach((file) => {
    if (file.parent?.path && file.parent.path !== "/") {
      // Check if the folder is ignored
      const shouldInclude = !ignoredFolders.some(
        (ignored) => file.parent!.path === ignored || file.parent!.path.startsWith(ignored + "/")
      );

      if (shouldInclude) {
        folderSet.add(file.parent.path);
      }
    }
  });

  return Array.from(folderSet).map((folderPath) => ({
    id: folderPath,
    name: folderPath.split("/").pop() || folderPath,
    type: "folder",
    path: folderPath,
  }));
}

export function getOtherFiles(
  app: App,
  chainType: ChainType,
  excludeNotePaths: string[],
  activeNote: TFile | null
): FileItem[] {
  console.log(excludeNotePaths);
  const allFiles = app.vault
    .getFiles()
    .filter(
      (file) =>
        file.extension !== "md" &&
        file.extension !== "canvas" &&
        isAllowedFileForChainContext(file, chainType) &&
        !excludeNotePaths.includes(file.path) &&
        file.path !== activeNote?.path
    );

  return allFiles.map((file) => ({
    id: file.path,
    name: file.basename,
    type: "other",
    path: file.path,
    extension: file.extension,
    isActive: false,
  }));
}

/**
 * Get all files in a specific folder path
 * @param app - Obsidian App instance
 * @param folderPath - The folder path to search in
 * @param chainType - Optional chain type for permission filtering
 * @param excludeNotePaths - Optional array of file paths to exclude
 * @returns Array of FileItem objects representing files in the folder
 */
export function getFilesInFolder(
  app: App,
  folderPath: string,
  chainType?: ChainType,
  excludeNotePaths: string[] = []
): TFile[] {
  // Construct PatternCategory object for folder pattern
  const folderPattern = {
    folderPatterns: [folderPath],
  };

  // Get all files and apply filtering
  const allFiles = app.vault.getFiles().filter((file) => {
    // Check if file is in the specified folder
    const isInFolder = shouldIndexFile(file, folderPattern, null, true);
    if (!isInFolder) return false;

    // Check file permissions (if chainType is provided)
    if (chainType && !isAllowedFileForChainContext(file, chainType)) {
      return false;
    }

    // Exclude specified file paths
    if (excludeNotePaths.includes(file.path)) {
      return false;
    }

    return true;
  });

  // Convert to FileItem format
  return allFiles;
}
