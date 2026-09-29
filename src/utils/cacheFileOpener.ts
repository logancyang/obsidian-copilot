import { CachePreviewModal } from "@/components/modals/CachePreviewModal";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { cacheFileName } from "@/context/contextCacheStore";
import { logError } from "@/logger";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { isMissingFileError } from "@/utils/isMissingFileError";
import { App, Notice } from "obsidian";

export async function openAgentCachedItemPreview(
  app: App,
  item: Pick<ProcessingItem, "id" | "name" | "cacheKind">
): Promise<void> {
  if (!isDesktopRuntime()) {
    new Notice("Converted previews are available on desktop only.");
    return;
  }
  const fileName = cacheFileName(item.cacheKind, item.id);
  try {
    const { remotesDir, filesDir } = await import("@/context/conversionsLocation");
    const { createNodeContextCacheFs } = await import("@/context/contextCacheFs");
    const dir = item.cacheKind === "file" ? filesDir(app) : remotesDir(app);
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
