import { AI_SENDER, USER_SENDER } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { FormattedDateTime } from "@/types/message";
import {
  ensureFolderExists,
  formatDateTime,
  getUtf8ByteLength,
  truncateToByteLimit,
} from "@/utils";
import {
  isFileAlreadyExistsError,
  isInVaultCache,
  isNameTooLongError,
  listMarkdownFiles,
  patchFrontmatter,
  readFrontmatterViaAdapter,
} from "@/utils/vaultAdapterUtils";
import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import type { AgentChatMessage, BackendId } from "./types";

const SAFE_FILENAME_BYTE_LIMIT = 100;
export const AGENT_FILENAME_PREFIX = "agent__";
export const AGENT_CHAT_MODE = "agent";

/**
 * Result of `loadFile` — restores display-only Agent Mode messages plus
 * routing info needed to spawn the right backend session.
 */
export interface LoadedAgentChat {
  messages: AgentChatMessage[];
  backendId: BackendId;
  topic?: string;
  label?: string;
}

interface ExistingMeta {
  topic?: string;
  label?: string;
  lastAccessedAt?: number;
}

/**
 * Escape a string for safe YAML double-quoted string value. Strips control
 * chars (including newlines) up front — a stray `\n` in the user's topic
 * would otherwise terminate the line and corrupt the rest of the frontmatter.
 */
function escapeYamlString(str: string): string {
  return (
    str
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
  );
}

/**
 * Inverse of `escapeYamlString` for the values our hand-rolled frontmatter
 * parser extracts. Only handles the two escapes we emit (`\\` and `\"`).
 */
