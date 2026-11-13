import type { TAbstractFile } from "obsidian";
import {
  CHAT_IMAGE_EMBED,
  prepareChatImagesForSave,
  stripChatImageReceipts,
  updateChatTranscript,
} from "@/utils/chatImagePersistence";
import { serializeFanoutComposite } from "@/agentMode/session/fanout/fanoutTypes";
import { toolsUsedLines } from "@/agentMode/session/conversationHistory";
import { AGENT_CHAT_MODE, AI_SENDER, COPILOT_CONVERSATION_TAG, USER_SENDER } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { FormattedDateTime, type MessageContext } from "@/types/message";
import {
  ensureFolderExists,
  formatDateTime,
  getUtf8ByteLength,
  truncateToByteLimit,
} from "@/utils";
import {
  isFileAlreadyExistsError,
  isNameTooLongError,
  listMarkdownFiles,
  patchFrontmatter,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { formatChatNoteMessage } from "@/utils/chatHistoryUtils";
import { joinPosix } from "@/utils/pathUtils";
import { getVaultBase } from "@/utils/vaultPath";
import { TFile, type App } from "obsidian";
import {
  coerceProjectId,
  escapeYamlString,
  type FrontmatterUpdates,
  mergeFrontmatter,
  unescapeYamlString,
} from "./agentChatYaml";
import { sanitizeModel } from "./AgentSessionIndex";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage, BackendId, ModelSelection, SessionUsage } from "./types";

const SAFE_FILENAME_BYTE_LIMIT = 100;
const AGENT_FILENAME_PREFIX = "agent__";
// Tool cards are not saved, so each reply keeps the tools it used in a hidden JSON line that a reopened chat sends the agent as history; escaping ">" keeps any value from closing the comment.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/906
const MESSAGE_DATA_LINE = /(?:^|\r?\n)<!-- copilot-message ([^>\r\n]*) -->$/;

interface SavedMessageData {
  tools?: readonly string[];
  // A reopened or continued chat gets its attached context back only from the note; JSON keeps paths holding ", " or " | " whole.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/920
  notes?: string[];
  webTabs?: { url: string; title?: string }[];
}

function readMessageData(json: string): SavedMessageData {
  try {
    return (JSON.parse(json) ?? {}) as SavedMessageData;
  } catch {
    return {};
  }
}

function savedContext(context: MessageContext | undefined): SavedMessageData {
  const saved: SavedMessageData = {};
  if (context?.notes?.length) saved.notes = context.notes.map((note) => note.path);
  if (context?.webTabs?.length)
    saved.webTabs = context.webTabs.map(({ url, title }) => ({ url, title }));
  return saved;
}

function loadedContext(saved: SavedMessageData, app: App): MessageContext | undefined {
  const notes = (Array.isArray(saved.notes) ? saved.notes : []).flatMap((path) => {
    const file = typeof path === "string" ? app.vault.getAbstractFileByPath(path) : null;
    return file instanceof TFile ? [file] : [];
  });
  const webTabs = (Array.isArray(saved.webTabs) ? saved.webTabs : []).filter(
    (tab) => typeof tab?.url === "string"
  );
  if (notes.length === 0 && webTabs.length === 0) return undefined;
  return { notes, urls: [], ...(webTabs.length > 0 ? { webTabs } : {}) };
}

function parseLinkableEpoch(raw: string | undefined): number | undefined {
  const epoch = Number(raw);
  return Number.isSafeInteger(epoch) && epoch > 0 ? epoch : undefined;
}

function parseModelJson(raw: string | undefined): ModelSelection | undefined {
  try {
    return sanitizeModel(JSON.parse(raw ?? "null"));
  } catch {
    return undefined;
  }
}

