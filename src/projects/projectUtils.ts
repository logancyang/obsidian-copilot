import { ProjectConfig } from "@/aiParams";
import {
  COPILOT_PROJECT_CREATED,
  COPILOT_PROJECT_DESCRIPTION,
  COPILOT_PROJECT_EXCLUSIONS,
  COPILOT_PROJECT_ID,
  COPILOT_PROJECT_INCLUSIONS,
  COPILOT_PROJECT_LAST_USED,
  COPILOT_PROJECT_MAX_TOKENS,
  COPILOT_PROJECT_MODEL_KEY,
  COPILOT_PROJECT_NAME,
  COPILOT_PROJECT_TEMPERATURE,
  COPILOT_PROJECT_WEB_URLS,
  COPILOT_PROJECT_YOUTUBE_URLS,
  EMPTY_PROJECT_CONFIG,
  PROJECT_CONFIG_FILE_NAME,
  PROJECTS_UNSUPPORTED_FOLDER_NAME,
} from "@/projects/constants";
import {
  getProjectFolderNameFromConfigPath,
  getProjectsFolder,
  splitUrlsStringToArray,
} from "@/projects/projectPaths";
import { ProjectFileRecord, ProjectScanDiagnostics } from "@/projects/type";
import { stripFrontmatter } from "@/utils";
import { logError, logWarn } from "@/logger";
import { parseYaml, TFile, TFolder } from "obsidian";
import {
  addPendingFileWrite,
  isPendingFileWrite,
  removePendingFileWrite,
  updateCachedProjectRecords,
} from "@/projects/state";

// Re-export path utilities so existing consumers don't need to change imports
export {
  getProjectsFolder,
  getProjectsUnsupportedFolder,
  getProjectFolderPath,
  getProjectConfigFilePath,
  isProjectConfigFile,
  sanitizeVaultPathSegment,
  splitUrlsStringToArray,
  readFrontmatterFieldFromFile,
} from "@/projects/projectPaths";

/**
 * Write all project frontmatter fields to a file (overwrite mode).
 * Shared by both ProjectFileManager and migration to avoid duplication.
 *
 * @param file - Target TFile
 * @param project - ProjectConfig to serialize
 * @param folderName - Folder name (used as fallback for id/name)
 * @param timestamps - Created and last-used timestamps
 */
export async function writeProjectFrontmatter(
  file: TFile,
  project: ProjectConfig,
  folderName: string,
  timestamps: { createdMs: number; lastUsedMs: number }
): Promise<void> {
  const webUrls = splitUrlsStringToArray(project.contextSource?.webUrls || "");
  const youtubeUrls = splitUrlsStringToArray(project.contextSource?.youtubeUrls || "");

  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    // Reason: project.id is the stable logical identity, always set by createProject/migration.
    // Do NOT fallback to folderName — with name-based folders, folderName is derived from
    // project name, not id, so it cannot serve as an id substitute.
    frontmatter[COPILOT_PROJECT_ID] = project.id.trim();
    frontmatter[COPILOT_PROJECT_NAME] = (project.name || folderName).trim();
    frontmatter[COPILOT_PROJECT_DESCRIPTION] = (project.description || "").trim();
    frontmatter[COPILOT_PROJECT_MODEL_KEY] = (project.projectModelKey || "").trim();

    if (project.modelConfigs?.temperature != null) {
      frontmatter[COPILOT_PROJECT_TEMPERATURE] = project.modelConfigs.temperature;
    } else {
      delete frontmatter[COPILOT_PROJECT_TEMPERATURE];
    }

    if (project.modelConfigs?.maxTokens != null) {
      frontmatter[COPILOT_PROJECT_MAX_TOKENS] = project.modelConfigs.maxTokens;
    } else {
      delete frontmatter[COPILOT_PROJECT_MAX_TOKENS];
    }

    frontmatter[COPILOT_PROJECT_INCLUSIONS] = project.contextSource?.inclusions || "";
    frontmatter[COPILOT_PROJECT_EXCLUSIONS] = project.contextSource?.exclusions || "";
    frontmatter[COPILOT_PROJECT_WEB_URLS] = webUrls;
    frontmatter[COPILOT_PROJECT_YOUTUBE_URLS] = youtubeUrls;
    frontmatter[COPILOT_PROJECT_CREATED] = timestamps.createdMs;
    frontmatter[COPILOT_PROJECT_LAST_USED] = timestamps.lastUsedMs;
  });
}

