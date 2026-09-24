import { COPILOT_CONVERSATION_TAG } from "@/constants";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { buildNativeChatId, isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import { listMarkdownFiles } from "@/utils/vaultAdapterUtils";
import { App, parseYaml, TFile } from "obsidian";

const EPOCH_ID = /^epoch:([1-9]\d*)$/;

async function conversationFiles(app: App): Promise<TFile[]> {
  const folder = getEffectiveConversationsFolder().replace(/\/+$/, "");
  const files = await listMarkdownFiles(app, folder);
  // The vault-cached listing uses a plain prefix, which can include a sibling
  // named "conversations-backup". Keep URI resolution inside the folder.
  // https://github.com/logancyang/obsidian-copilot/issues/3271
  return files.filter((file) => file.path.startsWith(`${folder}/`));
}

function validEpoch(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const epoch = Number(raw);
  return Number.isSafeInteger(epoch) ? epoch : null;
}

async function chatEpoch(app: App, file: TFile): Promise<number | null> {
  // Hidden conversation folders have no metadata cache entry. The adapter read
  // also makes a renamed note's stored identity authoritative.
  // https://github.com/logancyang/obsidian-copilot/issues/3271
  let frontmatter: Record<string, unknown> | null | undefined =
    app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) {
    try {
      const content = await app.vault.adapter.read(file.path);
      const yaml = content
        .replace(/^\uFEFF/, "")
        .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      frontmatter = yaml ? (parseYaml(yaml) as Record<string, unknown> | null) : null;
    } catch {
      return null;
    }
  }
  const tags = frontmatter?.tags;
  if (
    !(Array.isArray(tags) && tags.includes(COPILOT_CONVERSATION_TAG)) &&
    tags !== COPILOT_CONVERSATION_TAG
  )
    return null;
  return validEpoch(frontmatter?.epoch);
}

/** Build a vault-scoped URI containing only a saved chat identity. */
export function buildChatDeepLink(vault: string, id: string): string | null {
  if (!vault || !parseChatDeepLinkId(id)) return null;
  const params = new URLSearchParams({ vault, id });
  return `obsidian://copilot-chat?${params.toString()}`;
}

/** Accept only canonical saved-note epochs or native agent session identities. */
export function parseChatDeepLinkId(id: string): string | null {
  const epoch = EPOCH_ID.exec(id)?.[1];
  if (epoch) return validEpoch(epoch) === null ? null : id;
  if (!isNativeChatId(id)) return null;
  const native = parseNativeChatId(id);
  // A URI must never be interpreted as a path by loadChatById.
  // https://github.com/logancyang/obsidian-copilot/issues/3271
  if (!native || !/^[a-z0-9_-]+$/i.test(native.backendId) || !native.sessionId.trim()) return null;
  // eslint-disable-next-line no-control-regex -- protocol IDs must reject control bytes
  if (/[\u0000-\u001f\u007f]/.test(native.sessionId)) return null;
  return buildNativeChatId(native.backendId, native.sessionId) === id ? id : null;
}

/** Read a saved note's stable identity from the configured conversation folder. */
export async function getSavedChatDeepLinkId(app: App, path: string): Promise<string | null> {
  const files = await conversationFiles(app);
  const file = files.find((candidate) => candidate.path === path);
  if (!file) return null;
  const epoch = await chatEpoch(app, file);
  if (epoch === null) return null;
  // A colliding note would make the copied link ambiguous, so refuse to copy it.
  // https://github.com/logancyang/obsidian-copilot/issues/3271
  for (const candidate of files) {
    if (candidate.path !== path && (await chatEpoch(app, candidate)) === epoch) return null;
  }
  return `epoch:${epoch}`;
}

/** Resolve an epoch only when exactly one saved conversation owns it. */
export async function findChatFileByDeepLinkId(app: App, id: string): Promise<TFile | null> {
  const match = EPOCH_ID.exec(id);
  const epoch = match && validEpoch(match[1]);
  if (epoch === null || !epoch) return null;
  const files = await conversationFiles(app);
  let found: TFile | null = null;
  for (const file of files) {
    if ((await chatEpoch(app, file)) !== epoch) continue;
    // Epoch collisions must fail closed rather than opening the first file.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
    if (found) return null;
    found = file;
  }
  return found;
}
