import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  ModelSelection,
  PromptContent,
  SessionEvent,
  SessionId,
} from "@/agentMode/session/types";
import { type AgentAnswer, type FanoutTurn } from "./fanoutTypes";

/**
 * Backend capabilities the orchestrator needs from the session manager. Kept as
 * a narrow seam so the orchestrator never imports `AgentSessionManager`
 * (avoiding a dependency cycle) and stays unit-testable with a stub host.
 */
export interface FanoutHost {
  /** Obtain a running backend process + descriptor for `backendId`. */
  ensureBackendForFanout(
    backendId: BackendId
  ): Promise<{ proc: BackendProcess; descriptor: BackendDescriptor }>;
  /** The user's previously-configured default model selection for `backendId`. */
  getDefaultSelection(backendId: BackendId): ModelSelection | null;
  /** Absolute vault working directory shared by all sub-sessions. */
  getCwd(): string | null;
  /** Neutral MCP server specs to open each sub-session with. */
  getMcpServers(proc: BackendProcess): Parameters<BackendProcess["newSession"]>[0]["mcpServers"];
  /**
   * Register a backend session id as a read-only fan-out sub-session, so the
   * shared permission prompter denies write/exec tools and allows reads for it.
   * Returns an unregister fn called when the sub-session closes.
   */
  registerReadOnlySession(sessionId: SessionId): () => void;
}

/** Inputs for one fan-out turn — identical prompt + context for every agent (D10). */
export interface FanoutRunInput {
  /** Main agent first, then each `@`-mentioned installed agent (deduped). */
  agents: ReadonlyArray<BackendId>;
  /** The identical prompt blocks (text envelope + context + images) every agent receives. */
  prompt: PromptContent[];
  /** Aborts every in-flight sub-session prompt when fired (cancellation). */
  signal: AbortSignal;
  /** Called whenever any slot mutates, so the UI can render live partials (D7). */
  onChange: (turn: FanoutTurn) => void;
}

/**
 * Build the initial live turn: one `running` slot per agent (insertion order
 * preserved) plus a pending summary. Exported for tests and for the caller that
 * needs to seed the UI before the first stream chunk lands.
 */
export function createFanoutTurn(agents: ReadonlyArray<BackendId>): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of agents) {
    answers[backendId] = { backendId, status: "running", text: "" };
  }
  return { answers, summary: { status: "pending", text: "" } };
}

/**
 * Orchestrates a multi-agent read-only QA turn. Every agent (main + mentioned)
 * runs in a freshly created, ephemeral, read-only sub-session on its own
 * backend — never registered as a visible AgentSession / tab — and receives the
 * identical prompt + context. Answers stream into per-agent slots of a single
 * in-memory {@link FanoutTurn}; the summary slot is left pending for Phase 3.
 *
 * One agent's error never throws out of the whole run (`allSettled`-style
 * collection): a failed agent sets its slot to `error` and the others continue.
 * Sub-session prompts are cancellable via the input `signal`, and every
 * sub-session is closed at turn end.
 */
export class FanoutOrchestrator {
  constructor(private readonly host: FanoutHost) {}

  async run(input: FanoutRunInput): Promise<FanoutTurn> {
    const turn = createFanoutTurn(input.agents);
    input.onChange(turn);

    await Promise.all(input.agents.map((backendId) => this.runAgent(backendId, turn, input)));

    return turn;
  }

