import { prepareChatImagesForSave } from "@/utils/chatImagePersistence";
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
import {
  AGENT_CHAT_SCHEMA_VERSION,
  buildSnapshotComment,
  conversationNeedsMixedSchema,
  readSnapshotComment,
  renderMixedChatBody,
  splitSnapshotComment,
  type AgentHistoryRestoreStatus,
  type AgentMixedConversation,
} from "./agentChatSnapshot";
import type { ContextDeliveryState } from "./ContextDeliveryCursor";
import type { AgentTaskRecord } from "./voiceTypes";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage, BackendId, SessionUsage } from "./types";

const SAFE_FILENAME_BYTE_LIMIT = 100;
export const AGENT_FILENAME_PREFIX = "agent__";

/**
 * Parse the frontmatter `usage` field (a JSON string) back into a
 * {@link SessionUsage}. Returns `undefined` for absent, non-string, malformed,
 * or wrong-shaped values so a corrupt frontmatter never rejects the whole load.
 */
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
    // Malformed JSON — fall through to undefined.
  }
  return undefined;
}

/**
 * Result of `loadFile` — restores display-only Agent Mode messages plus
 * routing info needed to spawn the right backend session.
 */
export interface LoadedAgentChat {
  messages: AgentChatMessage[];
  backendId: BackendId;
  topic?: string;
  label?: string;
  /**
   * Backend-side session id captured at save time. When present, the loader
   * can ask the backend to resume/load that session so the agent regains
   * conversation context on the next turn. Absent for chats saved before
   * resume was wired up — those fall back to a fresh session.
   */
  sessionId?: string;
  /**
   * Scope this chat belongs to: a real project id, or {@link GLOBAL_SCOPE}.
   * HARD CONTRACT: a chat with no `projectId` frontmatter (every legacy
   * `agent__` chat) resolves to `GLOBAL_SCOPE`, so it keeps appearing in the
   * global history. Never inferred from the filename — frontmatter is the only
   * authority.
   */
  projectId: string;
  /**
   * Latest token-usage snapshot captured at save time, or `undefined` for chats
   * saved before usage was wired up (or with malformed usage frontmatter). Lets
   * a resumed session show its last-known usage before the next turn.
   */
  usage?: SessionUsage;
  /**
   * What happened to the structured voice history in this file. Absent ≙
   * `"none"` — an ordinary chat with nothing structured to restore. Anything
   * other than `"restored"` means the caller must not let background saves
   * overwrite the file.
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Persistence and reload".
   */
  structuredHistory?: AgentHistoryRestoreStatus;
  /**
   * The validated mixed conversation, present only when `structuredHistory`
   * is `"restored"`. `messages` above mirrors its transcript so callers that
   * only render text need no branching.
   */
  mixed?: AgentMixedConversation;
}

/**
 * The structure a mixed conversation adds to its markdown file: the stable
 * conversation identity, its task records, and how much of the public
 * transcript the backend session has already been given.
 */
/** Where a save landed, and whether it used the mixed-transcript schema. */
export interface AgentChatSaveResult {
  path: string;
  wroteMixedSchema: boolean;
}

export interface AgentMixedConversationSave {
  conversationId: string;
  tasks: readonly AgentTaskRecord[];
  contextDelivery: ContextDeliveryState;
}

