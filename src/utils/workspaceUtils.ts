import { App, TFolder, TAbstractFile, TFile } from "obsidian";
import { CharacterPresetItem } from "@/settings/model";

/**
 * Workspace information interface
 */
export interface WorkspaceInfo {
  /** Workspace name (folder name) */
  name: string;
  /** Relative path from project root */
  relativePath: string;
}

export interface WorkspaceConfig {
  version: string;
  excludedPaths?: string[];
  personas?: PersonaConfig[];
}

// export interface PersonaConfig {
//   id: string;
//   name: string;
//   description: string;
// }

export interface PersonaConfig {
  id: string;
  name: string;
  prompt: string;
}

export async function convertToPersonaConfig(item: PersonaConfig | CharacterPresetItem): Promise<PersonaConfig> {
  
  const personaConfig: PersonaConfig = {
    id: item.id,
    name: item.name,
    prompt: item.prompt,
  };
  return personaConfig;
}

/**
 * Workspace detection options
 */
export interface WorkspaceDetectionOptions {
  /** Configuration file name to look for, defaults to 'workspace_config' */
  configFileName?: string;
  /** Whether to search recursively in subdirectories, defaults to true */
  recursive?: boolean;
  /** Maximum depth for recursive search, defaults to 10 */
  maxDepth?: number;
}

/**
 * Check if a folder contains a workspace configuration file
 * @param app Obsidian app instance
 * @param folder The folder to check
 * @param configFileName The configuration file name to look for
 * @returns Promise<boolean> Whether the folder is a workspace
 */
export async function isWorkspaceFolder(
  app: App,
  folder: TFolder,
  configFileName: string = "data.md"
): Promise<boolean> {
  try {
    // Check if the configuration file exists in the folder
    // 根目录特殊处理
    const configPath = folder.path === "/" ? configFileName : `${folder.path}/${configFileName}`;
    const configFile = app.vault.getAbstractFileByPath(configPath);

    // Return true if file exists and is actually a file (not a folder)
    return configFile !== null && configFile instanceof TFile;
  } catch (error) {
    console.error(`Error checking workspace folder ${folder.path}:`, error);
    return false;
  }
}

export async function getWorkspaceConfig(app: App, filePath: string): Promise<WorkspaceConfig> {
  const configPath = filePath === "/" ? "data.md" : `${filePath}/data.md`;
  const configFile = app.vault.getAbstractFileByPath(configPath);
  
  if (!(configFile instanceof TFile)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  const content = await app.vault.read(configFile);
  return JSON.parse(content) as WorkspaceConfig;
}

/**
 * Recursively search for workspace folders in a given directory
 * @param app Obsidian app instance
 * @param folder The folder to search in
 * @param options Detection options
 * @param currentDepth Current recursion depth (for internal use)
 * @returns Promise<WorkspaceInfo[]> Array of found workspaces
 */
async function searchWorkspacesInFolder(
  app: App,
  folder: TFolder,
  options: WorkspaceDetectionOptions,
  currentDepth: number = 0
): Promise<WorkspaceInfo[]> {
  const workspaces: WorkspaceInfo[] = [];
  const { configFileName = "data.md", recursive = true, maxDepth = 10 } = options;

  // Check depth limit
  if (currentDepth >= maxDepth) {
    return workspaces;
  }
  console.log(`name: ${folder.name}, Searching in folder: ${folder.path}, depth: ${currentDepth}`);
  // Check if current folder is a workspace
  if (await isWorkspaceFolder(app, folder, configFileName)) {
    workspaces.push({
      name: folder.name,
      relativePath: folder.path,
    });
  }

  // If recursive search is enabled, search in subfolders
  if (recursive) {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        const childWorkspaces = await searchWorkspacesInFolder(
          app,
          child,
          options,
          currentDepth + 1
        );
        workspaces.push(...childWorkspaces);
      }
    }
  }

  return workspaces;
}

/**
 * Find all workspaces in the current project
 * @param app Obsidian app instance
 * @param options Detection options
 * @returns Promise<WorkspaceInfo[]> Array of all found workspaces
 */
export async function findAllWorkspaces(
  app: App,
  options: WorkspaceDetectionOptions = {}
): Promise<WorkspaceInfo[]> {
  try {
    const rootFolder = app.vault.getRoot();

    const result = await searchWorkspacesInFolder(app, rootFolder, options);
    console.log(`Found ${result.length} workspaces in project root:`, result);
    return result
  } catch (error) {
    console.error("Error finding workspaces:", error);
    return [];
  }
}

/**
 * Find workspaces matching a specific name pattern
 * @param app Obsidian app instance
 * @param namePattern Regular expression or string to match workspace names
 * @param options Detection options
 * @returns Promise<WorkspaceInfo[]> Array of matching workspaces
 */
export async function findWorkspacesByName(
  app: App,
  namePattern: string | RegExp,
  options: WorkspaceDetectionOptions = {}
): Promise<WorkspaceInfo[]> {
  const allWorkspaces = await findAllWorkspaces(app, options);
  
  const pattern = typeof namePattern === "string" 
    ? new RegExp(namePattern, "i") 
    : namePattern;

  return allWorkspaces.filter(workspace => 
    pattern.test(workspace.name)
  );
}

/**
 * Get workspace information for a specific path
 * @param app Obsidian app instance
 * @param folderPath The path to check
 * @param options Detection options
 * @returns Promise<WorkspaceInfo | null> Workspace info if found, null otherwise
 */
export async function getWorkspaceInfo(
  app: App,
  folderPath: string,
  options: WorkspaceDetectionOptions = {}
): Promise<WorkspaceInfo | null> {
  try {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    
    if (!(folder instanceof TFolder)) {
      return null;
    }

    const { configFileName = "workspace_config" } = options;
    
    if (await isWorkspaceFolder(app, folder, configFileName)) {
      return {
        name: folder.name,
        relativePath: folder.path,
      };
    }

    return null;
  } catch (error) {
    console.error(`Error getting workspace info for ${folderPath}:`, error);
    return null;
  }
} 