/**
 * Coerce a frontmatter value to a finite number.
 * Handles YAML parsing string values gracefully.
 */
function coerceFrontmatterNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Coerce a frontmatter value to string with fallback. */
function coerceFrontmatterString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  return fallback;
}

/**
 * Coerce a frontmatter value to a string array.
 * Handles both YAML arrays and single strings (split by newline).
 */
function coerceFrontmatterStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Strip YAML folding artifacts from encoded strings.
 * Long encoded strings may be folded by YAML serializers, inserting newlines/spaces.
 */
function stripYamlFoldingArtifacts(value: string): string {
  // Reason: YAML serializers may fold long strings, inserting \n followed by spaces.
  // Encoded strings (URL-encoded inclusions/exclusions) must not contain these artifacts.
  return value.replace(/\n\s*/g, "").replace(/\r/g, "");
}

/** Convert URL array to newline-separated string (for ProjectConfig runtime format). */
function joinUrlsArrayToString(urls: string[]): string {
  return (urls || [])
    .map((u) => u.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Parse a project.md file into a ProjectFileRecord.
 *
 * Key constraints:
 * - id: frontmatter is authoritative, folder name is fallback
 * - Frontmatter parse failure: return null and logWarn (no auto-fix)
 * - inclusions/exclusions: kept as encoded strings with YAML folding stripped
 * - webUrls/youtubeUrls: stored as YAML arrays, converted to newline strings for runtime
 *
 * @param file - project.md TFile
 * @returns ProjectFileRecord, or null if parse fails
 */
export async function parseProjectConfigFile(file: TFile): Promise<ProjectFileRecord | null> {
  // Reason: vault.read() calls internal TFile.cache which doesn't exist on synthetic TFiles
  // created by resolveFileByPath() for hidden-folder or not-yet-indexed files.
  // Use the cached real TFile for vault API calls; fall back to adapter for synthetic files.
  const cachedFile = app.vault.getAbstractFileByPath(file.path);
  const isRealVaultFile = cachedFile instanceof TFile;
  const rawContent = isRealVaultFile
    ? await app.vault.read(cachedFile)
    : await app.vault.adapter.read(file.path);
  const content = stripFrontmatter(rawContent, { trimStart: false });

  // Reason: rawContent is authoritative — metadataCache can lag behind writes from
  // ensureProjectFrontmatter(), external edits, or sync. Parse frontmatter from the
  // just-read file first; only fall back to metadataCache when no frontmatter block exists.
  let frontmatter: Record<string, unknown> | undefined;
  const fmMatch = rawContent.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    try {
      const parsed = parseYaml(fmMatch[1]);
      if (parsed && typeof parsed === "object") {
        frontmatter = parsed as Record<string, unknown>;
      }
    } catch {
      logWarn(`[Projects] Failed to parse YAML frontmatter from file: ${file.path}`);
      return null;
    }
  }
  if (!frontmatter && isRealVaultFile) {
    const metadata = app.metadataCache.getFileCache(cachedFile);
    frontmatter = metadata?.frontmatter;
  }

  const folderName = getProjectFolderNameFromConfigPath(file.path);
  if (!folderName) {
    logWarn(`[Projects] Cannot extract folder name from path, ignoring file: ${file.path}`);
    return null;
  }

  // Reason: frontmatter id is the sole authoritative identity. Do NOT fallback to folderName
  // because with name-based folders, folderName is derived from project name, not id.
  // Files missing copilot-project-id are treated as corrupted and skipped.
  // Reason: YAML scalar typing can parse bare numeric ids (e.g. `copilot-project-id: 123`)
  // as numbers. Coerce to string so valid numeric ids are not silently dropped.
  const rawId = frontmatter?.[COPILOT_PROJECT_ID];
  const idFromFrontmatter =
    typeof rawId === "number" && Number.isFinite(rawId)
      ? String(rawId)
      : coerceFrontmatterString(rawId, "");
  if (!idFromFrontmatter.trim()) {
    logWarn(`[Projects] Missing ${COPILOT_PROJECT_ID} in frontmatter, skipping file: ${file.path}`);
    return null;
  }
  const projectId = idFromFrontmatter.trim();

  const nameFromFrontmatter = coerceFrontmatterString(
    frontmatter?.[COPILOT_PROJECT_NAME],
    ""
  ).trim();
  const projectName = nameFromFrontmatter || folderName;

  const description = coerceFrontmatterString(
    frontmatter?.[COPILOT_PROJECT_DESCRIPTION],
    ""
  ).trim();
  const projectModelKey = coerceFrontmatterString(
    frontmatter?.[COPILOT_PROJECT_MODEL_KEY],
    ""
  ).trim();

  const temperature = coerceFrontmatterNumber(frontmatter?.[COPILOT_PROJECT_TEMPERATURE], NaN);
  const maxTokens = coerceFrontmatterNumber(frontmatter?.[COPILOT_PROJECT_MAX_TOKENS], NaN);

  // Encoded strings: strip YAML folding artifacts, keep encoded format
  const rawInclusions = coerceFrontmatterString(frontmatter?.[COPILOT_PROJECT_INCLUSIONS], "");
  const rawExclusions = coerceFrontmatterString(frontmatter?.[COPILOT_PROJECT_EXCLUSIONS], "");
  const inclusions = stripYamlFoldingArtifacts(rawInclusions);
  const exclusions = stripYamlFoldingArtifacts(rawExclusions);

  const webUrlsArray = coerceFrontmatterStringArray(frontmatter?.[COPILOT_PROJECT_WEB_URLS]);
  const youtubeUrlsArray = coerceFrontmatterStringArray(
    frontmatter?.[COPILOT_PROJECT_YOUTUBE_URLS]
  );

  const createdMs = coerceFrontmatterNumber(
    frontmatter?.[COPILOT_PROJECT_CREATED],
    file.stat?.ctime ?? 0
  );
  const lastUsedMs = coerceFrontmatterNumber(frontmatter?.[COPILOT_PROJECT_LAST_USED], 0);

  const modelConfigs: ProjectFileRecord["project"]["modelConfigs"] = {};
  if (Number.isFinite(temperature)) {
    modelConfigs.temperature = temperature;
  }
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    modelConfigs.maxTokens = maxTokens;
  }

  return {
    project: {
      ...EMPTY_PROJECT_CONFIG,
      id: projectId,
      name: projectName,
      description: description || "",
      systemPrompt: content,
      projectModelKey,
      modelConfigs,
      contextSource: {
        inclusions: inclusions || "",
        exclusions: exclusions || "",
        webUrls: joinUrlsArrayToString(webUrlsArray),
        youtubeUrls: joinUrlsArrayToString(youtubeUrlsArray),
      },
      created: Number.isFinite(createdMs) && createdMs > 0 ? createdMs : 0,
      UsageTimestamps: Number.isFinite(lastUsedMs) && lastUsedMs > 0 ? lastUsedMs : 0,
    },
    filePath: file.path,
    folderName,
  };
}