interface ExistingMeta {
  topic?: string;
  label?: string;
  lastAccessedAt?: number;
  sessionId?: string;
  projectId?: string;
  usage?: SessionUsage;
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
    messages: readonly AgentChatMessage[],
    backendId: BackendId,
    options?: {
      label?: string | null;
      modelKey?: string;
      existingPath?: string;
      sessionId?: string | null;
      /**
       * Scope to record in frontmatter. Pass a real project id to bind the
       * chat to that project; omit (or pass `GLOBAL_SCOPE`) for a global chat,
       * which writes no `projectId` so it stays indistinguishable from legacy
       * global chats.
       */
      projectId?: string;
      /** Latest token-usage snapshot to persist for resume. */
      usage?: SessionUsage;
      /**
       * Structure that only a conversation with spoken content or task cards
       * has. Supplying it lets this write use the mixed-transcript schema;
       * a conversation with neither still writes the original format.
       */
      mixed?: AgentMixedConversationSave;
    }
  ): Promise<AgentChatSaveResult | null> {
    if (messages.length === 0) return null;

    try {
      const firstMessageEpoch = messages[0].timestamp?.epoch ?? Date.now();

      // Capture the conversations folder once so a concurrent Copilot-root
      // change can't make this save ensure one directory and then write a path
      // under another. The fallback path below reads the same snapshot.
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
        [...messages],
        preferredFileName
      );
      const mixed = options?.mixed;
      const useMixedSchema =
        mixed !== undefined && conversationNeedsMixedSchema(preparedMessages, mixed.tasks);
      // The whole note is assembled in memory and written once, so a write
      // that fails leaves the previous valid file in place.
      const chatContent = useMixedSchema
        ? this.formatMixedChatContent(preparedMessages, mixed)
        : this.formatChatContent(preparedMessages);

      const noteContent = this.generateNoteContent({
        chatContent,
        conversationId: useMixedSchema ? mixed.conversationId : undefined,
        firstMessageEpoch,
        backendId,
        topic: existingMeta.topic,
        label: options?.label ?? existingMeta.label,
        modelKey: options?.modelKey,
        lastAccessedAt: existingMeta.lastAccessedAt,
        sessionId: options?.sessionId ?? existingMeta.sessionId,
        // Reason: round-trip an existing chat's scope when the caller doesn't
        // re-supply it (e.g. autosave updates), so a project chat never silently
        // demotes itself to global on a later save. Coerce first so a blank
        // option falls through to the existing scope instead of clobbering it.
        projectId: coerceProjectId(options?.projectId) ?? existingMeta.projectId,
        // Round-trip the persisted usage when the caller doesn't re-supply it,
        // so a save that isn't triggered by a usage change keeps the snapshot.
        usage: options?.usage ?? existingMeta.usage,
      });

      if (existingFile && isInVaultCache(this.app, existingFile.path)) {
        await this.app.vault.modify(existingFile, noteContent);
        return { path: existingFile.path, wroteMixedSchema: useMixedSchema };
      }

      if (
        !isInVaultCache(this.app, preferredFileName) &&
        (await this.app.vault.adapter.exists(preferredFileName))
      ) {
        await this.app.vault.adapter.write(preferredFileName, noteContent);
        return { path: preferredFileName, wroteMixedSchema: useMixedSchema };
      }

      try {
        const created = await this.app.vault.create(preferredFileName, noteContent);
        return { path: created.path, wroteMixedSchema: useMixedSchema };
      } catch (err) {
        if (isFileAlreadyExistsError(err)) {
          await this.app.vault.adapter.write(preferredFileName, noteContent);
          return { path: preferredFileName, wroteMixedSchema: useMixedSchema };
        }
        if (isNameTooLongError(err)) {
          logWarn("[AgentChatPersistenceManager] Filename too long, falling back to minimal name");
          const fallback = `${conversationsFolder}/${AGENT_FILENAME_PREFIX}chat-${firstMessageEpoch}.md`;
          try {
            const created = await this.app.vault.create(fallback, noteContent);
            return { path: created.path, wroteMixedSchema: useMixedSchema };
          } catch (fallbackErr) {
            if (isFileAlreadyExistsError(fallbackErr)) {
              await this.app.vault.adapter.write(fallback, noteContent);
              return { path: fallback, wroteMixedSchema: useMixedSchema };
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
    const content = await this.readContent(file);

    const { frontmatter, body } = this.splitFrontmatter(content);
    const backendId = (frontmatter.backendId ?? "").trim();
    if (!backendId) {
      throw new Error(`Missing backendId in agent chat frontmatter: ${file.path}`);
    }
    const topic = frontmatter.topic?.trim() || undefined;
    const label = frontmatter.agentLabel?.trim() || undefined;
    const sessionId = frontmatter.sessionId?.trim() || undefined;
    // HARD CONTRACT: absent/blank projectId → GLOBAL_SCOPE, so legacy `agent__`
    // chats stay in the global history. Never inferred from the filename.
    const projectId = frontmatter.projectId?.trim() || GLOBAL_SCOPE;
    const usage = parseUsageJson(frontmatter.usage);
    const base = { backendId, topic, label, sessionId, projectId, usage };

    const history = this.readStructuredHistory(frontmatter, body);
    if (history.conversation) {
      logInfo(
        `[AgentChatPersistenceManager] Restored ${history.conversation.messages.length} messages and ${history.conversation.tasks.length} tasks from ${file.path} (backend=${backendId}, projectId=${projectId})`
      );
      return {
        ...base,
        messages: [...history.conversation.messages],
        structuredHistory: "restored",
        mixed: history.conversation,
      };
    }
    if (history.status !== "none") {
      logWarn(
        `[AgentChatPersistenceManager] structured voice history ${history.status} for ${file.path}`
      );
    }
    const messages = this.parseChatBody(history.visibleBody);

    logInfo(
      `[AgentChatPersistenceManager] Loaded ${messages.length} messages from ${file.path} (backend=${backendId}, sessionId=${sessionId ?? "none"}, projectId=${projectId})`
    );
    return { ...base, messages, structuredHistory: history.status };
  }

  /**
   * What a saved chat's structured history would restore to right now. The
   * caller uses it to re-check a file just before a background write, so edits
   * made in Obsidian after the chat was opened are never overwritten.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Persistence and reload".
   *
   * @param file - The saved chat to re-read.
   */
  async readStructuredHistoryStatus(file: TFile): Promise<AgentHistoryRestoreStatus> {
    const { frontmatter, body } = this.splitFrontmatter(await this.readContent(file));
    return this.readStructuredHistory(frontmatter, body).status;
  }

  private async readContent(file: TFile): Promise<string> {
    try {
      return await this.app.vault.read(file);
    } catch {
      return await this.app.vault.adapter.read(file.path);
    }
  }

  /**
   * Split a saved body into the half a human reads and whatever its metadata
   * comment still proves. The comment is only consulted when frontmatter
   * declares a schema: a chat written before mixed transcripts existed owns
   * every character of its body, so a look-alike comment the agent itself
   * wrote into an answer must not demote that chat to unreadable history and
   * stop it from autosaving.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Persistence and reload".
   */
  private readStructuredHistory(
    frontmatter: Record<string, string>,
    body: string
  ): {
    status: AgentHistoryRestoreStatus;
    visibleBody: string;
    conversation?: AgentMixedConversation;
  } {
    const declaredSchema = Number.parseInt(frontmatter.agentChatSchema ?? "", 10);
    if (!Number.isFinite(declaredSchema)) return { status: "none", visibleBody: body.trim() };
    // Separate the metadata comment before anything else: even an unusable
    // snapshot must not leak base64 into the last readable message.
    const { visibleBody, encoded } = splitSnapshotComment(body);
    if (declaredSchema > AGENT_CHAT_SCHEMA_VERSION) {
      return { status: "unsupported-schema", visibleBody };
    }
    // A file that claims the mixed schema but carries no snapshot was edited
    // down to its readable half; show that half and protect it from autosave.
    if (encoded === null) return { status: "unavailable", visibleBody };
    const snapshot = readSnapshotComment(encoded, visibleBody);
    if (snapshot.status === "restored") {
      return { status: "restored", visibleBody, conversation: snapshot.conversation };
    }
    return {
      status: snapshot.status === "unsupported-schema" ? "unsupported-schema" : "unavailable",
      visibleBody,
    };
  }

  /**
   * List every persisted Agent Mode chat file (across all backends). Filters
   * by the `agent__` filename prefix so the result is backend-agnostic and
   * never collides with legacy or project chats.
   */
  async getAgentChatHistoryFiles(): Promise<TFile[]> {
    const files = await listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    return files.filter((file) => file.basename.startsWith(AGENT_FILENAME_PREFIX));
  }

  /** Update the user-visible topic in frontmatter. */
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

  private formatChatContent(messages: readonly AgentChatMessage[]): string {
    return messages
      .map((m) => {
        const ts = m.timestamp ? m.timestamp.display : "Unknown time";
        // A fan-out turn streams into `m.fanout`; its composite body is written
        // to `m.message` only at completion. If autosave fires mid-turn (a long
        // turn outliving the debounce, then reload/close/crash), serialize the
        // LIVE fanout so the saved chat keeps the streamed per-agent text instead
        // of a blank assistant bubble. Backend ids label the sections here; the
        // completed turn later overwrites `m.message` with display-name labels.
        const body =
          m.message.length === 0 && m.fanout
            ? serializeFanoutComposite(m.fanout, (id) => id)
            : m.message;
        return `**${m.sender}**: ${body}\n[Timestamp: ${ts}]`;
      })
      .join("\n\n");
  }

  /**
   * Readable transcript plus the encoded metadata comment that makes it
   * reloadable. Both halves describe the same conversation, which is what the
   * comment's digest of the visible body attests.
   */
  private formatMixedChatContent(
    messages: readonly AgentChatMessage[],
    mixed: AgentMixedConversationSave
  ): string {
    const visibleBody = renderMixedChatBody(messages, mixed.tasks);
    const comment = buildSnapshotComment({ ...mixed, messages }, visibleBody);
    return `${visibleBody}\n\n${comment}`;
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
    messages: readonly AgentChatMessage[],
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
    /** Set only for mixed conversations, which also stamp the schema. */
    conversationId?: string;
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
    // Stamped only for conversations that need the mixed-transcript reader,
    // so every chat saved before voice keeps its original bytes.
    if (args.conversationId) {
      lines.push(`agentChatSchema: ${AGENT_CHAT_SCHEMA_VERSION}`);
      lines.push(`conversationId: "${escapeYamlString(args.conversationId)}"`);
    }
    // Reason: global chats write no projectId, staying byte-identical to legacy
    // `agent__` chats (which loadFile maps back to GLOBAL_SCOPE). Coerce so a
    // blank/whitespace id never leaks a stray frontmatter line.
    const projectId = coerceProjectId(args.projectId);
    if (projectId && projectId !== GLOBAL_SCOPE) {
      lines.push(`projectId: "${escapeYamlString(projectId)}"`);
    }
    if (args.sessionId) lines.push(`sessionId: "${escapeYamlString(args.sessionId)}"`);
    if (args.topic) lines.push(`topic: "${escapeYamlString(args.topic)}"`);
    if (args.label) lines.push(`agentLabel: "${escapeYamlString(args.label)}"`);
    if (args.modelKey) lines.push(`modelKey: "${escapeYamlString(args.modelKey)}"`);
    if (args.lastAccessedAt) lines.push(`lastAccessedAt: ${args.lastAccessedAt}`);
    // Serialized as a single-quoted JSON string: JSON.stringify emits no single
    // quotes or raw control chars, so the value round-trips through the YAML
    // parser (and our hand-rolled splitFrontmatter) verbatim.
    if (args.usage) lines.push(`usage: '${JSON.stringify(args.usage)}'`);
    lines.push("tags:");
    lines.push(`  - ${COPILOT_CONVERSATION_TAG}`);
    lines.push("---");
    lines.push("");
    lines.push(args.chatContent);
    return lines.join("\n");
  }
}
