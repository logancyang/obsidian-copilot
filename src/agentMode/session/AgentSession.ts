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
import { isNoteSelectedTextContext, MessageContext } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import {
  ContentBlock,
  Plan,
  PromptRequest,
  SessionConfigOption,
  SessionId,
  SessionModelState,
  SessionModeState,
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

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

export interface AgentSessionListener {
  onMessagesChanged(): void;
  onStatusChanged(status: AgentSessionStatus): void;
  /**
   * Optional: fired when model, configOption, or mode state changes. The
   * picker treats all three as one notification channel — they all cause it
   * to rebuild and there's no value in fanning out separate callbacks.
   */
  onModelChanged?(): void;
  /** Optional: fired when the user-visible label changes. */
  onLabelChanged?(): void;
}

export interface AgentSessionStartOptions {
  backend: AcpBackendProcess;
  cwd: string;
  internalId: string;
  backendId: BackendId;
  preferredModelId?: string;
}

/**
 * Pre-resolved state used by tests and by `loadSessionFromHistory` to
 * construct a session that bypasses the async ACP startup.
 */
export interface AgentSessionStateOptions {
  backend: AcpBackendProcess;
  acpSessionId: SessionId;
  internalId: string;
  backendId: BackendId;
  initialModelState?: SessionModelState | null;
  initialConfigOptions?: SessionConfigOption[] | null;
  initialModeState?: SessionModeState | null;
  cwd?: string | null;
}

/**
 * Per-chat Agent Mode session. Owns its `AgentMessageStore`, the lifecycle
 * of one ACP session id on the shared backend, and the `AbortController` that
 * cancels in-flight turns.
 *
 * Construction is split: `AgentSession.start()` returns synchronously with
 * status `"starting"` so the UI can swap to the new (empty) chat immediately.
 * The ACP `session/new` RPC runs in the background; once it resolves the
 * session transitions to `"idle"` and `sendPrompt` becomes usable. While
 * starting, `sendPrompt` throws — the chat UI gates the send button on
 * `getStatus() === "starting"`.
 */
export class AgentSession {
  readonly store = new AgentMessageStore();
  readonly internalId: string;
  readonly backendId: BackendId;
  /** Resolves when `session/new` succeeds; rejects when it fails. */
  readonly ready: Promise<void>;
  private acpSessionId: SessionId | null = null;
  private readonly backend: AcpBackendProcess;
  private readonly cwd: string | null;
  private status: AgentSessionStatus = "starting";
  private placeholderId: string | null = null;
  private abortController: AbortController | null = null;
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  private modelState: SessionModelState | null = null;
  private configOptions: SessionConfigOption[] | null = null;
  private modeState: SessionModeState | null = null;
  private label: string | null = null;
  // Tracks who set the current label so an agent-pushed `session_info_update`
  // can't clobber a label the user explicitly chose via Rename.
  private labelSource: "user" | "agent" | null = null;
  private disposed = false;

  /**
   * Tests and `loadSessionFromHistory` use this constructor with a
   * pre-resolved `acpSessionId`. Production code should use
   * `AgentSession.start(...)` so the ACP startup runs in the background.
   */
  constructor(opts: AgentSessionStateOptions | AgentSessionStartOptions) {
    this.backend = opts.backend;
    this.internalId = opts.internalId;
    this.backendId = opts.backendId;
    this.cwd = opts.cwd ?? null;
    if ("acpSessionId" in opts) {
      this.acpSessionId = opts.acpSessionId;
      this.modelState = opts.initialModelState ?? null;
      this.configOptions = opts.initialConfigOptions ?? null;
      this.modeState = opts.initialModeState ?? null;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        opts.acpSessionId,
        (update) => this.handleSessionUpdate(update)
      );
      this.status = "idle";
      this.ready = Promise.resolve();
    } else {
      this.status = "starting";
      this.ready = this.initialize(opts);
    }
  }

  /**
   * Construct an `AgentSession` synchronously and kick off ACP
   * initialization in the background. The returned session is immediately
   * registerable with the manager and renderable in the UI; `sendPrompt`
   * is gated until `ready` resolves.
   */
  static start(opts: AgentSessionStartOptions): AgentSession {
    return new AgentSession(opts);
  }

  /** The ACP session id, or null while still starting. */
  getAcpSessionId(): SessionId | null {
    return this.acpSessionId;
  }

  private async initialize(opts: AgentSessionStartOptions): Promise<void> {
    const { backend, cwd, preferredModelId } = opts;
    try {
      const resp = await backend.newSession({
        cwd,
        mcpServers: resolveMcpServers(backend, getSettings().agentMode?.mcpServers),
      });
      if (this.disposed) return;
      if (resp.models) {
        const ids = resp.models.availableModels.map((m) => m.modelId).join(", ");
        logInfo(
          `[AgentMode] session ${resp.sessionId} model=${resp.models.currentModelId} (available: ${ids})`
        );
      } else {
        logInfo(`[AgentMode] session ${resp.sessionId} created — agent did not report model state`);
      }
      this.acpSessionId = resp.sessionId;
      this.modelState = resp.models ?? null;
      this.configOptions = resp.configOptions ?? null;
      this.modeState = resp.modes ?? null;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        resp.sessionId,
        (update) => this.handleSessionUpdate(update)
      );
      // dispose() may have run between newSession resolving and now. If so,
      // tear the handler down — without this, the agent-side session id is
      // live with no local consumer.
      if (this.disposed) {
        this.unregisterSessionHandler();
        this.unregisterSessionHandler = null;
        return;
      }
      this.setStatus("idle");
      this.notifyModelChanged();

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
          await this.setModel(preferredModelId);
        } catch (e) {
          logWarn(`[AgentMode] could not apply preferred model ${preferredModelId}`, e);
        }
      }
    } catch (err) {
      if (this.disposed) return;
      logWarn(`[AgentMode] session/new failed for ${this.internalId}`, err);
      this.setStatus("error");
      throw err instanceof Error ? err : new Error(err2String(err));
    }
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
    if (!this.acpSessionId) throw new Error("Session is still starting");
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

  getConfigOptions(): SessionConfigOption[] | null {
    return this.configOptions;
  }

  /**
   * Set a session configuration option (e.g. effort). The response carries
   * the **full** post-update option list per spec, which we cache verbatim.
   * Reuses `notifyModelChanged` because the picker treats model and
   * configOption changes as one channel.
   */
  async setConfigOption(configId: string, value: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.acpSessionId) throw new Error("Session is still starting");
    const resp = await this.backend.setSessionConfigOption({
      sessionId: this.acpSessionId,
      configId,
      value,
    });
    this.configOptions = resp.configOptions;
    this.notifyModelChanged();
  }

  /** Tri-state mirror of `AcpBackendProcess.isSetSessionConfigOptionSupported()`. */
  isSetSessionConfigOptionSupported(): boolean | null {
    return this.backend.isSetSessionConfigOptionSupported();
  }

  /**
   * Latest known mode state for this session. `null` when the agent did not
   * report any modes in `NewSessionResponse` (older agents/backends).
   */
  getModeState(): SessionModeState | null {
    return this.modeState;
  }

  /**
   * Switch the active session mode (claude-code permission mode, codex
   * sandbox preset, etc.) via `session/set_mode`. On success, mutates the
   * local `currentModeId` and notifies `onModelChanged` listeners.
   *
   * Throws `MethodUnsupportedError` when the agent doesn't implement the
   * RPC. Callers should treat that as "mode switching is not available" and
   * degrade the UI accordingly.
   */
  async setMode(modeId: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.acpSessionId) throw new Error("Session is still starting");
    await this.backend.setSessionMode({ sessionId: this.acpSessionId, modeId });
    this.modeState = {
      ...(this.modeState ?? { availableModes: [] }),
      currentModeId: modeId,
    };
    this.notifyModelChanged();
  }

  /** Tri-state mirror of `AcpBackendProcess.isSetSessionModeSupported()`. */
  isSetModeSupported(): boolean | null {
    return this.backend.isSetSessionModeSupported();
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
    displayText: string,
    context?: MessageContext,
    content?: any[]
  ): { userMessageId: string; turn: Promise<StopReason> } {
    if (this.status === "starting") {
      throw new Error("Session is still starting");
    }
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

    const turn = this.runTurn(displayText, context, content);
    return { userMessageId, turn };
  }

  private async runTurn(
    displayText: string,
    context: MessageContext | undefined,
    content?: any[]
  ): Promise<StopReason> {
    const placeholderId = this.placeholderId;
    // sendPrompt's status guard guarantees acpSessionId is set; the assertion
    // is for the type narrower since status and acpSessionId are independent.
    const sessionId = this.acpSessionId!;
    try {
      const promptBlocks = buildPromptBlocks(displayText, context, content);
      const req: PromptRequest = {
        sessionId,
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
    if (!this.acpSessionId) return;
    try {
      await this.backend.cancel({ sessionId: this.acpSessionId });
    } catch (e) {
      logWarn(`[AgentMode] cancel notification failed`, e);
    }
    this.abortController?.abort();
  }

  /** Detach from the backend. Does not cancel — call `cancel()` first. */
  async dispose(): Promise<void> {
    this.disposed = true;
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
    if (update.sessionUpdate === "current_mode_update") {
      // Agent flipped its own mode (e.g. an in-prompt marker, or a server-
      // side default kicking in). Mirror it locally so the picker reflects
      // reality without having to resync via setMode. Skip when the id
      // didn't actually change to avoid spurious re-renders.
      if (this.modeState?.currentModeId === update.currentModeId) return;
      this.modeState = {
        ...(this.modeState ?? { availableModes: [] }),
        currentModeId: update.currentModeId,
      };
      this.notifyModelChanged();
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

export function buildPromptBlocks(
  displayText: string,
  context?: MessageContext,
  content?: any[]
): ContentBlock[] {
  // TODO(agent-mode): map `content` (image_url / etc.) to ACP `ContentBlock`
  // image/resource entries so attachments aren't silently dropped. Today
  // `AgentChat` strips images before calling sendMessage and surfaces a Notice.
  void content;
  const envelope = buildContextEnvelope(context);
  if (!envelope) return [{ type: "text", text: displayText }];
  return [{ type: "text", text: `${envelope}\n\n<user-message>\n${displayText}\n</user-message>` }];
}

/**
 * Build the `<copilot-context>` envelope listing attached vault paths and
 * inlining note excerpts. Returns `null` when there's nothing to attach.
 */
function buildContextEnvelope(context: MessageContext | undefined): string | null {
  if (!context) return null;
  const notePaths = (context.notes ?? []).map((n) => n.path).filter(Boolean);
  const excerpts = (context.selectedTextContexts ?? []).filter(isNoteSelectedTextContext);
  if (notePaths.length === 0 && excerpts.length === 0) return null;

  const lines: string[] = [
    "<copilot-context>",
    "The user attached the following vault items. The vault is your current working directory; use the Read tool to inspect them when relevant.",
  ];
  if (notePaths.length > 0) {
    lines.push("", "Notes:");
    for (const p of notePaths) lines.push(`- ${p}`);
  }
  if (excerpts.length > 0) {
    lines.push("", "Selected excerpts (already inlined; no need to re-read):");
    for (const e of excerpts) {
      lines.push(`- ${e.notePath} (lines ${e.startLine}-${e.endLine}):`);
      for (const l of e.content.split("\n")) lines.push(`  ${l}`);
    }
  }
  lines.push("</copilot-context>");
  return lines.join("\n");
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
