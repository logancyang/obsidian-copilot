import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { listMarkdownFiles, readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { App, TFile } from "obsidian";

const EPOCH_ID = /^epoch:(\d+)$/;

async function readEpoch(app: App, path: string): Promise<number | null> {
  let epoch: unknown = app.metadataCache.getCache(path)?.frontmatter?.epoch;
  // Hidden conversation folders have no metadata cache entry.
  if (epoch === undefined) {
    try {
      epoch = (await readFrontmatterViaAdapter(app, path))?.epoch;
    } catch {
      return null;
    }
  }
  const value = Number(epoch);
  return value > 0 ? value : null;
}

/** Build a vault-scoped URI for a saved chat epoch or native agent session id. */
export function buildChatDeepLink(vault: string, id: string): string {
  return `obsidian://copilot-chat?${new URLSearchParams({ vault, id }).toString()}`;
}

/**
 * Read a saved chat's frontmatter epoch as a link id, so the link survives
 * renaming the note.
 * @param path - Vault path of the saved conversation note.
 */
export async function getSavedChatDeepLinkId(app: App, path: string): Promise<string | null> {
  const epoch = await readEpoch(app, path);
  return epoch === null ? null : `epoch:${epoch}`;
}

/**
 * Find the saved conversation note a link id points to.
 * @param id - Link id produced by {@link getSavedChatDeepLinkId}.
 */
export async function findChatFileByDeepLinkId(app: App, id: string): Promise<TFile | null> {
  const epoch = Number(EPOCH_ID.exec(id)?.[1]);
  if (!epoch) return null;
  for (const file of await listMarkdownFiles(app, getEffectiveConversationsFolder())) {
    if ((await readEpoch(app, file.path)) === epoch) return file;
  }
  return null;
}
