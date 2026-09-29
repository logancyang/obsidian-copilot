import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { listMarkdownFiles, readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { App, TFile } from "obsidian";

const EPOCH_ID = /^epoch:(\d+)$/;

async function readEpoch(app: App, path: string): Promise<number | null> {
  let epoch: unknown = app.metadataCache.getCache(path)?.frontmatter?.epoch;
  // Hidden conversation folders have no metadata cache entry, so their links need the note read from disk.
  // https://github.com/logancyang/obsidian-copilot/issues/3271
  if (epoch === undefined) {
    try {
      epoch = (await readFrontmatterViaAdapter(app, path))?.epoch;
    } catch {
      return null;
    }
  }
  const value = Number(epoch);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function buildChatDeepLink(vault: string, id: string): string {
  return `obsidian://copilot-chat?${new URLSearchParams({ vault, id }).toString()}`;
}

export async function getSavedChatDeepLinkId(app: App, path: string): Promise<string | null> {
  const epoch = await readEpoch(app, path);
  return epoch === null ? null : `epoch:${epoch}`;
}

export async function findChatFileByDeepLinkId(app: App, id: string): Promise<TFile | null> {
  const epoch = Number(EPOCH_ID.exec(id)?.[1]);
  if (!epoch) return null;
  const folder = getEffectiveConversationsFolder();
  let found: TFile | null = null;
  for (const file of await listMarkdownFiles(app, folder)) {
    // The listing matches by plain prefix and also returns siblings such as "conversations-backup"; continuing a chat there would overwrite it.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
    if (!file.path.startsWith(`${folder}/`)) continue;
    if ((await readEpoch(app, file.path)) !== epoch) continue;
    // A duplicated note or sync conflict copy keeps the epoch; opening either could autosave into the wrong transcript.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
    if (found) return null;
    found = file;
  }
  return found;
}
