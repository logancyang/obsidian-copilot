import { PROJECT_CONFIG_FILE_NAME, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { getSettings } from "@/settings/model";
import { normalizePath, TAbstractFile, TFile, Vault } from "obsidian";

/**
 * Get the projects root folder path from settings.
 * @returns Normalized vault path
 */
export function getProjectsFolder(): string {
  return normalizePath(getSettings().projectsFolder);
}

/**
 * Get the unsupported backup folder path for failed migrations.
 * @returns Normalized vault path
 */
export function getProjectsUnsupportedFolder(): string {
  return normalizePath(`${getProjectsFolder()}/${PROJECTS_UNSUPPORTED_FOLDER_NAME}`);
}

/**
 * Get a project's folder path by folder name.
 * @param folderName - Project folder name (typically the project id)
 * @returns Normalized vault path
 */
export function getProjectFolderPath(folderName: string): string {
  return normalizePath(`${getProjectsFolder()}/${folderName}`);
}

/**
 * Get a project's config file (project.md) path.
 * @param folderName - Project folder name
 * @param folderOverride - Optional root folder override
 * @returns Normalized vault path
 */
export function getProjectConfigFilePath(folderName: string, folderOverride?: string): string {
  const root = folderOverride ? normalizePath(folderOverride) : getProjectsFolder();
  return normalizePath(`${root}/${folderName}/${PROJECT_CONFIG_FILE_NAME}`);
}

/**
 * Check if a file is a project config file (project.md).
 *
 * Rules:
 * - Must be under projectsFolder
 * - Path must be: \<projectsFolder\>/\<folderName\>/project.md (exactly 2 levels deep)
 * - Excludes unsupported/ directory
 *
 * @param file - Vault abstract file
 * @returns Type guard: true if file is a valid project config TFile
 */
export function isProjectConfigFile(file: TAbstractFile): file is TFile {
  if (!(file instanceof TFile)) return false;
  if (file.extension !== "md") return false;

  const folder = getProjectsFolder();
  if (!file.path.startsWith(folder + "/")) return false;

  const relativePath = file.path.slice(folder.length + 1);
  if (relativePath.startsWith(`${PROJECTS_UNSUPPORTED_FOLDER_NAME}/`)) return false;

  const parts = relativePath.split("/");
  if (parts.length !== 2) return false;
  if (parts[1] !== PROJECT_CONFIG_FILE_NAME) return false;

  return true;
}

/**
 * Extract the project folder name from a project.md path.
 * @param filePath - Vault path of project.md
 * @returns Folder name, or null if path is invalid
 */
export function getProjectFolderNameFromConfigPath(filePath: string): string | null {
  const folder = getProjectsFolder();
  if (!filePath.startsWith(folder + "/")) return null;

  const relativePath = filePath.slice(folder.length + 1);
  const parts = relativePath.split("/");
  if (parts.length !== 2 || parts[1] !== PROJECT_CONFIG_FILE_NAME) return null;

  return parts[0] || null;
}

/**
 * Sanitize a string for use as a single vault path segment.
 * Strips path separators, Windows-reserved characters, and ASCII control characters.
 * @param input - Raw string (e.g. project id)
 * @returns Sanitized string safe for use as a folder/file name
 */
export function sanitizeVaultPathSegment(input: string): string {
  const trimmed = (input || "").trim();
  // eslint-disable-next-line no-control-regex
  let sanitized = trimmed.replace(/[<>:"/\\|?*]/g, "_").replace(/[\x00-\x1F]/g, "_");

  // Reason: Windows does not allow trailing dots or spaces in folder/file names
  sanitized = sanitized.replace(/[. ]+$/g, "");

  // Reason: "." and ".." are path traversal segments, not valid folder names
  if (sanitized === "." || sanitized === "..") {
    sanitized = sanitized.replace(/\./g, "_");
  }

  // Reason: Windows reserved device names are invalid as folder/file names (case-insensitive)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // Reason: callers rely on non-empty return for folder/file creation
  if (!sanitized) sanitized = "_";
  return sanitized;
}

/**
 * Derive the folder name for a project from its name (preferred) or id (fallback).
 * Applies sanitization and reserves the "unsupported" folder name for migration backups.
 *
 * @param projectId - Project id (used as fallback when name is empty)
 * @param projectName - Project display name (preferred source for folder name)
 * @returns Sanitized folder name safe for use as a vault path segment
 */
export function deriveProjectFolderName(projectId: string, projectName?: string): string {
  const source = (projectName || "").trim() || projectId;
  let folderName = sanitizeVaultPathSegment(source);
  // Reason: "unsupported" is reserved for migration failure backups
  if (folderName.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME) {
    folderName = `_${folderName}`;
  }
  return folderName;
}

/** Convert newline-separated URL string to array (for YAML frontmatter). */
export function splitUrlsStringToArray(urlsString: string): string[] {
  return (urlsString || "")
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Read a simple `key: value` frontmatter field directly from file content.
 * Used as fallback when metadataCache is not yet populated (e.g. on startup).
 *
 * @param vault - Vault instance
 * @param file - Target file
 * @param key - Frontmatter key to extract
 * @returns Trimmed value string, or empty string if not found
 */
export async function readFrontmatterFieldFromFile(
  vault: Vault,
  file: TFile,
  key: string
): Promise<string> {
  try {
    const raw = await vault.cachedRead(file);
    // Reason: handle both LF and CRLF line endings, and optional BOM for cross-platform compat
    const fmMatch = raw.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return "";

    // Reason: simple line-by-line match is sufficient for single-line frontmatter values
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lineMatch = fmMatch[1].match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"));
    if (!lineMatch) return "";

    let value = lineMatch[1].trim();
    // Reason: strip inline YAML comments (unquoted values only)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex > 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }
    return value;
  } catch {
    return "";
  }
}

/**
 * Read a YAML list field from frontmatter directly from file content.
 * Used as fallback when metadataCache is not yet populated.
 * Handles the `key:\n- item1\n- item2` YAML list format.
 *
 * @param vault - Vault instance
 * @param file - Target file
 * @param key - Frontmatter key to extract
 * @returns Array of string values
 */
export async function readFrontmatterListFromFile(
  vault: Vault,
  file: TFile,
  key: string
): Promise<string[]> {
  try {
    const raw = await vault.cachedRead(file);
    const fmMatch = raw.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return [];

    const lines = fmMatch[1].split(/\r?\n/);
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keyRegex = new RegExp(`^${escaped}:\\s*$`);

    let collecting = false;
    const items: string[] = [];

    for (const line of lines) {
      if (keyRegex.test(line)) {
        collecting = true;
        continue;
      }
      if (collecting) {
        // Reason: YAML list items start with "- ", stop collecting on any non-list line
        const listMatch = line.match(/^\s*-\s+(.+)$/);
        if (listMatch) {
          const val = listMatch[1].trim();
          if (val) items.push(val);
        } else {
          break;
        }
      }
    }
    return items;
  } catch {
    return [];
  }
}
