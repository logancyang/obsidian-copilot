import { PROJECT_CONFIG_FILE_NAME, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { getEffectiveProjectsFolder } from "@/settings/copilotFolder";
import { normalizePath, TAbstractFile, TFile, Vault } from "obsidian";

export function getProjectsFolder(): string {
  return getEffectiveProjectsFolder();
}

export function getProjectAnchorFromConfigPath(configFilePath: string): {
  projectFolderPath: string;
  projectsRoot: string;
} {
  const segments = normalizePath(configFilePath).split("/");
  if (segments.length < 3) {
    throw new Error(`Not a project config path: "${configFilePath}"`);
  }
  return {
    projectFolderPath: segments.slice(0, -1).join("/"),
    projectsRoot: segments.slice(0, -2).join("/"),
  };
}

export function getProjectsUnsupportedFolder(): string {
  return normalizePath(`${getProjectsFolder()}/${PROJECTS_UNSUPPORTED_FOLDER_NAME}`);
}

export function getProjectFolderPath(folderName: string): string {
  return normalizePath(`${getProjectsFolder()}/${folderName}`);
}

export function getProjectConfigFilePath(folderName: string, folderOverride?: string): string {
  const root = folderOverride ? normalizePath(folderOverride) : getProjectsFolder();
  return normalizePath(`${root}/${folderName}/${PROJECT_CONFIG_FILE_NAME}`);
}

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

export function getProjectFolderNameFromConfigPath(filePath: string): string | null {
  const folder = getProjectsFolder();
  if (!filePath.startsWith(folder + "/")) return null;

  const relativePath = filePath.slice(folder.length + 1);
  const parts = relativePath.split("/");
  if (parts.length !== 2 || parts[1] !== PROJECT_CONFIG_FILE_NAME) return null;

  return parts[0] || null;
}

export function sanitizeVaultPathSegment(input: string): string {
  const trimmed = (input || "").trim();
  // eslint-disable-next-line no-control-regex -- project paths must reject embedded control bytes
  let sanitized = trimmed.replace(/[<>:"/\\|?*]/g, "_").replace(/[\x00-\x1F]/g, "_");

  sanitized = sanitized.replace(/[. ]+$/g, "");

  if (sanitized === "." || sanitized === "..") {
    sanitized = sanitized.replace(/\./g, "_");
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  if (!sanitized) sanitized = "_";
  return sanitized;
}

export function deriveProjectFolderName(projectId: string, projectName?: string): string {
  const source = (projectName || "").trim() || projectId;
  let folderName = sanitizeVaultPathSegment(source);
  if (folderName.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME) {
    folderName = `_${folderName}`;
  }
  return folderName;
}

export function splitUrlsStringToArray(urlsString: string): string[] {
  return (urlsString || "")
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
}

export async function readFrontmatterFieldFromFile(
  vault: Vault,
  file: TFile,
  key: string
): Promise<string> {
  try {
    const raw = await vault.cachedRead(file);
    const fmMatch = raw.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return "";

    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lineMatch = fmMatch[1].match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"));
    if (!lineMatch) return "";

    let value = lineMatch[1].trim();
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
