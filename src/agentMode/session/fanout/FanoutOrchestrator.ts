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
import {
  buildSummaryUserPrompt,
  FANOUT_ALL_FAILED_SUMMARY,
  selectSummaryInputs,
  type AgentAnswer,
  type FanoutTurn,
} from "./fanoutTypes";

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
  /**
   * Human display label for `backendId` (e.g. "Claude"), used to label each
   * agent's answer in the summary prompt. Falls back to the id when unknown so a
   * newly registered backend still renders without per-agent branching.
   */
  getDisplayName(backendId: BackendId): string;
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

/**
 * The assistant prose chunk from a session event, or `null` for anything that
 * is not part of the answer surface. Only `agent_message_chunk` text feeds an
 * answer / the summary — thoughts and tool calls are excluded (Phase 4 may add
 * richer rendering).
 */
function textChunkOf(event: SessionEvent): string | null {
  const update = event.update;
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  if (update.content.type !== "text") return null;
  return update.content.text;
}

/** Inputs for one fan-out turn — identical prompt + context for every agent (D10). */
export interface FanoutRunInput {
  /** Main agent first, then each `@`-mentioned installed agent (deduped). */
  agents: ReadonlyArray<BackendId>;
  /**
   * The session's main agent (always `agents[0]`). It generates the narrative
   * summary after every non-failed agent settles (D6), in its own read-only
   * sub-session.
   */
  mainAgent: BackendId;
  /** The identical prompt blocks (text envelope + context + images) every agent receives. */
  prompt: PromptContent[];
  /**
   * Plain text of the user's original question, fed to the summary prompt as
   * the "original question" the agents answered. Distinct from {@link prompt},
   * which also carries the read-only preamble + context envelope.
   */
  originalPromptText: string;
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
 * in-memory {@link FanoutTurn}; once every answer settles the main agent writes
 * the narrative summary over the survivors into the summary slot (D6/D7).
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

    // Every answer has settled. The main agent now writes the narrative summary
    // over the survivors (D6/D7). Cancellation skips it — there is nothing to
    // reconcile and the turn is ending.
    if (!input.signal.aborted) {
      await this.runSummary(turn, input);
    }

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
    const slot = turn.answers[backendId];
    try {
      await this.runReadOnlySubSession({
        backendId,
        prompt: input.prompt,
        signal: input.signal,
        onText: (text) => {
          if (slot.status === "error") return;
          slot.text += text;
          input.onChange(turn);
        },
        onAborted: () => {
          slot.status = "error";
          slot.error = "Cancelled";
          input.onChange(turn);
        },
      });
      // A clean turn with no streamed text still resolves `done` — the slot
      // carries whatever (possibly empty) text landed; Phase 4 renders the
      // empty state. Only a thrown error becomes an `error` slot.
      if (slot.status === "running") {
        slot.status = "done";
        input.onChange(turn);
      }
    } catch (err) {
      logWarn(`[AgentMode] fan-out agent ${backendId} failed`, err);
      slot.status = "error";
      slot.error = err2String(err);
      input.onChange(turn);
    }
  }

  /**
   * The main agent's narrative summary (Phase 3 / D6). Runs after every answer
   * settles, over the agents that SUCCEEDED ({@link selectSummaryInputs}); a
   * failed agent is named, not fabricated over (D7). With ZERO successes there
   * is nothing to reconcile, so the summary lands `done` with a brief
   * all-failed note rather than an invented summary or a hard error — the turn
   * still completes and persists that note (the chosen zero-success terminal
   * state). The summary itself runs read-only in its own ephemeral sub-session
   * of the main backend, streaming token-by-token into `summary.text` while the
   * status moves pending → streaming → done.
   */
  private async runSummary(turn: FanoutTurn, input: FanoutRunInput): Promise<void> {
    const inputs = selectSummaryInputs(turn);
    const summaryPrompt = buildSummaryUserPrompt(input.originalPromptText, inputs, (backendId) =>
      this.host.getDisplayName(backendId)
    );
    if (!summaryPrompt) {
      turn.summary.status = "done";
      turn.summary.text = FANOUT_ALL_FAILED_SUMMARY;
      input.onChange(turn);
      return;
    }

    turn.summary.status = "streaming";
    input.onChange(turn);
    try {
      await this.runReadOnlySubSession({
        backendId: input.mainAgent,
        prompt: summaryPrompt,
        signal: input.signal,
        onText: (text) => {
          turn.summary.text += text;
          input.onChange(turn);
        },
        onAborted: () => undefined,
      });
    } catch (err) {
      logWarn(`[AgentMode] fan-out summary failed`, err);
    } finally {
      turn.summary.status = "done";
      input.onChange(turn);
    }
  }

  /**
   * Open an ephemeral, read-only sub-session on `backendId`, apply the
   * read-only sandbox mode + the user's default model, stream the prompt's
   * assistant text through `onText`, and tear the sub-session down in
   * `finally`. Shared by every per-agent answer AND the main-agent summary, so
   * both run through the exact same read-only registration + sandbox path. The
   * sub-session is registered via {@link FanoutHost.registerReadOnlySession},
   * so the permission prompter hard-denies writes for it (D5). `onAborted` runs
   * when the signal is already aborted before the prompt is dispatched.
   */
  private async runReadOnlySubSession(params: {
    backendId: BackendId;
    prompt: PromptContent[];
    signal: AbortSignal;
    onText: (text: string) => void;
    onAborted: () => void;
  }): Promise<void> {
    const { backendId, prompt, signal, onText, onAborted } = params;
    let proc: BackendProcess | null = null;
    let sessionId: SessionId | null = null;
    let unregisterReadOnly: (() => void) | null = null;
    let unregisterHandler: (() => void) | null = null;

    try {
      const ensured = await this.host.ensureBackendForFanout(backendId);
      proc = ensured.proc;
      const descriptor = ensured.descriptor;
      if (signal.aborted) return onAborted();

      const opened = await proc.newSession({
        cwd: this.host.getCwd() ?? "",
        mcpServers: this.host.getMcpServers(proc),
      });
      sessionId = opened.sessionId;
      unregisterReadOnly = this.host.registerReadOnlySession(sessionId);

      unregisterHandler = proc.registerSessionHandler(sessionId, (event) => {
        const text = textChunkOf(event);
        if (text !== null) onText(text);
      });

      // Read-only sandbox mode and default-model selection mutate disjoint
      // session fields, so run both round-trips concurrently to halve per-agent
      // setup latency on the path before `prompt()`.
      await Promise.all([
        this.applyReadOnlyMode(proc, descriptor, sessionId),
        this.applyDefaultModel(proc, descriptor, backendId, sessionId),
      ]);
      if (signal.aborted) return onAborted();

      const sid = sessionId;
      const p = proc;
      const onAbort = () => void p.cancel({ sessionId: sid }).catch(() => undefined);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        await proc.prompt({ sessionId, prompt });
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
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