  /**
   * Run one agent in an ephemeral read-only sub-session. Resolves (never
   * rejects) once the slot reaches a terminal state — a thrown/rejected backend
   * call lands as an `error` slot so siblings keep running (Phase 5 owns the
   * richer failure UX). Closes the sub-session in `finally`.
   */
  private async runAgent(
    backendId: BackendId,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    let proc: BackendProcess | null = null;
    let descriptor: BackendDescriptor | null = null;
    let sessionId: SessionId | null = null;
    let unregisterReadOnly: (() => void) | null = null;
    let unregisterHandler: (() => void) | null = null;

    const fail = (message: string): void => {
      const slot = turn.answers[backendId];
      slot.status = "error";
      slot.error = message;
      input.onChange(turn);
    };

    try {
      ({ proc, descriptor } = await this.host.ensureBackendForFanout(backendId));
      if (input.signal.aborted) return fail("Cancelled");

      const opened = await proc.newSession({
        cwd: this.host.getCwd() ?? "",
        mcpServers: this.host.getMcpServers(proc),
      });
      sessionId = opened.sessionId;
      unregisterReadOnly = this.host.registerReadOnlySession(sessionId);

      unregisterHandler = proc.registerSessionHandler(sessionId, (event) =>
        this.applyEvent(event, backendId, turn, input)
      );

      // Read-only sandbox mode and default-model selection mutate disjoint
      // session fields, so run both round-trips concurrently to halve per-agent
      // setup latency on the path before `prompt()`.
      await Promise.all([
        this.applyReadOnlyMode(proc, descriptor, sessionId),
        this.applyDefaultModel(proc, descriptor, backendId, sessionId),
      ]);
      if (input.signal.aborted) return fail("Cancelled");

      const onAbort = () => void proc?.cancel({ sessionId: sessionId! }).catch(() => undefined);
      input.signal.addEventListener("abort", onAbort, { once: true });
      try {
        await proc.prompt({ sessionId, prompt: input.prompt });
      } finally {
        input.signal.removeEventListener("abort", onAbort);
      }

      const slot = turn.answers[backendId];
      // A clean turn with no streamed text still resolves `done` — the slot
      // carries whatever (possibly empty) text landed; Phase 4 renders the
      // empty state. Only a thrown error becomes an `error` slot.
      if (slot.status === "running") {
        slot.status = "done";
        input.onChange(turn);
      }
    } catch (err) {
      logWarn(`[AgentMode] fan-out agent ${backendId} failed`, err);
      fail(err2String(err));
    } finally {
      unregisterHandler?.();
      unregisterReadOnly?.();
      if (proc && sessionId) {
        // Best-effort cancel closes the ephemeral session on the shared
        // backend process; it is never persisted as a session.
        proc.cancel({ sessionId }).catch(() => undefined);
      }
    }
  }

  /**
   * Stream an agent's prose into its slot. Only assistant message chunks feed
   * the answer text — thoughts and tool calls are not part of the QA answer
   * surface (Phase 4 may add richer rendering). No-op for other event kinds.
   */
  private applyEvent(
    event: SessionEvent,
    backendId: BackendId,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): void {
    const update = event.update;
    if (update.sessionUpdate !== "agent_message_chunk") return;
    if (update.content.type !== "text") return;
    const slot = turn.answers[backendId];
    if (slot.status === "error") return;
    slot.text += update.content.text;
    input.onChange(turn);
  }

  /**
   * Apply the backend's read-only sandbox mode when it exposes one via a
   * `setMode`-style mapping (codex maps canonical `plan` → its `read-only`
   * sandbox, applied with a static native id). Belt-and-suspenders on top of the
   * prompt preamble + permission denial. Best-effort and intentionally narrow:
   * `setMode` plan ids are static, so a stateless `getModeMapping` probe
   * resolves them. `configOption`-style backends (opencode) need live session
   * config to resolve a native id — and opencode advertises no `plan` mode
   * anyway — so they rely on the prompt + permission layers, never this one.
   */
  private async applyReadOnlyMode(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    sessionId: SessionId
  ): Promise<void> {
    const mapping = descriptor.getModeMapping?.(null, null);
    if (mapping?.kind !== "setMode") return;
    const nativeId = mapping.canonical.plan;
    if (!nativeId) return;
    try {
      await proc.setSessionMode({ sessionId, modeId: nativeId });
    } catch (e) {
      logWarn(`[AgentMode] fan-out read-only mode failed for ${descriptor.id}`, e);
    }
  }

  /**
   * Switch the sub-session onto the user's previously-configured default model
   * for this backend (plan Details). Best-effort — a missing default or an
   * unsupported switch leaves the backend's own default in place.
   */
  private async applyDefaultModel(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<void> {
    const selection = this.host.getDefaultSelection(backendId);
    if (!selection) return;
    try {
      await proc.setSessionModel({ sessionId, modelId: descriptor.wire.encode(selection) });
    } catch (e) {
      logWarn(`[AgentMode] fan-out default model failed for ${backendId}`, e);
    }
  }
}
