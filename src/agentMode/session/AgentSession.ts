import { AI_SENDER, USER_SENDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  AgentMessagePart,
  AgentToolCallOutput,
  AgentToolKind,
  AgentToolStatus,
  NewAgentChatMessage,
} from "@/agentMode/session/types";
import { MessageContext } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import {
  ContentBlock,
  Plan,
  PromptRequest,
  SessionId,
  SessionModelState,
  SessionNotification,
  StopReason,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { MethodUnsupportedError, type BackendId } from "@/agentMode/acp/types";
import { resolveMcpServers } from "@/agentMode/session/mcpResolver";
import { getSettings } from "@/settings/model";

/**
 * Prefix opencode uses for placeholder titles before its title-summarizer
 * agent runs. Treating these as "no title" prevents the tab from briefly
 * showing "New session - 2026-…" before the LLM-generated label arrives.
 */
const DEFAULT_TITLE_PREFIX = "New session";

export type AgentSessionStatus = "idle" | "running" | "awaiting_permission" | "error" | "closed";

export interface AgentSessionListener {
  onMessagesChanged(): void;
  onStatusChanged(status: AgentSessionStatus): void;
  /** Optional: fired when the active model changes (after `setModel` resolves). */
  onModelChanged?(): void;
  /** Optional: fired when the user-visible label changes. */
  onLabelChanged?(): void;
}

export interface AgentSessionOptions {
  backend: AcpBackendProcess;
  acpSessionId: SessionId;
  internalId: string;
  /** The backend this session was spawned on. */
  backendId: BackendId;
  initialModelState?: SessionModelState | null;
  cwd?: string | null;
}

export interface AgentSessionCreateOptions {
  backend: AcpBackendProcess;
  cwd: string;
  internalId: string;
  backendId: BackendId;
  preferredModelId?: string;
}

/**
 * Per-chat Agent Mode session. Owns its `AgentMessageStore`, the lifecycle
 * of one ACP session id on the shared backend, and the `AbortController` that
 * cancels in-flight turns.
 */
export class AgentSession {
  readonly store = new AgentMessageStore();
  readonly acpSessionId: SessionId;
  readonly internalId: string;
  readonly backendId: BackendId;
  private readonly backend: AcpBackendProcess;
  private readonly cwd: string | null;
  private status: AgentSessionStatus = "idle";
  private placeholderId: string | null = null;
  private abortController: AbortController | null = null;
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  private modelState: SessionModelState | null = null;
  private label: string | null = null;
  // Tracks who set the current label so an agent-pushed `session_info_update`
  // can't clobber a label the user explicitly chose via Rename.
  private labelSource: "user" | "agent" | null = null;

  constructor(opts: AgentSessionOptions) {
    this.backend = opts.backend;
    this.acpSessionId = opts.acpSessionId;
    this.internalId = opts.internalId;
    this.backendId = opts.backendId;
    this.cwd = opts.cwd ?? null;
    this.modelState = opts.initialModelState ?? null;
    this.unregisterSessionHandler = this.backend.registerSessionHandler(
      this.acpSessionId,
      (update) => this.handleSessionUpdate(update)
    );
  }

  static async create(opts: AgentSessionCreateOptions): Promise<AgentSession> {
    const { backend, cwd, internalId, backendId, preferredModelId } = opts;
    const resp = await backend.newSession({
      cwd,
      mcpServers: resolveMcpServers(backend, getSettings().agentMode?.mcpServers),
    });
    if (resp.models) {
      const ids = resp.models.availableModels.map((m) => m.modelId).join(", ");
      logInfo(
        `[AgentMode] session ${resp.sessionId} model=${resp.models.currentModelId} (available: ${ids})`
      );
    } else {
      logInfo(`[AgentMode] session ${resp.sessionId} created — agent did not report model state`);
    }
    const session = new AgentSession({
      backend,
      acpSessionId: resp.sessionId,
      internalId,
      backendId,
      initialModelState: resp.models ?? null,
      cwd,
    });

    // Apply sticky preference if it's available and differs from the agent's
    // current model. Failures here are non-fatal — the session is usable with
    // whatever the agent picked by default.
    if (
      preferredModelId &&
      resp.models &&
      resp.models.currentModelId !== preferredModelId &&
      resp.models.availableModels.some((m) => m.modelId === preferredModelId)
    ) {
      try {
        await session.setModel(preferredModelId);
      } catch (e) {
        logWarn(`[AgentMode] could not apply preferred model ${preferredModelId}`, e);
      }
    }
    return session;
  }

  /**
   * Latest known model state for this session. `null` when the agent did not
   * report any models in `NewSessionResponse` (older agents/backends).
   */
  getModelState(): SessionModelState | null {
    return this.modelState;
  }

  /**
   * Switch the active model on this session. Calls
   * `unstable_setSessionModel`; on success, mutates the local
   * `currentModelId` and notifies `onModelChanged` listeners.
   *
   * Throws `MethodUnsupportedError` if the agent does not implement the
   * unstable RPC. Callers should treat that as "model switching is not
   * available" and degrade the UI accordingly.
   */
  async setModel(modelId: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    await this.backend.setSessionModel({ sessionId: this.acpSessionId, modelId });
    if (this.modelState) {
      this.modelState = { ...this.modelState, currentModelId: modelId };
    } else {
      this.modelState = { availableModels: [], currentModelId: modelId };
    }
    this.notifyModelChanged();
  }

  /**
   * Whether `unstable_setSessionModel` is known to be supported. Mirrors
   * `AcpBackendProcess.isSetSessionModelSupported()`. May be `null` until the
   * first probe happens.
   */
  isModelSwitchSupported(): boolean | null {
    return this.backend.isSetSessionModelSupported();
  }

  getStatus(): AgentSessionStatus {
    return this.status;
  }

  /**
   * Whether this session has at least one user-visible message. The model
   * picker uses this to decide whether non-active backend entries should be
   * hidden (mid-conversation) or shown (empty new tab).
   */
  hasUserVisibleMessages(): boolean {
    return this.store.getDisplayMessages().length > 0;
  }

  /**
   * User-supplied label for this session (shown in the tab strip). `null`
   * means "no label" — the UI falls back to a positional default like
   * "Session N".
   */
  getLabel(): string | null {
    return this.label;
  }

  setLabel(label: string | null): void {
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "user" : null;
    this.notifyLabelChanged();
  }

  /**
   * Apply a label pushed by the backend agent (via `session_info_update`).
   * No-op when the user has already renamed this session — Rename wins so
   * later agent-side title revisions don't blow away the user's choice.
   */
  private applyAgentLabel(label: string | null | undefined): void {
    if (this.labelSource === "user") return;
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "agent" : null;
    this.notifyLabelChanged();
  }

  private notifyLabelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onLabelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] label listener threw`, e);
      }
    }
  }

  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Submit a user prompt. Synchronously appends the user message + an empty
   * assistant placeholder to the store (so the UI can render immediately) and
   * kicks off `session/prompt`. Streaming `session/update` notifications
   * mutate the placeholder in place. Returns:
   *   - `userMessageId`: id of the appended user message.
   *   - `turn`: promise that resolves with the ACP `StopReason` when the
   *     turn completes, or rejects on transport errors.
   */
  sendPrompt(
    // TODO(agent-mode): forward `context` (notes, urls, web tabs) into
    // `buildPromptBlocks` once ACP supports vault context plumbing. Today the
    // parameter is stored on the user message for display only.
    displayText: string,
    context?: MessageContext,
    content?: any[]
  ): { userMessageId: string; turn: Promise<StopReason> } {
    if (this.status === "running" || this.status === "awaiting_permission") {
      throw new Error("Session already has a turn in flight");
    }
    if (this.status === "closed") {
      throw new Error("Session is closed");
    }

    const userMessage: NewAgentChatMessage = {
      message: displayText,
      sender: USER_SENDER,
      timestamp: formatDateTime(new Date()),
      isVisible: true,
      context,
      content,
    };
    const userMessageId = this.store.addMessage(userMessage);

    const placeholder: NewAgentChatMessage = {
      message: "",
      sender: AI_SENDER,
      timestamp: formatDateTime(new Date()),
      isVisible: true,
      parts: [],
    };
    this.placeholderId = this.store.addMessage(placeholder);
    this.notifyMessages();

    this.abortController = new AbortController();
    this.setStatus("running");

    const turn = this.runTurn(displayText, content);
    return { userMessageId, turn };
  }

  private async runTurn(displayText: string, content?: any[]): Promise<StopReason> {
    const placeholderId = this.placeholderId;
    try {
      const promptBlocks = buildPromptBlocks(displayText, content);
      const req: PromptRequest = {
        sessionId: this.acpSessionId,
        prompt: promptBlocks,
      };
      const resp = await this.backend.prompt(req);
      this.setStatus("idle");
      // Clear the placeholder reference now that the turn is done. We do this
      // here (and in the catch branch) instead of in `finally` so that
      // trailing `session/update` notifications that may arrive between
      // `prompt()` resolving and this point are still applied to the right
      // message — per ACP, the agent can emit final updates around the
      // stopReason.
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      // Fire-and-forget title pull. Errors are swallowed (best-effort: the tab
      // just stays at "Session N"). Skipped on cancelled turns where opencode
      // hasn't run its title-summarizer yet.
      if (resp.stopReason === "end_turn") void this.pollSessionTitle();
      return resp.stopReason;
    } catch (err) {
      logWarn(`[AgentMode] prompt failed`, err);
      if (placeholderId) {
        this.store.markMessageError(placeholderId, err2String(err));
        this.notifyMessages();
      }
      this.setStatus("error");
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel any in-flight turn. Sends `session/cancel` over ACP and aborts the
   * local controller. The backend may still emit a few trailing
   * `session/update` notifications before the prompt promise resolves with
   * `stopReason: "cancelled"` — that's expected per the ACP spec.
   */
  async cancel(): Promise<void> {
    if (this.status !== "running" && this.status !== "awaiting_permission") return;
    try {
      await this.backend.cancel({ sessionId: this.acpSessionId });
    } catch (e) {
      logWarn(`[AgentMode] cancel notification failed`, e);
    }
    this.abortController?.abort();
  }

  /** Detach from the backend. Does not cancel — call `cancel()` first. */
  async dispose(): Promise<void> {
    this.unregisterSessionHandler?.();
    this.unregisterSessionHandler = null;
    this.setStatus("closed");
    this.listeners.clear();
  }

  private handleSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;

    // Session-scoped updates aren't tied to a turn placeholder, so handle
    // them before the placeholder check below.
    if (update.sessionUpdate === "session_info_update") {
      this.applyAgentLabel(update.title);
      return;
    }

    const placeholderId = this.placeholderId;
    if (!placeholderId) {
      logWarn(`[AgentMode] dropping session/update — no placeholder for ${this.internalId}`);
      return;
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = extractText(update.content);
        if (!text) return;
        if (this.store.appendDisplayText(placeholderId, text)) {
          this.notifyMessages();
        }
        return;
      }
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (!text) return;
        if (this.store.appendAgentThought(placeholderId, text)) {
          this.notifyMessages();
        }
        return;
      }
      case "tool_call": {
        if (this.store.upsertAgentPart(placeholderId, toolCallToPart(update))) {
          this.notifyMessages();
        }
        return;
      }
      case "tool_call_update": {
        const existing = this.findToolCallPart(placeholderId, update.toolCallId);
        const merged = mergeToolCallUpdate(existing, update);
        if (this.store.upsertAgentPart(placeholderId, merged)) {
          this.notifyMessages();
        }
        return;
      }
      case "plan": {
        if (this.store.upsertAgentPart(placeholderId, planToPart(update))) {
          this.notifyMessages();
        }
        return;
      }
      default:
        logInfo(`[AgentMode] ignoring session/update kind=${update.sessionUpdate}`);
        return;
    }
  }

  private findToolCallPart(messageId: string, toolCallId: string): AgentMessagePart | undefined {
    const msg = this.store.getMessage(messageId);
    return msg?.parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
  }

  private setStatus(next: AgentSessionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const l of this.listeners) {
      try {
        l.onStatusChanged(next);
      } catch (e) {
        logWarn(`[AgentMode] status listener threw`, e);
      }
    }
  }

  private notifyMessages(): void {
    for (const l of this.listeners) {
      try {
        l.onMessagesChanged();
      } catch (e) {
        logWarn(`[AgentMode] messages listener threw`, e);
      }
    }
  }

  /**
   * Pull the agent-generated title for this session via `session/list` and
   * apply it as the tab label. Workaround for backends like opencode 1.14
   * that summarize the first turn into a title, persist it, but don't push
   * it through `session_info_update` notifications.
   *
   * Best-effort: silently no-ops when the agent doesn't support `session/list`
   * or when the title is still the default placeholder.
   */
  private async pollSessionTitle(): Promise<void> {
    if (this.labelSource === "user") return;
    try {
      const resp = await this.backend.listSessions(this.cwd ? { cwd: this.cwd } : {});
      const entry = resp.sessions.find((s) => s.sessionId === this.acpSessionId);
      const title = entry?.title?.trim();
      if (!title) return;
      if (title.startsWith(DEFAULT_TITLE_PREFIX)) return;
      this.applyAgentLabel(title);
    } catch (err) {
      if (err instanceof MethodUnsupportedError) return;
      logWarn(`[AgentMode] session/list title poll failed for ${this.internalId}`, err);
    }
  }

  private notifyModelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onModelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] model listener threw`, e);
      }
    }
  }
}

