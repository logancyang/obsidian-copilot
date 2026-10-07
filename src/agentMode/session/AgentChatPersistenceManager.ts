import type { TAbstractFile } from "obsidian";
import {
  prepareChatImagesForSave,
  stripChatImageReceipts,
  updateChatTranscript,
} from "@/utils/chatImagePersistence";
import { serializeFanoutComposite } from "@/agentMode/session/fanout/fanoutTypes";
import { AGENT_CHAT_MODE, AI_SENDER, COPILOT_CONVERSATION_TAG, USER_SENDER } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
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
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { joinPosix } from "@/utils/pathUtils";
import { TFile, type App } from "obsidian";
import { Notice } from "obsidian";
import { coerceProjectId, escapeYamlString, unescapeYamlString } from "./agentChatYaml";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage, BackendId, SessionUsage } from "./types";

const SAFE_FILENAME_BYTE_LIMIT = 100;
const AGENT_FILENAME_PREFIX = "agent__";

function parseUsageJson(raw: unknown): SessionUsage | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SessionUsage).usedTokens === "number" &&
      typeof (parsed as SessionUsage).updatedAt === "number"
    ) {
      return parsed as SessionUsage;
    }
  } catch {
    return undefined;
  }
}

export interface LoadedAgentChat {
  messages: AgentChatMessage[];
  backendId: BackendId;
  topic?: string;
  label?: string;
  sessionId?: string;
  projectId: string;
  usage?: SessionUsage;
}

interface ExistingMeta {
  topic?: string;
  label?: string;
  lastAccessedAt?: number;
  sessionId?: string;
  projectId?: string;
  usage?: SessionUsage;
}

export class AgentChatPersistenceManager {
  private readonly loadedTranscripts = new Map<TAbstractFile | string, string>();

  constructor(private readonly app: App) {}

  private async updateTranscript(path: string, content: string): Promise<void> {
    const key = this.app.vault.getAbstractFileByPath(path) ?? path;
    const baseline = await updateChatTranscript(
      this.app,
      path,
      content,
      this.loadedTranscripts.get(key)
    );
    this.loadedTranscripts.set(key, baseline);
  }

