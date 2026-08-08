import { type ContextCache, getFileCacheRef } from "@/cache/projectContextCache";
import { CachePreviewModal } from "@/components/modals/CachePreviewModal";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { cacheFileName } from "@/context/contextCacheStore";
import { logError } from "@/logger";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { isMissingFileError } from "@/utils/isMissingFileError";
import { App, Notice } from "obsidian";

/**
 * Open a preview modal for a cached project file (file-only).
 * Kept for backwards compatibility with context-manage-modal.
 *
 * @param app - Obsidian App instance
 * @param cache - Already-loaded ContextCache for the project
 * @param filePath - Original source file path
 * @param displayName - Human-readable name for modal title
 */
export async function openCachedProjectFile(
  app: App,
  cache: ContextCache | null | undefined,
  filePath: string,
  displayName: string
): Promise<void> {
  const ref = getFileCacheRef(cache, filePath);
  if (!ref) {
    new Notice("No cached content available for this file.");
    return;
  }

  const exists = await app.vault.adapter.exists(ref.cachePath);
  if (!exists) {
    new Notice("Cache expired. Please re-process the file.");
    return;
  }

  try {
    const content = await app.vault.adapter.read(ref.cachePath);
    new CachePreviewModal(app, displayName, content).open();
  } catch (error) {
    logError(`Failed to read cached content for ${filePath}:`, error);
    new Notice("Failed to read cached content.");
  }
}

/**
 * Open a preview modal for any cached project item (file, web URL, or YouTube URL).
 * Reads content from the appropriate cache bucket based on item.cacheKind.
 *
 * @param app - Obsidian App instance
 * @param cache - Already-loaded ContextCache for the project
 * @param item - ProcessingItem with id, name, and cacheKind
 */
export async function openCachedItemPreview(
  app: App,
  cache: ContextCache | null | undefined,
  item: Pick<ProcessingItem, "id" | "name" | "cacheKind">
): Promise<void> {
  if (!cache) {
    new Notice("No cached content available.");
    return;
  }

  let content: string | null = null;

  switch (item.cacheKind) {
    case "web":
      content = cache.webContexts?.[item.id] ?? null;
      break;
    case "youtube":
      content = cache.youtubeContexts?.[item.id] ?? null;
      break;
    case "file": {
      const ref = getFileCacheRef(cache, item.id);
      if (!ref) {
        new Notice("No cached content available for this file.");
        return;
      }
      const exists = await app.vault.adapter.exists(ref.cachePath);
      if (!exists) {
        new Notice("Cache expired. Please re-process the file.");
        return;
      }
      try {
        content = await app.vault.adapter.read(ref.cachePath);
      } catch (error) {
        logError(`Failed to read cached file: ${ref.cachePath}`, error);
        new Notice("Failed to read cached content.");
        return;
      }
      break;
    }
  }

  if (!content || !content.trim()) {
    new Notice("No content available for this item.");
    return;
  }

  new CachePreviewModal(app, item.name, content).open();
}

/**
 * Open a preview for an AGENT project's converted snapshot — the agent-mode
 * counterpart to {@link openCachedItemPreview}. The agent pipeline stores each
 * source's materialized text in the shared OFF-VAULT conversion cache: remote
 * snapshots under `remotes/`, converted vault files under `files/` (keyed by
 * source identity, not project). Read the file, hand it to {@link CachePreviewModal}.
 * The snapshot's leading `<!-- copilot-context-cache … -->` block is an HTML
 * comment, so the markdown preview hides it and its `# File/URL:` header renders
 * as a heading — no special stripping needed.
 *
 * MOBILE BOUNDARY (design §3.4, invariant 4): this util is statically imported
 * into the mobile bundle (via the shared ContextManageModal), so it must not
 * statically import `conversionsLocation`/`contextCacheFs` (which evaluate Node
 * builtins). They are loaded only behind the desktop gate via dynamic import;
 * mobile has no Agent Mode, so the preview is desktop-only.
 */
export async function openAgentCachedItemPreview(
  app: App,
  item: Pick<ProcessingItem, "id" | "name" | "cacheKind">
): Promise<void> {
  if (!isDesktopRuntime()) {
    new Notice("Converted previews are available on desktop only.");
    return;
  }
  const fileName = cacheFileName(item.cacheKind, item.id);
  // Read directly instead of an exists()+read() round-trip: a missing snapshot
  // throws, and we map that back to the "not converted yet" message below.
  try {
    const { remotesDir, filesDir } = await import("@/context/conversionsLocation");
    const { createNodeContextCacheFs } = await import("@/context/contextCacheFs");
    const dir = item.cacheKind === "file" ? filesDir(app) : remotesDir(app);
    // The fs is rooted AT the snapshot's bucket, so the read is `readText(name)`.
    const content = await createNodeContextCacheFs(dir).readText(fileName);
    if (!content.trim()) {
      new Notice("No content available for this item.");
      return;
    }
    new CachePreviewModal(app, item.name, content).open();
  } catch (error) {
    if (isMissingFileError(error)) {
      new Notice("No converted content yet for this item.");
      return;
    }
    logError(`Failed to read agent cached snapshot: ${fileName}`, error);
    new Notice("Failed to read converted content.");
  }
}