function buildPromptBlocks(displayText: string, content?: any[]): ContentBlock[] {
  // TODO(agent-mode): map `content` (image_url / etc.) to ACP `ContentBlock`
  // image/resource entries so attachments aren't silently dropped. Today
  // `AgentChat` strips them before calling sendMessage and surfaces a Notice.
  void content;
  return [{ type: "text", text: displayText }];
}

function extractText(content: ContentBlock): string {
  if (content.type === "text") return content.text;
  return "";
}

function toolCallToPart(call: ToolCall & { sessionUpdate: "tool_call" }): AgentMessagePart {
  return {
    kind: "tool_call",
    id: call.toolCallId,
    title: call.title,
    toolKind: call.kind as AgentToolKind | undefined,
    status: (call.status ?? "pending") as AgentToolStatus,
    input: call.rawInput,
    output: extractToolCallOutputs(call.content),
    locations: call.locations?.map((l) => ({ path: l.path, line: l.line ?? undefined })),
  };
}

function mergeToolCallUpdate(
  existing: AgentMessagePart | undefined,
  upd: ToolCallUpdate & { sessionUpdate: "tool_call_update" }
): AgentMessagePart {
  const base: AgentMessagePart =
    existing && existing.kind === "tool_call"
      ? existing
      : {
          kind: "tool_call",
          id: upd.toolCallId,
          title: upd.title ?? "Tool call",
          status: "pending",
        };
  if (base.kind !== "tool_call") return base;
  return {
    ...base,
    title: upd.title ?? base.title,
    toolKind: (upd.kind as AgentToolKind | undefined) ?? base.toolKind,
    status: (upd.status as AgentToolStatus | undefined) ?? base.status,
    input: upd.rawInput !== undefined ? upd.rawInput : base.input,
    output:
      upd.content !== undefined && upd.content !== null
        ? extractToolCallOutputs(upd.content)
        : base.output,
    locations:
      upd.locations !== undefined && upd.locations !== null
        ? upd.locations.map((l) => ({ path: l.path, line: l.line ?? undefined }))
        : base.locations,
  };
}

function extractToolCallOutputs(
  content: ToolCall["content"] | ToolCallUpdate["content"]
): AgentToolCallOutput[] | undefined {
  if (!content) return undefined;
  const outputs: AgentToolCallOutput[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      outputs.push({ type: "text", text: item.content.text });
    } else if (item.type === "diff") {
      outputs.push({
        type: "diff",
        path: item.path,
        oldText: item.oldText ?? null,
        newText: item.newText,
      });
    }
  }
  return outputs.length > 0 ? outputs : undefined;
}

function planToPart(plan: Plan & { sessionUpdate: "plan" }): AgentMessagePart {
  return {
    kind: "plan",
    entries: plan.entries.map((e) => ({
      content: e.content,
      priority: e.priority,
      status: e.status,
    })),
  };
}
