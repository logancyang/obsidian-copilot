import { CachePreviewModal } from "@/components/modals/CachePreviewModal";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { cacheFileName } from "@/context/contextCacheStore";
import { logError } from "@/logger";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { isMissingFileError } from "@/utils/isMissingFileError";
import { App, Notice } from "obsidian";

/**
 * Open a preview for an AGENT project's converted snapshot — the agent-mode
 * counterpart of a vault-cache preview. The agent pipeline stores each
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