function parseContinuedFrom(raw: string | undefined): string[] | undefined {
  try {
    const notes: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(notes) && notes.every((n) => typeof n === "string") ? notes : undefined;
  } catch {
    return undefined;
  }
}

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
  label?: string;
  sessionId?: string;
  projectId: string;
  usage?: SessionUsage;
  model?: ModelSelection;
  carriedMessages?: number;
  continuedFrom?: string[];
}

export class AgentChatPersistenceManager {
  private readonly loadedTranscripts = new Map<TAbstractFile | string, string>();

  constructor(private readonly app: App) {}

  private async updateTranscript(path: string, render: (current: string) => string): Promise<void> {
    const key = this.app.vault.getAbstractFileByPath(path) ?? path;
    const baseline = await updateChatTranscript(
      this.app,
      path,
      render,
      this.loadedTranscripts.get(key)
    );
    this.loadedTranscripts.set(key, baseline);
  }

  async saveSession(
    messages: AgentChatMessage[],
    backendId: BackendId,
    options?: {
      label?: string | null;
      model?: ModelSelection;
      existingPath?: string;
      sessionId?: string | null;
      projectId?: string;
      usage?: SessionUsage;
      carriedMessages?: number;
      continuedFrom?: readonly string[];
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

      const preferredFileName = existingFile
        ? existingFile.path
        : await this.unclaimedNotePath(
            this.generateFileName(messages, firstMessageEpoch, conversationsFolder),
            options?.existingPath
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

      const updates = this.frontmatterUpdates({
        firstMessageEpoch,
        backendId,
        label: options?.label,
        model: options?.model,
        sessionId: options?.sessionId,
        projectId: options?.projectId,
        usage: options?.usage,
        carriedMessages: options?.carriedMessages,
        continuedFrom: options?.continuedFrom,
      });
      // A chat link finds its note by exact epoch, and a resumed Claude transcript starts at a later time than the note.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/744
      const renderNote = (current: string) => {
        const existingEpoch = parseLinkableEpoch(this.splitFrontmatter(current).frontmatter.epoch);
        const owned = existingEpoch ? updates.filter(([key]) => key !== "epoch") : updates;
        return `${mergeFrontmatter(current, owned)}\n\n${chatContent}`;
      };
      // Autosave rewrites only the keys it owns, from the note as it is at write time, so renames, pins, and user properties survive; a new chat colliding with another note's name must not inherit its session.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/698
      const rewriteNote = (path: string) =>
        this.updateTranscript(path, (current) =>
          renderNote(path === options?.existingPath ? current : "")
        );

      if (existingFile) {
        await rewriteNote(existingFile.path);
        return { path: existingFile.path };
      }

      try {
        const created = await this.app.vault.create(preferredFileName, renderNote(""));
        return { path: created.path };
      } catch (err) {
        if (isFileAlreadyExistsError(err) && preferredFileName === options?.existingPath) {
          await rewriteNote(preferredFileName);
          return { path: preferredFileName };
        }
        if (isNameTooLongError(err)) {
          logWarn("[AgentChatPersistenceManager] Filename too long, falling back to minimal name");
          const fallback = `${conversationsFolder}/${AGENT_FILENAME_PREFIX}chat-${firstMessageEpoch}.md`;
          try {
            const created = await this.app.vault.create(fallback, renderNote(""));
            return { path: created.path };
          } catch (fallbackErr) {
            if (isFileAlreadyExistsError(fallbackErr)) {
              await rewriteNote(fallback);
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
    const content = await this.app.vault.read(file);
    const key = this.app.vault.getAbstractFileByPath(file.path) ?? file.path;
    this.loadedTranscripts.set(key, content);
    const { frontmatter, body } = this.splitFrontmatter(content);
    const backendId = (frontmatter.backendId ?? "").trim();
    if (!backendId) {
      throw new Error(`Missing backendId in agent chat frontmatter: ${file.path}`);
    }
    // A chat has one title, in topic; notes saved before kept the agent's title only in agentLabel.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/815
    const label = frontmatter.topic?.trim() || frontmatter.agentLabel?.trim() || undefined;
    const sessionId = frontmatter.sessionId?.trim() || undefined;
    const projectId = frontmatter.projectId?.trim() || GLOBAL_SCOPE;
    const usage = parseUsageJson(frontmatter.usage);
    const model = parseModelJson(frontmatter.model);
    const carriedMessages = Number(frontmatter.carriedMessages) || undefined;
    const continuedFrom = parseContinuedFrom(frontmatter.continuedFrom);
    const messages = this.parseChatBody(body, parseLinkableEpoch(frontmatter.epoch));

    logInfo(
      `[AgentChatPersistenceManager] Loaded ${messages.length} messages from ${file.path} (backend=${backendId}, sessionId=${sessionId ?? "none"}, projectId=${projectId})`
    );
    return {
      messages,
      backendId,
      label,
      sessionId,
      projectId,
      usage,
      model,
      carriedMessages,
      continuedFrom,
    };
  }

  async getAgentChatHistoryFiles(): Promise<TFile[]> {
    const files = listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    return files.filter((file) => file.basename.startsWith(AGENT_FILENAME_PREFIX));
  }

  async updateTopic(fileId: string, newTopic: string): Promise<void> {
    const topic = newTopic.trim();
    const file = this.resolveExistingFile(fileId);
    if (!file) return;
    // Recent Chats reloads as soon as the rename resolves, and showed the old title while
    // Obsidian was still re-reading the note. https://github.com/logancyang/obsidian-copilot/issues/3555
    const { metadataCache } = this.app;
    let markReread!: () => void;
    const reread = new Promise<void>((resolve) => (markReread = resolve));
    const ref = metadataCache.on("changed", (changed) => {
      if (changed.path === file.path) markReread();
    });
    try {
      await patchFrontmatter(this.app, fileId, { topic });
      if (metadataCache.getFileCache(file)?.frontmatter?.topic !== topic) await reread;
    } finally {
      metadataCache.offref(ref);
    }
  }

  async setPinnedAt(fileId: string, pinnedAt: number | null): Promise<void> {
    await this.patchExistingNote(fileId, { pinnedAt });
  }

  async setArchivedAt(fileId: string, archivedAt: number | null): Promise<void> {
    await this.patchExistingNote(fileId, { archivedAt });
  }

  async setAgent(fileId: string, backendId: BackendId, model?: ModelSelection): Promise<void> {
    await patchFrontmatter(this.app, fileId, {
      backendId,
      ...(model ? { model: JSON.stringify(model) } : {}),
    });
  }

  private async patchExistingNote(
    fileId: string,
    updates: Record<string, number | null>
  ): Promise<void> {
    // A row whose note was moved or deleted must fail a pin or archive instead of showing a flag that was never written.
    // https://github.com/logancyang/obsidian-copilot/issues/3195
    if (!(this.app.vault.getAbstractFileByPath(fileId) instanceof TFile)) {
      throw new Error(`Chat note not found: ${fileId}`);
    }
    await patchFrontmatter(this.app, fileId, updates);
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (!file) throw new Error("Chat file not found.");
    await trashFile(this.app, file);
  }

  // A note name can repeat across chats, as with a name format without the time or a continued chat's unchanged first message, and a chat saved under a taken name would replace the other chat's note.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/908
  private async unclaimedNotePath(path: string, ownPath?: string): Promise<string> {
    const stem = path.slice(0, -".md".length);
    let candidate = path;
    for (
      let n = 1;
      candidate !== ownPath && (await this.app.vault.adapter.exists(candidate));
      n++
    ) {
      candidate = `${stem} ${n}.md`;
    }
    return candidate;
  }

  private resolveExistingFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private formatChatContent(messages: AgentChatMessage[]): string {
    return messages
      .map((m) => {
        const ts = m.timestamp ? m.timestamp.display : "Unknown time";
        const body =
          m.message.length === 0 && m.fanout
            ? serializeFanoutComposite(m.fanout, (id) => id)
            : m.message;
        const tools = toolsUsedLines(m, getVaultBase(this.app));
        const data: SavedMessageData = {
          ...(tools.length > 0 ? { tools } : {}),
          ...savedContext(m.context),
        };
        // A message ending in a literal hidden line gets an empty one after it, so loading keeps that text.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/906
        const dataLine =
          Object.keys(data).length > 0 || MESSAGE_DATA_LINE.test(body.trim())
            ? `\n<!-- copilot-message ${JSON.stringify(data).replace(/>/g, "\\u003e")} -->`
            : "";
        return `${formatChatNoteMessage(m.sender, body)}${dataLine}\n[Timestamp: ${ts}]`;
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

      const savedText = lines.slice(0, endIndex).join("\n").trim();
      const dataLine = MESSAGE_DATA_LINE.exec(savedText);
      const messageText = dataLine ? savedText.slice(0, dataLine.index).trim() : savedText;
      const data = dataLine ? readMessageData(dataLine[1]) : {};
      const tools = Array.isArray(data.tools)
        ? data.tools.filter((tool) => typeof tool === "string")
        : [];
      const context = loadedContext(data, this.app);

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
        ...(tools.length > 0 ? { toolsUsed: tools } : {}),
        ...(context ? { context } : {}),
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
    folder: string
  ): string {
    const settings = getSettings();
    const formatted = formatDateTime(new Date(firstMessageEpoch));
    const timestampFileName = formatted.fileName;

    const firstUser = messages.find((m) => m.sender === USER_SENDER);
    const topicForFilename = firstUser
      ? firstUser.message
          // A chat continued from a reopened chat keeps the note's image embeds in its first message's text.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/908
          .replace(CHAT_IMAGE_EMBED, "")
          .replace(/\[\[([^\]]+)\]\]/g, "$1")
          .replace(/[{}[\]]/g, "")
          .split(/\s+/)
          .slice(0, 10)
          .join(" ")
          // eslint-disable-next-line no-control-regex -- serialized frontmatter must reject embedded control bytes
          .replace(/[\\/:*?"<>|\x00-\x1F]/g, "")
          .trim() || "Untitled Agent Chat"
      : "Untitled Agent Chat";

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

  private frontmatterUpdates(args: {
    firstMessageEpoch: number;
    backendId: BackendId;
    label?: string | null;
    model?: ModelSelection;
    sessionId?: string | null;
    projectId?: string;
    usage?: SessionUsage;
    carriedMessages?: number;
    continuedFrom?: readonly string[];
  }): FrontmatterUpdates {
    const projectId = coerceProjectId(args.projectId);
    const quoted = (key: string, value: string | null | undefined) =>
      value ? `${key}: "${escapeYamlString(value)}"` : undefined;
    // A merged save keeps keys it omits, so leaving global scope must delete the stale projectId explicitly.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/698
    return [
      ["epoch", `epoch: ${args.firstMessageEpoch}`],
      ["mode", `mode: ${AGENT_CHAT_MODE}`],
      ["backendId", `backendId: ${args.backendId}`],
      ["projectId", projectId === GLOBAL_SCOPE ? null : quoted("projectId", projectId)],
      ["sessionId", quoted("sessionId", args.sessionId)],
      ["topic", quoted("topic", args.label)],
      ["model", args.model ? `model: '${JSON.stringify(args.model)}'` : undefined],
      ["usage", args.usage ? `usage: '${JSON.stringify(args.usage)}'` : undefined],
      [
        "carriedMessages",
        args.carriedMessages ? `carriedMessages: ${args.carriedMessages}` : undefined,
      ],
      [
        "continuedFrom",
        quoted("continuedFrom", args.continuedFrom && JSON.stringify(args.continuedFrom)),
      ],
      ["tags", `tags:\n  - ${COPILOT_CONVERSATION_TAG}`],
    ];
  }
}
