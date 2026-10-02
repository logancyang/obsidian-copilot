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
import { updateFrontmatterMarkdownFile } from "@/utils/frontmatterMarkdownFile";
import { logError, logWarn } from "@/logger";
import { App, parseYaml, TFile, TFolder } from "obsidian";
import {
  addPendingFileWrite,
  isPendingFileWrite,
  removePendingFileWrite,
  updateCachedProjectRecords,
} from "@/projects/state";

export {
  getProjectAnchorFromConfigPath,
  getProjectsFolder,
  getProjectsUnsupportedFolder,
  getProjectFolderPath,
  getProjectConfigFilePath,
  isProjectConfigFile,
  sanitizeVaultPathSegment,
  splitUrlsStringToArray,
  readFrontmatterFieldFromFile,
} from "@/projects/projectPaths";

export async function writeProjectFrontmatter(
  app: App,
  file: TFile,
  project: ProjectConfig,
  folderName: string,
  timestamps: { createdMs: number; lastUsedMs: number }
): Promise<void> {
  const webUrls = splitUrlsStringToArray(project.contextSource?.webUrls || "");
  const youtubeUrls = splitUrlsStringToArray(project.contextSource?.youtubeUrls || "");

  await updateFrontmatterMarkdownFile(app, file.path, (frontmatter) => {
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

function coerceFrontmatterNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function coerceFrontmatterString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

function stripYamlFoldingArtifacts(value: string): string {
  return value.replace(/\n\s*/g, "").replace(/\r/g, "");
}

function joinUrlsArrayToString(urls: string[]): string {
  return (urls || [])
    .map((u) => u.trim())
    .filter(Boolean)
    .join("\n");
}

export async function parseProjectConfigFile(
  app: App,
  file: TFile
): Promise<ProjectFileRecord | null> {
  const cachedFile = app.vault.getAbstractFileByPath(file.path);
  const isRealVaultFile = cachedFile instanceof TFile;
  const rawContent = isRealVaultFile
    ? await app.vault.read(cachedFile)
    : await app.vault.adapter.read(file.path);
  const content = stripFrontmatter(rawContent, { trimStart: false });

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

  const rawId = frontmatter?.[COPILOT_PROJECT_ID];
  const idFromFrontmatter =
    typeof rawId === "number" && Number.isFinite(rawId)
      ? String(rawId)
      : coerceFrontmatterString(rawId);
  if (!idFromFrontmatter.trim()) {
    logWarn(`[Projects] Missing ${COPILOT_PROJECT_ID} in frontmatter, skipping file: ${file.path}`);
    return null;
  }
  const projectId = idFromFrontmatter.trim();

  const nameFromFrontmatter = coerceFrontmatterString(frontmatter?.[COPILOT_PROJECT_NAME]).trim();
  const projectName = nameFromFrontmatter || folderName;

  const description = coerceFrontmatterString(frontmatter?.[COPILOT_PROJECT_DESCRIPTION]).trim();
  const projectModelKey = coerceFrontmatterString(frontmatter?.[COPILOT_PROJECT_MODEL_KEY]).trim();

  const temperature = coerceFrontmatterNumber(frontmatter?.[COPILOT_PROJECT_TEMPERATURE], NaN);
  const maxTokens = coerceFrontmatterNumber(frontmatter?.[COPILOT_PROJECT_MAX_TOKENS], NaN);

  const rawInclusions = coerceFrontmatterString(frontmatter?.[COPILOT_PROJECT_INCLUSIONS]);
  const rawExclusions = coerceFrontmatterString(frontmatter?.[COPILOT_PROJECT_EXCLUSIONS]);
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

export async function scanAllProjectConfigFiles(app: App): Promise<{
  records: ProjectFileRecord[];
  diagnostics: ProjectScanDiagnostics;
}> {
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
      record = await parseProjectConfigFile(app, file);
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

export async function loadAllProjects(app: App): Promise<ProjectFileRecord[]> {
  const { records } = await scanAllProjectConfigFiles(app);
  updateCachedProjectRecords(records);
  return records;
}

export async function fetchAllProjects(app: App): Promise<ProjectFileRecord[]> {
  const { records } = await scanAllProjectConfigFiles(app);
  return records;
}

export async function ensureProjectFrontmatter(
  app: App,
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