  async saveSession(
    messages: AgentChatMessage[],
    backendId: BackendId,
    options?: {
      label?: string | null;
      modelKey?: string;
      existingPath?: string;
      sessionId?: string | null;
      projectId?: string;
      usage?: SessionUsage;
    }
  ): Promise<{ path: string } | null> {
    if (messages.length === 0) return null;

    try {
      const firstMessageEpoch = messages[0].timestamp?.epoch ?? Date.now();

      const conversationsFolder = getEffectiveConversationsFolder();

      await ensureFolderExists(this.app.vault, conversationsFolder);

      const existingFile = options?.existingPath
        ? this.resolveExistingFile(options.existingPath)
        : null;
      const existingMeta = existingFile ? await this.readExistingMeta(existingFile) : {};

      const preferredFileName = existingFile
        ? existingFile.path
        : this.generateFileName(
            messages,
            firstMessageEpoch,
            conversationsFolder,
            existingMeta.topic
          );

      const preparedMessages = await prepareChatImagesForSave(
        this.app,
        messages,
        conversationsFolder,
        (await this.app.vault.adapter.exists(preferredFileName))
          ? await this.app.vault.adapter.read(preferredFileName)
          : "",
        preferredFileName
      );
      const chatContent = this.formatChatContent(preparedMessages);

      const noteContent = this.generateNoteContent({
        chatContent,
        firstMessageEpoch,
        backendId,
        topic: existingMeta.topic,
        label: options?.label ?? existingMeta.label,
        modelKey: options?.modelKey,
        lastAccessedAt: existingMeta.lastAccessedAt,
        sessionId: options?.sessionId ?? existingMeta.sessionId,
        projectId: coerceProjectId(options?.projectId) ?? existingMeta.projectId,
        usage: options?.usage ?? existingMeta.usage,
      });

      if (existingFile && isInVaultCache(this.app, existingFile.path)) {
        await this.updateTranscript(existingFile.path, noteContent);
        return { path: existingFile.path };
      }

      if (
        !isInVaultCache(this.app, preferredFileName) &&
        (await this.app.vault.adapter.exists(preferredFileName))
      ) {
        await this.updateTranscript(preferredFileName, noteContent);
        return { path: preferredFileName };
      }

      try {
        const created = await this.app.vault.create(preferredFileName, noteContent);
        return { path: created.path };
      } catch (err) {
        if (isFileAlreadyExistsError(err)) {
          await this.updateTranscript(preferredFileName, noteContent);
          return { path: preferredFileName };
        }
        if (isNameTooLongError(err)) {
          logWarn("[AgentChatPersistenceManager] Filename too long, falling back to minimal name");
          const fallback = `${conversationsFolder}/${AGENT_FILENAME_PREFIX}chat-${firstMessageEpoch}.md`;
          try {
            const created = await this.app.vault.create(fallback, noteContent);
            return { path: created.path };
          } catch (fallbackErr) {
            if (isFileAlreadyExistsError(fallbackErr)) {
              await this.updateTranscript(fallback, noteContent);
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

  async loadFile(file: TFile): Promise<LoadedAgentChat> {
    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch {
      content = await this.app.vault.adapter.read(file.path);
    }

    const key = this.app.vault.getAbstractFileByPath(file.path) ?? file.path;
    this.loadedTranscripts.set(key, content);
    const { frontmatter, body } = this.splitFrontmatter(content);
    const backendId = (frontmatter.backendId ?? "").trim();
    if (!backendId) {
      throw new Error(`Missing backendId in agent chat frontmatter: ${file.path}`);
    }
    const topic = frontmatter.topic?.trim() || undefined;
    const label = frontmatter.agentLabel?.trim() || undefined;
    const sessionId = frontmatter.sessionId?.trim() || undefined;
    const projectId = frontmatter.projectId?.trim() || GLOBAL_SCOPE;
    const usage = parseUsageJson(frontmatter.usage);
    const epoch = Number(frontmatter.epoch);
    const messages = this.parseChatBody(
      body,
      Number.isFinite(epoch) && epoch > 0 ? epoch : undefined
    );

    logInfo(
      `[AgentChatPersistenceManager] Loaded ${messages.length} messages from ${file.path} (backend=${backendId}, sessionId=${sessionId ?? "none"}, projectId=${projectId})`
    );
    return { messages, backendId, topic, label, sessionId, projectId, usage };
  }

  async getAgentChatHistoryFiles(): Promise<TFile[]> {
    const files = await listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    return files.filter((file) => file.basename.startsWith(AGENT_FILENAME_PREFIX));
  }

  async updateTopic(fileId: string, newTopic: string): Promise<void> {
    await patchFrontmatter(this.app, fileId, { topic: newTopic.trim() });
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file) {
      await trashFile(this.app, file);
      new Notice("Chat moved to trash.");
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
    return file instanceof TFile ? file : null;
  }

  private async readExistingMeta(file: TFile): Promise<ExistingMeta> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached) {
      return {
        topic: cached.topic,
        label: cached.agentLabel,
        lastAccessedAt:
          typeof cached.lastAccessedAt === "number" ? cached.lastAccessedAt : undefined,
        sessionId: typeof cached.sessionId === "string" ? cached.sessionId : undefined,
        projectId: coerceProjectId(cached.projectId),
        usage: parseUsageJson(cached.usage),
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
        sessionId: typeof fm.sessionId === "string" ? fm.sessionId : undefined,
        projectId: coerceProjectId(fm.projectId),
        usage: parseUsageJson(fm.usage),
      };
    } catch {
      return {};
    }
  }

  private formatChatContent(messages: AgentChatMessage[]): string {
    return messages
      .map((m) => {
        const ts = m.timestamp ? m.timestamp.display : "Unknown time";
        const body =
          m.message.length === 0 && m.fanout
            ? serializeFanoutComposite(m.fanout, (id) => id)
            : m.message;
        return `**${m.sender}**: ${body}\n[Timestamp: ${ts}]`;
      })
      .join("\n\n");
  }

  private parseChatBody(body: string, conversationEpoch?: number): AgentChatMessage[] {
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
      // Display timestamps omit milliseconds but chat links match the frontmatter epoch exactly, so keep it across reloads.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/661
      if (messages.length === 0 && conversationEpoch !== undefined) {
        timestamp = { epoch: conversationEpoch, display: timestampStr, fileName: "" };
      }

      const id = timestamp
        ? `loaded-${messages.length}-${timestamp.epoch}`
        : `loaded-${messages.length}`;
      messages.push({
        id,
        message: stripChatImageReceipts(messageText),
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
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { frontmatter: {}, body: content };
    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (!m) continue;
      const raw = m[2].trim();
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
    folder: string,
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
            // eslint-disable-next-line no-control-regex -- serialized frontmatter must reject embedded control bytes
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
      // eslint-disable-next-line no-control-regex -- serialized frontmatter must reject embedded control bytes
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_");

    const baseNameWithPrefix = `${filePrefix}${sanitizedFileName}.md`;
    if (getUtf8ByteLength(baseNameWithPrefix) > SAFE_FILENAME_BYTE_LIMIT) {
      const availableForBasename = SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes;
      const truncatedBasename = truncateToByteLimit(sanitizedFileName, availableForBasename);
      return joinPosix(folder, `${filePrefix}${truncatedBasename}.md`);
    }

    return joinPosix(folder, baseNameWithPrefix);
  }

  private generateNoteContent(args: {
    chatContent: string;
    firstMessageEpoch: number;
    backendId: BackendId;
    topic?: string;
    label?: string | null;
    modelKey?: string;
    lastAccessedAt?: number;
    sessionId?: string | null;
    projectId?: string;
    usage?: SessionUsage;
  }): string {
    const lines: string[] = [
      "---",
      `epoch: ${args.firstMessageEpoch}`,
      `mode: ${AGENT_CHAT_MODE}`,
      `backendId: ${args.backendId}`,
    ];
    const projectId = coerceProjectId(args.projectId);
    if (projectId && projectId !== GLOBAL_SCOPE) {
      lines.push(`projectId: "${escapeYamlString(projectId)}"`);
    }
    if (args.sessionId) lines.push(`sessionId: "${escapeYamlString(args.sessionId)}"`);
    if (args.topic) lines.push(`topic: "${escapeYamlString(args.topic)}"`);
    if (args.label) lines.push(`agentLabel: "${escapeYamlString(args.label)}"`);
    if (args.modelKey) lines.push(`modelKey: "${escapeYamlString(args.modelKey)}"`);
    if (args.lastAccessedAt) lines.push(`lastAccessedAt: ${args.lastAccessedAt}`);
    if (args.usage) lines.push(`usage: '${JSON.stringify(args.usage)}'`);
    lines.push("tags:");
    lines.push(`  - ${COPILOT_CONVERSATION_TAG}`);
    lines.push("---");
    lines.push("");
    lines.push(args.chatContent);
    return lines.join("\n");
  }
}
