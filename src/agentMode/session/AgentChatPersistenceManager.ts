import { AI_SENDER, USER_SENDER } from "@/constants";
import { logError, logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import {
  ensureFolderExists,
  formatDateTime,
  getUtf8ByteLength,
  truncateToByteLimit,
} from "@/utils";
import {
  isInVaultCache,
  listMarkdownFiles,
  patchFrontmatter,
  readFrontmatterViaAdapter,
} from "@/utils/vaultAdapterUtils";
import { App, Notice, TFile } from "obsidian";
import type { AgentChatMessage, NewAgentChatMessage } from "./types";
import type { BackendId } from "@/agentMode/acp/types";

const SAFE_FILENAME_BYTE_LIMIT = 100;

/** Filename prefix that marks a markdown file as an Agent Mode chat. */
export const AGENT_CHAT_FILE_PREFIX = "agent__";

/** Frontmatter discriminator value for `mode`. */
const AGENT_MODE_FRONTMATTER_VALUE = "agent";

function escapeYamlString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Parsed payload returned by `loadFile` — matches what `AgentSessionManager` needs to seed a new session. */
export interface LoadedAgentChat {
  /** Parsed messages without ids — the consuming `AgentMessageStore` assigns ids on load. */
  messages: NewAgentChatMessage[];
  backendId: BackendId | null;
  topic?: string;
  label?: string;
  modelKey?: string;
  epoch: number;
}

/** Snapshot the persistence manager needs to write a session to disk. */
export interface AgentChatSaveSnapshot {
  /** Visible messages in display order. Persistence is skipped when this is empty. */
  messages: AgentChatMessage[];
  backendId: BackendId;
  /** Optional sticky tab label set by the user or pushed by the agent. */
  label?: string | null;
  /** Optional agent-native model id, recorded for debugging — not used on load. */
  modelKey?: string | null;
}

/**
 * Persists Agent Mode chat sessions to markdown files in the configured save
 * folder. Files are tagged with an `agent__` filename prefix and a `mode: agent`
 * frontmatter discriminator so they can be filtered out of the legacy chat
 * history list.
 *
 * Designed to be backend-agnostic: the `backendId` is recorded in frontmatter
 * for routing on load, but listing is unified across all registered backends.
 */
export class AgentChatPersistenceManager {
  constructor(private readonly app: App) {}

  /**
   * Save a session snapshot to disk. Returns the resulting `TFile` (or `null`
   * when the snapshot has no visible messages — empty sessions never persist).
   *
   * If `existingPath` points to a previously written file, that file is
   * updated in place. Otherwise a fresh filename is generated based on the
   * snapshot's first user message.
   */
  async save(snapshot: AgentChatSaveSnapshot, existingPath?: string): Promise<TFile | null> {
    if (snapshot.messages.length === 0) return null;

    try {
      const settings = getSettings();
      await ensureFolderExists(settings.defaultSaveFolder);

      const firstEpoch = this.firstMessageEpoch(snapshot.messages);
      const existingFile = existingPath ? this.app.vault.getAbstractFileByPath(existingPath) : null;
      const existingTopic = await this.readExistingTopic(existingPath, existingFile);
      const existingLastAccessedAt = await this.readExistingLastAccessedAt(
        existingPath,
        existingFile
      );

      const targetPath =
        existingFile instanceof TFile
          ? existingFile.path
          : existingPath && (await this.app.vault.adapter.exists(existingPath))
            ? existingPath
            : this.generateFileName(snapshot.messages, firstEpoch, existingTopic);

      const noteContent = this.generateNoteContent(snapshot, firstEpoch, {
        topic: existingTopic,
        lastAccessedAt: existingLastAccessedAt,
      });

      if (existingFile instanceof TFile && isInVaultCache(this.app, existingFile.path)) {
        await this.app.vault.modify(existingFile, noteContent);
        return existingFile;
      }

      if (
        !isInVaultCache(this.app, targetPath) &&
        (await this.app.vault.adapter.exists(targetPath))
      ) {
        await this.app.vault.adapter.write(targetPath, noteContent);
        return null;
      }

      try {
        const created = await this.app.vault.create(targetPath, noteContent);
        return created;
      } catch (error) {
        if (this.isFileAlreadyExistsError(error)) {
          const existing = this.app.vault.getAbstractFileByPath(targetPath);
          if (existing instanceof TFile) {
            await this.app.vault.modify(existing, noteContent);
            return existing;
          }
          await this.app.vault.adapter.write(targetPath, noteContent);
          return null;
        }
        if (this.isNameTooLongError(error)) {
          const fallback = `${settings.defaultSaveFolder}/${AGENT_CHAT_FILE_PREFIX}chat-${firstEpoch}.md`;
          try {
            return await this.app.vault.create(fallback, noteContent);
          } catch (fallbackError) {
            if (this.isFileAlreadyExistsError(fallbackError)) {
              const existing = this.app.vault.getAbstractFileByPath(fallback);
              if (existing instanceof TFile) {
                await this.app.vault.modify(existing, noteContent);
                return existing;
              }
              await this.app.vault.adapter.write(fallback, noteContent);
              return null;
            }
            throw fallbackError;
          }
        }
        throw error;
      }
    } catch (error) {
      logError("[AgentChatPersistenceManager] Error saving session:", error);
      new Notice("Failed to save agent chat. Check console for details.");
      return null;
    }
  }

  /**
   * Read a saved agent chat file and return the parsed payload. Returns `null`
   * when the file isn't an Agent Mode file (no `mode: agent` frontmatter).
   */
  async loadFile(file: TFile): Promise<LoadedAgentChat | null> {
    try {
      let content: string;
      try {
        content = await this.app.vault.read(file);
      } catch {
        content = await this.app.vault.adapter.read(file.path);
      }

      const frontmatter = await this.readFrontmatter(file);
      if (frontmatter?.mode && frontmatter.mode !== AGENT_MODE_FRONTMATTER_VALUE) return null;

      const messages = this.parseChatBody(content);
      const epoch = Number(frontmatter?.epoch);
      logInfo(`[AgentChatPersistenceManager] Loaded ${messages.length} messages from ${file.path}`);
      return {
        messages,
        backendId: (frontmatter?.backendId as BackendId | undefined) ?? null,
        topic: frontmatter?.topic,
        label: frontmatter?.agentLabel,
        modelKey: frontmatter?.modelKey,
        epoch: Number.isFinite(epoch) && epoch > 0 ? epoch : file.stat.ctime,
      };
    } catch (error) {
      logError("[AgentChatPersistenceManager] Error loading file:", error);
      new Notice("Failed to load agent chat. Check console for details.");
      return null;
    }
  }

  /**
   * List all agent chat files in the configured save folder, regardless of
   * which backend produced them. Filtering is filename-prefix based to avoid
   * reading every file's frontmatter just to build the list.
   */
  async listFiles(): Promise<TFile[]> {
    const settings = getSettings();
    const files = await listMarkdownFiles(this.app, settings.defaultSaveFolder);
    return files.filter((f) => f.basename.startsWith(AGENT_CHAT_FILE_PREFIX));
  }

  private async readFrontmatter(file: TFile): Promise<Record<string, any> | null> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached) return cached;
    try {
      return await readFrontmatterViaAdapter(this.app, file.path);
    } catch {
      return null;
    }
  }

  private async readExistingTopic(
    path: string | undefined,
    file: ReturnType<App["vault"]["getAbstractFileByPath"]>
  ): Promise<string | undefined> {
    if (!path) return undefined;
    if (file instanceof TFile) {
      const fm = await this.readFrontmatter(file);
      return fm?.topic;
    }
    try {
      const fm = await readFrontmatterViaAdapter(this.app, path);
      return fm?.topic;
    } catch {
      return undefined;
    }
  }

  private async readExistingLastAccessedAt(
    path: string | undefined,
    file: ReturnType<App["vault"]["getAbstractFileByPath"]>
  ): Promise<number | undefined> {
    if (!path) return undefined;
    if (file instanceof TFile) {
      const fm = await this.readFrontmatter(file);
      const value = Number(fm?.lastAccessedAt);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    }
    try {
      const fm = await readFrontmatterViaAdapter(this.app, path);
      const value = Number(fm?.lastAccessedAt);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private firstMessageEpoch(messages: AgentChatMessage[]): number {
    for (const msg of messages) {
      if (msg.timestamp?.epoch) return msg.timestamp.epoch;
    }
    return Date.now();
  }

  private generateNoteContent(
    snapshot: AgentChatSaveSnapshot,
    firstEpoch: number,
    preserved: { topic?: string; lastAccessedAt?: number }
  ): string {
    const settings = getSettings();
    const topic = preserved.topic;
    const label = snapshot.label?.trim();
    const modelKey = snapshot.modelKey?.trim();
    const lastAccessedAt = preserved.lastAccessedAt;

    const frontmatterLines = [
      `epoch: ${firstEpoch}`,
      `mode: ${AGENT_MODE_FRONTMATTER_VALUE}`,
      `backendId: ${snapshot.backendId}`,
    ];
    if (topic) frontmatterLines.push(`topic: "${escapeYamlString(topic)}"`);
    if (label) frontmatterLines.push(`agentLabel: "${escapeYamlString(label)}"`);
    if (modelKey) frontmatterLines.push(`modelKey: "${escapeYamlString(modelKey)}"`);
    if (lastAccessedAt) frontmatterLines.push(`lastAccessedAt: ${lastAccessedAt}`);
    frontmatterLines.push("tags:");
    frontmatterLines.push(`  - ${settings.defaultConversationTag}`);

    const body = this.formatChatBody(snapshot.messages);
    return `---\n${frontmatterLines.join("\n")}\n---\n\n${body}`;
  }

  private formatChatBody(messages: AgentChatMessage[]): string {
    return messages
      .map((message) => {
        const timestamp = message.timestamp?.display ?? "Unknown time";
        const sender = message.sender;
        return `**${sender}**: ${message.message}\n[Timestamp: ${timestamp}]`;
      })
      .join("\n\n");
  }

  /**
   * Parse the markdown body into `AgentChatMessage` objects. Tool / plan /
   * thought parts are not restored because they're display-only and don't
   * survive a serialize/parse round-trip; the saved view is plain text.
   */
  private parseChatBody(content: string): NewAgentChatMessage[] {
    const stripped = content.replace(/^---\n[\s\S]*?\n---/, "").trim();
    const messages: NewAgentChatMessage[] = [];
    const pattern = /\*\*(user|ai)\*\*: ([\s\S]*?)(?=(?:\n\*\*(?:user|ai)\*\*: )|$)/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      const sender = match[1] === "user" ? USER_SENDER : AI_SENDER;
      const lines = match[2].trim().split("\n");
      let timestamp: string | undefined;
      let endIndex = lines.length;
      const last = lines[endIndex - 1];
      if (last?.startsWith("[Timestamp: ")) {
        const ts = last.match(/\[Timestamp: (.*?)\]/);
        if (ts) {
          timestamp = ts[1];
          endIndex--;
        }
      }
      const messageText = lines.slice(0, endIndex).join("\n").trim();
      const epoch = timestamp ? Date.parse(timestamp) : NaN;

      messages.push({
        message: messageText,
        sender,
        isVisible: true,
        timestamp:
          timestamp && Number.isFinite(epoch) ? { epoch, display: timestamp, fileName: "" } : null,
      });
    }
    return messages;
  }

  /**
   * Build a fresh filename from the first user message. Mirrors the budget
   * logic in `ChatPersistenceManager.generateFileName` — same `defaultSaveFolder`,
   * same `defaultConversationNoteName` template, but with `agent__` prefix
   * instead of a project id prefix.
   */
  private generateFileName(
    messages: AgentChatMessage[],
    firstEpoch: number,
    topic?: string
  ): string {
    const settings = getSettings();
    const formatted = formatDateTime(new Date(firstEpoch));
    const [date, time] = formatted.fileName.split("_");

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
            .trim() || "Untitled Chat"
        : "Untitled Chat";
    }

    let template = settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}";
    const filePrefix = AGENT_CHAT_FILE_PREFIX;
    const extensionBytes = getUtf8ByteLength(".md");
    const filePrefixBytes = getUtf8ByteLength(filePrefix);
    const overhead = template
      .replace("{$topic}", "")
      .replace("{$date}", date)
      .replace("{$time}", time);
    const overheadBytes = getUtf8ByteLength(overhead);
    const topicBudget = Math.max(
      20,
      SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes - overheadBytes
    );
    const truncatedTopic = truncateToByteLimit(topicForFilename.replace(/\s+/g, "_"), topicBudget);

    template = template
      .replace("{$topic}", truncatedTopic)
      .replace("{$date}", date)
      .replace("{$time}", time);

    const sanitized = template
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/[{}[\]]/g, "_")
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_");

    const basename = `${filePrefix}${sanitized}.md`;
    if (getUtf8ByteLength(basename) > SAFE_FILENAME_BYTE_LIMIT) {
      const available = SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes;
      const truncated = truncateToByteLimit(sanitized, available);
      return `${settings.defaultSaveFolder}/${filePrefix}${truncated}.md`;
    }
    return `${settings.defaultSaveFolder}/${basename}`;
  }

  /**
   * Update the `topic` frontmatter field. Used by the inline rename in the
   * history popover. Falls back to the adapter when the file lives in a
   * hidden directory not indexed by Obsidian's metadata cache.
   */
  async updateTopic(filePath: string, topic: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile && this.app.fileManager?.processFrontMatter) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.topic = topic;
      });
      return;
    }
    if (await this.app.vault.adapter.exists(filePath)) {
      await patchFrontmatter(this.app, filePath, { topic: topic.trim() });
      return;
    }
    throw new Error("Agent chat file not found.");
  }

  /** Delete a saved agent chat file. */
  async deleteFile(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
      return;
    }
    if (await this.app.vault.adapter.exists(filePath)) {
      await this.app.vault.adapter.remove(filePath);
      return;
    }
    throw new Error("Agent chat file not found.");
  }

  private isFileAlreadyExistsError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return msg.toLowerCase().includes("already exists");
  }

  private isNameTooLongError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    const normalized = msg.toLowerCase();
    return normalized.includes("enametoolong") || normalized.includes("name too long");
  }
}
