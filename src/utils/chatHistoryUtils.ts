import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { sanitizeVaultPathSegment } from "@/projects/projectPaths";
import { getCachedProjectRecords } from "@/projects/state";
import type { RecentUsageManager } from "@/utils/recentUsageManager";
import { formatDateTime } from "@/utils";
import { readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { App, TFile } from "obsidian";

function hasKnownProjectPrefix(basename: string): boolean {
  const records = getCachedProjectRecords();

  const matchesCachedProject = records.some((r) => {
    const sanitizedPrefix = `${sanitizeVaultPathSegment(r.project.id)}__`;
    const rawPrefix = `${r.project.id}__`;
    return basename.startsWith(sanitizedPrefix) || basename.startsWith(rawPrefix);
  });
  return matchesCachedProject;
}

function coerceProjectId(projectId: unknown): string | undefined {
  if (typeof projectId === "string") return projectId.trim() || undefined;
  if (typeof projectId === "number") return String(projectId);
  return undefined;
}

async function readChatFileProjectId(app: App, file: TFile): Promise<string | undefined> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  let projectId: unknown = fm?.projectId;

  if (projectId === undefined && !fm) {
    try {
      const adapterFm = await readFrontmatterViaAdapter(app, file.path);
      projectId = adapterFm?.projectId;
    } catch {
      return undefined;
    }
  }

  return coerceProjectId(projectId);
}

export async function readChatPathProjectId(
  app: App,
  filePath: string
): Promise<string | undefined> {
  const existingFile = app.vault.getAbstractFileByPath(filePath);
  if (existingFile instanceof TFile) {
    return readChatFileProjectId(app, existingFile);
  }

  try {
    const adapterFm = await readFrontmatterViaAdapter(app, filePath);
    return coerceProjectId(adapterFm?.projectId);
  } catch {
    return undefined;
  }
}

export async function filterChatHistoryFiles(app: App, files: TFile[]): Promise<TFile[]> {
  const results = await Promise.all(
    files.map(async (file) => ({
      file,
      projectId: await readChatFileProjectId(app, file),
    }))
  );

  return results
    .filter(({ file, projectId }) => !projectId && !hasKnownProjectPrefix(file.basename))
    .map(({ file }) => file);
}

export function extractChatTitle(app: App, file: TFile): string {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

  if (frontmatter?.topic && typeof frontmatter.topic === "string" && frontmatter.topic.trim()) {
    return frontmatter.topic.trim();
  }

  let basename = file.basename;
  const rawProjectId = frontmatter?.projectId;
  const projectId =
    typeof rawProjectId === "string"
      ? rawProjectId.trim()
      : typeof rawProjectId === "number"
        ? String(rawProjectId)
        : "";

  if (projectId) {
    const sanitizedPrefix = `${sanitizeVaultPathSegment(projectId)}__`;
    const rawPrefix = `${projectId}__`;
    if (basename.startsWith(sanitizedPrefix)) {
      basename = basename.slice(sanitizedPrefix.length);
    } else if (basename.startsWith(rawPrefix)) {
      basename = basename.slice(rawPrefix.length);
    }
  } else {
    basename = basename.replace(/^[a-zA-Z0-9_-]+__/, "");
  }

  return basename
    .replace(/\{\$date\}|\d{8}/g, "")
    .replace(/\{\$time\}|\d{6}/g, "")
    .replace(/[@_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractChatDate(app: App, file: TFile): Date {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

  if (frontmatter && frontmatter.epoch) {
    return new Date(frontmatter.epoch as number);
  } else {
    return new Date(file.stat.ctime);
  }
}

export function extractChatLastAccessedAtMs(app: App, file: TFile): number | null {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const rawValue = frontmatter?.lastAccessedAt;

  if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const numeric = Number(rawValue);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }

    const parsedDate = Date.parse(rawValue);
    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }

  return null;
}

export function fileToHistoryItem(
  app: App,
  file: TFile,
  lastAccessedAtManager: RecentUsageManager<string>
): ChatHistoryItem {
  const createdAt = extractChatDate(app, file);
  const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(app, file);
  const effectiveLastAccessedAtMs = lastAccessedAtManager.getEffectiveLastUsedAt(
    file.path,
    persistedLastAccessedAtMs ?? createdAt.getTime()
  );
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const rawBackendId = frontmatter?.backendId;
  const backendId =
    typeof rawBackendId === "string" && rawBackendId.trim() ? rawBackendId.trim() : undefined;
  const projectId = coerceProjectId(frontmatter?.projectId);
  return {
    id: file.path,
    title: extractChatTitle(app, file),
    createdAt,
    lastAccessedAt: new Date(effectiveLastAccessedAtMs),
    backendId,
    projectId,
  };
}

export function getChatDisplayText(app: App, file: TFile): string {
  const title = extractChatTitle(app, file);
  const date = extractChatDate(app, file);
  const formattedDateTime = formatDateTime(date);
  return `${title} - ${formattedDateTime.display}`;
}