function unescapeYamlString(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "\\" && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === "\\" || next === '"') {
        out += next;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/**
 * Backend-agnostic on-disk persistence for Agent Mode sessions. Mirrors the
 * legacy `ChatPersistenceManager` shape so a single `ChatHistoryPopover` can
 * render both lists, but with three differences:
 *
 *   1. Files are prefixed with `agent__` so they never collide with legacy
 *      project-prefixed (`{projectId}__`) or unprefixed chats.
 *   2. Frontmatter records `mode: agent` and `backendId: <id>` so the loader
 *      can route a history click to the right backend.
 *   3. No project / AI-topic generation — Agent Mode has no project concept
 *      and no chain manager to generate titles with.
 *
 * Sessions with zero visible messages are never written.
 */
export class AgentChatPersistenceManager {
  constructor(private readonly app: App) {}

  /**
   * Save the supplied messages to disk. Returns the resulting file (or the
   * existing path on hidden-directory writes), or `null` when the session has
   * nothing user-visible to persist.
   *
   * `existingPath` lets the caller pin updates to a previously-saved file so
   * they're applied even if the messages list shrinks below the original
   * `firstMessageEpoch`. When omitted, the file is matched by epoch.
   */
  async saveSession(
    messages: AgentChatMessage[],
    backendId: BackendId,
    options?: { label?: string | null; modelKey?: string; existingPath?: string }
  ): Promise<{ path: string } | null> {
    if (messages.length === 0) return null;

    try {
      const settings = getSettings();
      const chatContent = this.formatChatContent(messages);
      const firstMessageEpoch = messages[0].timestamp?.epoch ?? Date.now();

      await ensureFolderExists(settings.defaultSaveFolder);

      const existingFile = options?.existingPath
        ? this.resolveExistingFile(options.existingPath)
        : null;
      const existingMeta = existingFile ? await this.readExistingMeta(existingFile) : {};

      const preferredFileName = existingFile
        ? existingFile.path
        : this.generateFileName(messages, firstMessageEpoch, existingMeta.topic);

      const noteContent = this.generateNoteContent({
        chatContent,
        firstMessageEpoch,
        backendId,
        topic: existingMeta.topic,
        label: options?.label ?? existingMeta.label,
        modelKey: options?.modelKey,
        lastAccessedAt: existingMeta.lastAccessedAt,
      });

      if (existingFile && isInVaultCache(this.app, existingFile.path)) {
        await this.app.vault.modify(existingFile, noteContent);
        return { path: existingFile.path };
      }

      if (
        !isInVaultCache(this.app, preferredFileName) &&
        (await this.app.vault.adapter.exists(preferredFileName))
      ) {
        await this.app.vault.adapter.write(preferredFileName, noteContent);
        return { path: preferredFileName };
      }

      try {
        const created = await this.app.vault.create(preferredFileName, noteContent);
        return { path: created.path };
      } catch (err) {
        if (isFileAlreadyExistsError(err)) {
          await this.app.vault.adapter.write(preferredFileName, noteContent);
          return { path: preferredFileName };
        }
        if (isNameTooLongError(err)) {
          logWarn("[AgentChatPersistenceManager] Filename too long, falling back to minimal name");
          const fallback = `${settings.defaultSaveFolder}/${AGENT_FILENAME_PREFIX}chat-${firstMessageEpoch}.md`;
          try {
            const created = await this.app.vault.create(fallback, noteContent);
            return { path: created.path };
          } catch (fallbackErr) {
            if (isFileAlreadyExistsError(fallbackErr)) {
              await this.app.vault.adapter.write(fallback, noteContent);
              return { path: fallback };
            }
            throw fallbackErr;
          }
        }
        throw err;
      }
    } catch (error) {
      logError("[AgentChatPersistenceManager] Error saving session:", error);
      return null;
    }
  }

  /**
   * Parse a saved agent chat file back into `AgentChatMessage`s and routing
   * info. Tool/plan/thought parts are not restored — the markdown format only
   * preserves sender + text (display-only history, mirroring legacy mode).
   */
  async loadFile(file: TFile): Promise<LoadedAgentChat> {
    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch {
      content = await this.app.vault.adapter.read(file.path);
    }

    const { frontmatter, body } = this.splitFrontmatter(content);
    const backendId = (frontmatter.backendId ?? "").trim();
    if (!backendId) {
      throw new Error(`Missing backendId in agent chat frontmatter: ${file.path}`);
    }
    const topic = frontmatter.topic?.trim() || undefined;
    const label = frontmatter.agentLabel?.trim() || undefined;
    const messages = this.parseChatBody(body);

    logInfo(
      `[AgentChatPersistenceManager] Loaded ${messages.length} messages from ${file.path} (backend=${backendId})`
    );
    return { messages, backendId, topic, label };
  }

  /**
   * List every persisted Agent Mode chat file (across all backends). Filters
   * by the `agent__` filename prefix so the result is backend-agnostic and
   * never collides with legacy or project chats.
   */
  async getAgentChatHistoryFiles(): Promise<TFile[]> {
    const settings = getSettings();
    const files = await listMarkdownFiles(this.app, settings.defaultSaveFolder);
    return files.filter((file) => file.basename.startsWith(AGENT_FILENAME_PREFIX));
  }

  /** Update the user-visible topic in frontmatter. */
  async updateTopic(fileId: string, newTopic: string): Promise<void> {
    await patchFrontmatter(this.app, fileId, { topic: newTopic.trim() });
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file) {
      await this.app.vault.delete(file as TFile);
      new Notice("Chat deleted.");
      return;
    }
    if (await this.app.vault.adapter.exists(fileId)) {
      await this.app.vault.adapter.remove(fileId);
      new Notice("Chat deleted.");
      return;
    }
    throw new Error("Chat file not found.");
  }

  private resolveExistingFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file ? (file as TFile) : null;
  }

  private async readExistingMeta(file: TFile): Promise<ExistingMeta> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached) {
      return {
        topic: cached.topic,
        label: cached.agentLabel,
        lastAccessedAt:
          typeof cached.lastAccessedAt === "number" ? cached.lastAccessedAt : undefined,
      };
    }
    try {
      const fm = await readFrontmatterViaAdapter(this.app, file.path);
      if (!fm) return {};
      const lastAccessed = fm.lastAccessedAt ? Number(fm.lastAccessedAt) : undefined;
      return {
        topic: fm.topic,
        label: fm.agentLabel,
        lastAccessedAt: lastAccessed && Number.isFinite(lastAccessed) ? lastAccessed : undefined,
      };
    } catch {
      return {};
    }
  }

  private formatChatContent(messages: AgentChatMessage[]): string {
    return messages
      .map((m) => {
        const ts = m.timestamp ? m.timestamp.display : "Unknown time";
        return `**${m.sender}**: ${m.message}\n[Timestamp: ${ts}]`;
      })
      .join("\n\n");
  }

  private parseChatBody(body: string): AgentChatMessage[] {
    const messages: AgentChatMessage[] = [];
    const pattern = /\*\*(user|ai)\*\*: ([\s\S]*?)(?=(?:\n\*\*(?:user|ai)\*\*: )|$)/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const sender = match[1] === "user" ? USER_SENDER : AI_SENDER;
      const fullContent = match[2].trim();

      const lines = fullContent.split("\n");
      let endIndex = lines.length;
      let timestampStr = "Unknown time";

      if (lines[endIndex - 1]?.startsWith("[Timestamp: ")) {
        const tsMatch = lines[endIndex - 1].match(/\[Timestamp: (.*?)\]/);
        if (tsMatch) {
          timestampStr = tsMatch[1];
          endIndex--;
        }
      }

      const messageText = lines.slice(0, endIndex).join("\n").trim();

      let timestamp: FormattedDateTime | null = null;
      if (timestampStr !== "Unknown time") {
        const date = new Date(timestampStr);
        if (!isNaN(date.getTime())) {
          timestamp = {
            epoch: date.getTime(),
            display: timestampStr,
            fileName: "",
          };
        }
      }

      // Deterministic id: stable across reloads so React keeps message
      // identity when the UI re-renders the same loaded chat. Uses the
      // message's own epoch when present, falling back to the index.
      const id = timestamp
        ? `loaded-${messages.length}-${timestamp.epoch}`
        : `loaded-${messages.length}`;
      messages.push({
        id,
        message: messageText,
        sender,
        isVisible: true,
        timestamp,
      });
    }
    return messages;
  }

  private splitFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { frontmatter: {}, body: content };
    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (!m) continue;
      const raw = m[2].trim();
      // Unquote and unescape: only double-quoted values were escaped on save,
      // so single-quoted / unquoted values are returned verbatim.
      let value: string;
      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        value = unescapeYamlString(raw.slice(1, -1));
      } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
        value = raw.slice(1, -1);
      } else {
        value = raw;
      }
      frontmatter[m[1]] = value;
    }
    return { frontmatter, body: content.slice(match[0].length).trim() };
  }

  private generateFileName(
    messages: AgentChatMessage[],
    firstMessageEpoch: number,
    topic?: string
  ): string {
    const settings = getSettings();
    const formatted = formatDateTime(new Date(firstMessageEpoch));
    const timestampFileName = formatted.fileName;

    let topicForFilename: string;
    if (topic) {
      topicForFilename = topic;
    } else {
      const firstUser = messages.find((m) => m.sender === USER_SENDER);
      topicForFilename = firstUser
        ? firstUser.message
            .replace(/\[\[([^\]]+)\]\]/g, "$1")
            .replace(/[{}[\]]/g, "")
            .split(/\s+/)
            .slice(0, 10)
            .join(" ")
            // eslint-disable-next-line no-control-regex
            .replace(/[\\/:*?"<>|\x00-\x1F]/g, "")
            .trim() || "Untitled Agent Chat"
        : "Untitled Agent Chat";
    }

    let customFileName = settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}";
    const filePrefix = AGENT_FILENAME_PREFIX;

    const extensionBytes = getUtf8ByteLength(".md");
    const filePrefixBytes = getUtf8ByteLength(filePrefix);

    const formatOverhead = customFileName
      .replace("{$topic}", "")
      .replace("{$date}", timestampFileName.split("_")[0])
      .replace("{$time}", timestampFileName.split("_")[1]);
    const formatOverheadBytes = getUtf8ByteLength(formatOverhead);

    const topicByteBudget = Math.max(
      20,
      SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes - formatOverheadBytes
    );

    const topicWithUnderscores = topicForFilename.replace(/\s+/g, "_");
    const truncatedTopic = truncateToByteLimit(topicWithUnderscores, topicByteBudget);

    customFileName = customFileName
      .replace("{$topic}", truncatedTopic)
      .replace("{$date}", timestampFileName.split("_")[0])
      .replace("{$time}", timestampFileName.split("_")[1]);

    const sanitizedFileName = customFileName
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/[{}[\]]/g, "_")
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_");

    const baseNameWithPrefix = `${filePrefix}${sanitizedFileName}.md`;
    if (getUtf8ByteLength(baseNameWithPrefix) > SAFE_FILENAME_BYTE_LIMIT) {
      const availableForBasename = SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes;
      const truncatedBasename = truncateToByteLimit(sanitizedFileName, availableForBasename);
      return `${settings.defaultSaveFolder}/${filePrefix}${truncatedBasename}.md`;
    }

    return `${settings.defaultSaveFolder}/${baseNameWithPrefix}`;
  }

  private generateNoteContent(args: {
    chatContent: string;
    firstMessageEpoch: number;
    backendId: BackendId;
    topic?: string;
    label?: string | null;
    modelKey?: string;
    lastAccessedAt?: number;
  }): string {
    const settings = getSettings();
    const lines: string[] = [
      "---",
      `epoch: ${args.firstMessageEpoch}`,
      `mode: ${AGENT_CHAT_MODE}`,
      `backendId: ${args.backendId}`,
    ];
    if (args.topic) lines.push(`topic: "${escapeYamlString(args.topic)}"`);
    if (args.label) lines.push(`agentLabel: "${escapeYamlString(args.label)}"`);
    if (args.modelKey) lines.push(`modelKey: "${escapeYamlString(args.modelKey)}"`);
    if (args.lastAccessedAt) lines.push(`lastAccessedAt: ${args.lastAccessedAt}`);
    lines.push("tags:");
    lines.push(`  - ${settings.defaultConversationTag}`);
    lines.push("---");
    lines.push("");
    lines.push(args.chatContent);
    return lines.join("\n");
  }
}
