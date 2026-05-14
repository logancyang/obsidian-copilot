import { sanitizeVaultPathSegment } from "@/projects/projectPaths";
import { getCachedProjectRecords } from "@/projects/state";
import { formatDateTime } from "@/utils";
import { readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { App, TFile } from "obsidian";

/**
 * Check if a chat file's basename matches a known project ID prefix.
 * Used to exclude legacy project chat files (which lack projectId frontmatter)
 * from the non-project chat history view.
 *
 * @param basename - File basename to check
 * @returns true if the basename starts with a known project prefix
 */
export function hasKnownProjectPrefix(basename: string): boolean {
  const records = getCachedProjectRecords();

  // Reason: check precise prefix matching against known cached project IDs first.
  const matchesCachedProject = records.some((r) => {
    const sanitizedPrefix = `${sanitizeVaultPathSegment(r.project.id)}__`;
    const rawPrefix = `${r.project.id}__`;
    return basename.startsWith(sanitizedPrefix) || basename.startsWith(rawPrefix);
  });
  // Reason: only match precise known project IDs — a broad regex like ^[a-zA-Z0-9_-]+__
  // would hide legitimate non-project notes (e.g. "foo__bar.md") in the chat folder.
  return matchesCachedProject;
}

/**
 * Coerce a raw frontmatter projectId value to a normalized string or undefined.
 */
function coerceProjectId(projectId: unknown): string | undefined {
  if (typeof projectId === "string") return projectId.trim() || undefined;
  if (typeof projectId === "number") return String(projectId);
  return undefined;
}

/**
 * Read the projectId from a chat file's frontmatter.
 * Tries metadataCache first, falls back to adapter read for hidden-directory files.
 */
export async function readChatFileProjectId(app: App, file: TFile): Promise<string | undefined> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  let projectId: unknown = fm?.projectId;

  // Reason: hidden-directory files are not indexed by metadataCache
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

/**
 * Read the projectId from a chat file path (supports both vault-cached and hidden-directory files).
 */
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

/**
 * Filter chat history files by project ownership.
 * In project mode: returns files belonging to the given project (by frontmatter or legacy prefix).
 * In non-project mode: returns files without a projectId, excluding legacy project chats.
 *
 * @param app - Obsidian app instance
 * @param files - Pre-filtered candidate files
 * @param currentProjectId - Current project ID, or undefined for non-project mode
 */
export async function filterChatHistoryFiles(
  app: App,
  files: TFile[],
  currentProjectId?: string
): Promise<TFile[]> {
  const results = await Promise.all(
    files.map(async (file) => ({
      file,
      projectId: await readChatFileProjectId(app, file),
    }))
  );

  return results
    .filter(({ file, projectId }) => {
      if (currentProjectId) {
        if (projectId === currentProjectId) return true;
        // Reason: legacy files may lack projectId frontmatter; only include them
        // if the basename matches this project's prefix to avoid leaking unrelated chats.
        if (projectId === undefined) {
          const sanitizedPrefix = `${sanitizeVaultPathSegment(currentProjectId)}__`;
          const rawPrefix = `${currentProjectId}__`;
          return file.basename.startsWith(sanitizedPrefix) || file.basename.startsWith(rawPrefix);
        }
        return false;
      }
      // Reason: exclude files with projectId OR known project prefix in filename
      return !projectId && !hasKnownProjectPrefix(file.basename);
    })
    .map(({ file }) => file);
}

/**
 * Extract chat title from a file.
 * First checks frontmatter.topic, then extracts from filename by removing
 * project ID prefix, date/time patterns, and normalizing separators.
 */
export function extractChatTitle(file: TFile): string {
  // Read the file's front matter
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

  // First check if there's a custom topic in frontmatter
  if (frontmatter?.topic && typeof frontmatter.topic === "string" && frontmatter.topic.trim()) {
    return frontmatter.topic.trim();
  }

  // Fallback to extracting from filename
  // Reason: use the exact frontmatter projectId to strip the prefix precisely,
  // rather than guessing which characters the sanitized prefix may contain.
  // Coerce numeric IDs (YAML parses unquoted digits as numbers).
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
    // Reason: hidden-directory files have no metadataCache entry, so projectId
    // is unavailable. Fall back to heuristic regex to strip common prefixes.
    basename = basename.replace(/^[a-zA-Z0-9_-]+__/, "");
  }

  // Remove {$date} and {$time} parts from the filename
  return basename
    .replace(/\{\$date\}|\d{8}/g, "") // Remove {$date} or date in format YYYYMMDD
    .replace(/\{\$time\}|\d{6}/g, "") // Remove {$time} or time in format HHMMSS
    .replace(/[@_]/g, " ") // Replace @ and _ with spaces
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim();
}

/**
 * Extract chat creation date from a file.
 * Uses frontmatter.epoch if available, falls back to file creation time.
 */
export function extractChatDate(file: TFile): Date {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

  if (frontmatter && frontmatter.epoch) {
    // Use the epoch from front matter if available
    return new Date(frontmatter.epoch as number);
  } else {
    // Fallback to file creation time if epoch is not in front matter
    return new Date(file.stat.ctime);
  }
}

/**
 * Extract chat last accessed time (epoch ms) from a file.
 * Uses frontmatter.lastAccessedAt if available, returns null otherwise.
 */
export function extractChatLastAccessedAtMs(file: TFile): number | null {
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

/**
 * Extract chat last accessed date from a file.
 * Uses extractChatLastAccessedAtMs and returns a Date when available, null otherwise.
 */
export function extractChatLastAccessedAt(file: TFile): Date | null {
  const lastAccessedAtMs = extractChatLastAccessedAtMs(file);
  return lastAccessedAtMs ? new Date(lastAccessedAtMs) : null;
}

/**
 * Get formatted display text for a chat file (title + formatted date).
 * Used in chat history modals and similar UI components.
 */
export function getChatDisplayText(file: TFile): string {
  const title = extractChatTitle(file);
  const date = extractChatDate(file);
  const formattedDateTime = formatDateTime(date);
  return `${title} - ${formattedDateTime.display}`;
}