/**
 * Scan all project config files with duplicate id detection.
 *
 * Performance: only traverses the projectsFolder subtree, not the entire vault.
 * Looks for \<projectsFolder\>/\<folderName\>/project.md (one level deep).
 *
 * Duplicate rules:
 * - Build id -> path[] index during scan
 * - On duplicate: logWarn, keep first by path alphabetical order (stable)
 *
 * @returns Records and diagnostics
 */
export async function scanAllProjectConfigFiles(): Promise<{
  records: ProjectFileRecord[];
  diagnostics: ProjectScanDiagnostics;
}> {
  // Reason: §1.8 requires targeted folder traversal, not vault-wide scan.
  // Falls back to adapter-based listing for hidden folders not indexed by vault cache.
  const projectsFolder = getProjectsFolder();
  const rootFolder = app.vault.getAbstractFileByPath(projectsFolder);

  const files: TFile[] = [];
  if (rootFolder instanceof TFolder) {
    for (const child of rootFolder.children) {
      if (!(child instanceof TFolder)) continue;
      if (child.name === PROJECTS_UNSUPPORTED_FOLDER_NAME) continue;
      const configFile = child.children.find(
        (f) => f instanceof TFile && f.name === PROJECT_CONFIG_FILE_NAME
      );
      if (configFile instanceof TFile) {
        files.push(configFile);
      }
    }
  } else if (await app.vault.adapter.exists(projectsFolder)) {
    // Reason: hidden folders (e.g. ".copilot/projects") are not indexed by vault cache.
    // Use adapter.list() to discover project sub-folders and resolve config files.
    const { resolveFileByPath } = await import("@/utils/vaultAdapterUtils");
    const listing = await app.vault.adapter.list(projectsFolder);
    for (const subFolderPath of listing.folders) {
      const folderName = subFolderPath.split("/").pop() ?? "";
      if (folderName === PROJECTS_UNSUPPORTED_FOLDER_NAME) continue;
      const configPath = `${subFolderPath}/${PROJECT_CONFIG_FILE_NAME}`;
      if (await app.vault.adapter.exists(configPath)) {
        const resolved = await resolveFileByPath(app, configPath);
        if (resolved) files.push(resolved);
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const duplicateIdIndex: Record<string, string[]> = {};
  const ignoredFiles: string[] = [];
  const records: ProjectFileRecord[] = [];

  for (const file of files) {
    let record: ProjectFileRecord | null;
    try {
      record = await parseProjectConfigFile(file);
    } catch (error) {
      logError(`[Projects] Failed to parse project file, skipping: ${file.path}`, error);
      ignoredFiles.push(file.path);
      continue;
    }
    if (!record) {
      ignoredFiles.push(file.path);
      continue;
    }

    const id = record.project.id;
    if (!duplicateIdIndex[id]) {
      duplicateIdIndex[id] = [];
    }
    duplicateIdIndex[id].push(file.path);

    if (duplicateIdIndex[id].length > 1) {
      logWarn(
        `[Projects] Duplicate project id="${id}": ` +
          `${duplicateIdIndex[id].join(", ")}; keeping first: ${duplicateIdIndex[id][0]}`
      );
      continue;
    }

    records.push(record);
  }

  return { records, diagnostics: { duplicateIdIndex, ignoredFiles } };
}

/**
 * Load all projects from vault and update the cache.
 *
 * NOTE: This does NOT merge legacy settings.projectList entries.
 * Migration unconditionally clears projectList after backup (matching the
 * custom command and system prompt migration patterns). Failed projects
 * are recovered from the unsupported/ folder, not from settings.
 *
 * @returns Array of ProjectFileRecord
 */
export async function loadAllProjects(): Promise<ProjectFileRecord[]> {
  const { records } = await scanAllProjectConfigFiles();
  updateCachedProjectRecords(records);
  return records;
}

/**
 * Fetch all projects from vault without updating the cache.
 * @returns Array of ProjectFileRecord
 */
export async function fetchAllProjects(): Promise<ProjectFileRecord[]> {
  const { records } = await scanAllProjectConfigFiles();
  return records;
}

/**
 * Ensure a project.md has required frontmatter fields (idempotent, only fills missing).
 *
 * @param file - project.md TFile
 * @param record - Parsed record providing default values
 */
export async function ensureProjectFrontmatter(
  file: TFile,
  record: ProjectFileRecord
): Promise<void> {
  const alreadyPending = isPendingFileWrite(file.path);

  const now = Date.now();
  const createdMs =
    Number.isFinite(record.project.created) && record.project.created > 0
      ? record.project.created
      : now;
  const lastUsedMs =
    Number.isFinite(record.project.UsageTimestamps) && record.project.UsageTimestamps > 0
      ? record.project.UsageTimestamps
      : 0;

  const webUrls = splitUrlsStringToArray(record.project.contextSource?.webUrls || "");
  const youtubeUrls = splitUrlsStringToArray(record.project.contextSource?.youtubeUrls || "");

  try {
    if (!alreadyPending) addPendingFileWrite(file.path);

    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      // Reason: do NOT fallback to record.folderName for id — with name-based folders,
      // folderName is derived from project name, not id.
      if (frontmatter[COPILOT_PROJECT_ID] == null && record.project.id) {
        frontmatter[COPILOT_PROJECT_ID] = record.project.id;
      }
      if (frontmatter[COPILOT_PROJECT_NAME] == null) {
        frontmatter[COPILOT_PROJECT_NAME] = record.project.name || record.folderName;
      }
      if (frontmatter[COPILOT_PROJECT_DESCRIPTION] == null && record.project.description) {
        frontmatter[COPILOT_PROJECT_DESCRIPTION] = record.project.description;
      }
      if (frontmatter[COPILOT_PROJECT_MODEL_KEY] == null && record.project.projectModelKey) {
        frontmatter[COPILOT_PROJECT_MODEL_KEY] = record.project.projectModelKey;
      }
      if (
        frontmatter[COPILOT_PROJECT_TEMPERATURE] == null &&
        record.project.modelConfigs?.temperature != null
      ) {
        frontmatter[COPILOT_PROJECT_TEMPERATURE] = record.project.modelConfigs.temperature;
      }
      if (
        frontmatter[COPILOT_PROJECT_MAX_TOKENS] == null &&
        record.project.modelConfigs?.maxTokens != null
      ) {
        frontmatter[COPILOT_PROJECT_MAX_TOKENS] = record.project.modelConfigs.maxTokens;
      }
      if (
        frontmatter[COPILOT_PROJECT_INCLUSIONS] == null &&
        record.project.contextSource?.inclusions
      ) {
        frontmatter[COPILOT_PROJECT_INCLUSIONS] = record.project.contextSource.inclusions;
      }
      if (
        frontmatter[COPILOT_PROJECT_EXCLUSIONS] == null &&
        record.project.contextSource?.exclusions
      ) {
        frontmatter[COPILOT_PROJECT_EXCLUSIONS] = record.project.contextSource.exclusions;
      }
      if (frontmatter[COPILOT_PROJECT_WEB_URLS] == null && webUrls.length > 0) {
        frontmatter[COPILOT_PROJECT_WEB_URLS] = webUrls;
      }
      if (frontmatter[COPILOT_PROJECT_YOUTUBE_URLS] == null && youtubeUrls.length > 0) {
        frontmatter[COPILOT_PROJECT_YOUTUBE_URLS] = youtubeUrls;
      }
      if (frontmatter[COPILOT_PROJECT_CREATED] == null) {
        frontmatter[COPILOT_PROJECT_CREATED] = createdMs;
      }
      if (frontmatter[COPILOT_PROJECT_LAST_USED] == null) {
        frontmatter[COPILOT_PROJECT_LAST_USED] = lastUsedMs;
      }
    });
  } finally {
    if (!alreadyPending) removePendingFileWrite(file.path);
  }
}
