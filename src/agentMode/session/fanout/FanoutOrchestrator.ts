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
  FANOUT_AGENT_TIMEOUT_ERROR,
  FANOUT_AGENT_TIMEOUT_MS,
  FANOUT_ALL_FAILED_SUMMARY,
  FANOUT_CANCEL_GRACE_MS,
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
   * rejects) once the slot reaches a terminal state, so one agent's failure or
   * timeout never throws out of the whole run and the siblings keep streaming:
   *
   * - normal completion → `done` (carries whatever, possibly empty, text landed)
   * - user cancel (the run signal aborted) → `cancelled` (terminal, not a fault)
   * - per-agent timeout → `error` with the timeout reason
   * - any thrown/rejected backend call → `error` with the failure text
   *
   * Closes the sub-session in `finally` (inside {@link runReadOnlySubSession}).
   */
  private async runAgent(
    backendId: BackendId,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    const slot = turn.answers[backendId];
    // A slot only ever transitions while still `running`; once terminal it is
    // frozen. Gating every mutation through one checkpoint keeps streamed text,
    // the terminal status flip, and the error path from racing each other.
    const mutateIfRunning = (apply: () => void) => {
      if (slot.status !== "running") return;
      apply();
      input.onChange(turn);
    };
    try {
      const outcome = await this.runReadOnlySubSession({
        backendId,
        prompt: input.prompt,
        signal: input.signal,
        onText: (text) => mutateIfRunning(() => (slot.text += text)),
      });
      // An abort mid-prompt (or before dispatch) is a clean cancel, NOT a fault:
      // the slot reaches a `cancelled` terminal state rather than being left
      // `running` or mislabelled `done`. Otherwise the turn completed normally.
      mutateIfRunning(() => (slot.status = outcome === "aborted" ? "cancelled" : "done"));
    } catch (err) {
      mutateIfRunning(() => {
        logWarn(`[AgentMode] fan-out agent ${backendId} failed`, err);
        slot.status = "error";
        slot.error = err2String(err);
      });
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
   * so the permission prompter hard-denies writes for it (D5).
   *
   * Returns `"aborted"` when the run signal fired before/during the prompt
   * (user cancel → a terminal `cancelled` slot, not a fault), else `"done"`.
   * THROWS {@link FANOUT_AGENT_TIMEOUT_ERROR} if `prompt()` outlives
   * {@link FANOUT_AGENT_TIMEOUT_MS} so a wedged sub-session fails its own slot
   * without stalling the siblings or the summary.
   *
   * The sub-session is closed (best-effort `cancel`) in `finally` for EVERY
   * exit — normal, aborted, timed out, or thrown — so no ACP sub-session leaks.
   * On abort the in-flight `prompt()` is cancelled immediately via the signal
   * listener, and the abort checkpoints before dispatch short-circuit so a late
   * sub-session is never even prompted.
   */
  private async runReadOnlySubSession(params: {
    backendId: BackendId;
    prompt: PromptContent[];
    signal: AbortSignal;
    onText: (text: string) => void;
  }): Promise<"done" | "aborted"> {
    const { backendId, prompt, signal, onText } = params;
    let proc: BackendProcess | null = null;
    let sessionId: SessionId | null = null;
    let unregisterReadOnly: (() => void) | null = null;
    let unregisterHandler: (() => void) | null = null;

    try {
      const ensured = await this.host.ensureBackendForFanout(backendId);
      proc = ensured.proc;
      const descriptor = ensured.descriptor;
      if (signal.aborted) return "aborted";

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
      if (signal.aborted) return "aborted";

      return await this.runPromptWithTimeout(proc, sessionId, prompt, signal);
    } finally {
      unregisterHandler?.();
      unregisterReadOnly?.();
      if (proc && sessionId) {
        // Best-effort cancel closes the ephemeral session on the shared
        // backend process; it is never persisted as a session. Runs on every
        // exit (done / aborted / timeout / throw) so no sub-session leaks.
        proc.cancel({ sessionId }).catch(() => undefined);
      }
    }
  }

  /**
   * Await `prompt()` racing both the run signal (user cancel) and a per-agent
   * deadline. On abort: cancel the sub-session and resolve `"aborted"` (the slot
   * goes terminal-cancelled). On timeout: cancel the sub-session and throw
   * {@link FANOUT_AGENT_TIMEOUT_ERROR} (the slot goes terminal-error) so the
   * hung agent never blocks the turn or the summary.
   *
   * Cancel only INTERRUPTS — the underlying `prompt()` promise keeps unwinding
   * the backend query after `cancel` returns. The Claude SDK backend's
   * permission-bridge/session context is process-global for the active query,
   * so reusing that backend (the summary reuses the main agent's) while a
   * cancelled/timed-out prompt is still unwinding can misroute permission
   * decisions or corrupt the summary. So on the abort AND timeout paths we
   * AWAIT the real prompt promise to settle (swallowed) before this helper
   * resolves — "settled" then means the backend query truly stopped, not just
   * that cancel was requested. That wait is bounded by
   * {@link FANOUT_CANCEL_GRACE_MS} so a backend that ignores cancel cannot hang
   * the turn forever (we log and proceed). The happy path (prompt resolves on
   * its own) never enters this grace.
   *
   * Both the deadline timer and the abort listener are torn down on whichever
   * path settles first, so a settled prompt leaks neither a live 5-minute timer
   * (the abort path) nor an abort handler (the timeout/resolve path).
   */
  private runPromptWithTimeout(
    proc: BackendProcess,
    sessionId: SessionId,
    prompt: PromptContent[],
    signal: AbortSignal
  ): Promise<"done" | "aborted"> {
    return new Promise<"done" | "aborted">((resolve, reject) => {
      let settled = false;
      // Tear down BOTH the deadline timer and the abort listener on whichever
      // path settles first.
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

      // Hold the real prompt promise so the cancel paths can await its actual
      // settlement. A no-op catch is attached up front so the swallowed
      // rejection on a cancel/timeout path never surfaces as unhandled.
      const promptPromise = proc.prompt({ sessionId, prompt });
      promptPromise.catch(() => undefined);

      // Request cancel, then wait (bounded by the grace) for the underlying
      // prompt to actually settle before finishing via `done()`. `done` wraps
      // the outer promise's resolve/reject, so calling it twice (grace fired,
      // then the prompt settled, or vice-versa) is a no-op — clearing the grace
      // timer on settlement is the only teardown needed.
      const settleAfterCancel = (done: () => void) => {
        proc.cancel({ sessionId }).catch(() => undefined);
        const grace = window.setTimeout(() => {
          logWarn(
            `[AgentMode] fan-out prompt did not settle within the cancel grace; reusing backend anyway`
          );
          done();
        }, FANOUT_CANCEL_GRACE_MS);
        void promptPromise.finally(() => {
          window.clearTimeout(grace);
          done();
        });
      };

      // Both cancel paths share the same single-shot teardown; they differ only
      // in how the helper finally settles (aborted vs. timeout error).
      const beginCancel = (done: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        settleAfterCancel(done);
      };
      const onAbort = () => beginCancel(() => resolve("aborted"));
      const timeout = window.setTimeout(
        () => beginCancel(() => reject(new Error(FANOUT_AGENT_TIMEOUT_ERROR))),
        FANOUT_AGENT_TIMEOUT_MS
      );
      signal.addEventListener("abort", onAbort, { once: true });

      promptPromise.then(
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          // A prompt that resolved only because the backend honored the cancel
          // is still a user abort — read it off the signal so the slot lands
          // `cancelled`, not `done`. No grace here: it settled on its own.
          resolve(signal.aborted ? "aborted" : "done");
        },
        (err) => {
          // Lost the race (already aborted/timed out): the terminal state is
          // already chosen — swallow the trailing rejection.
          if (settled) return;
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(err2String(err)));
        }
      );
    });
  }

  /**
   * Apply the backend's GENUINE read-only sandbox mode when it advertises one
   * via `ModeMapping.readOnlyModeId` (codex → `read-only`). Belt-and-suspenders
   * on top of the prompt preamble + permission denial.
   *
   * Deliberately keyed off `readOnlyModeId`, NOT `canonical.plan`: a backend's
   * plan mode may be a real planning mode that drafts and writes plan artifacts
   * (Claude's `plan` writes plan files), which is the opposite of read-only.
   * Backends without a true read-only sandbox (Claude, opencode) leave
   * `readOnlyModeId` unset and rely on the prompt + permission layers instead —
   * the permission prompter hard-denies their writes regardless. Best-effort
   * and intentionally narrow: `setMode` ids are static, so a stateless
   * `getModeMapping` probe resolves them.
   */
  private async applyReadOnlyMode(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    sessionId: SessionId
  ): Promise<void> {
    const mapping = descriptor.getModeMapping?.(null, null);
    if (mapping?.kind !== "setMode") return;
    const nativeId = mapping.readOnlyModeId;
    if (!nativeId) return;
    try {
      await proc.setSessionMode({ sessionId, modeId: nativeId });
    } catch (e) {
      logWarn(`[AgentMode] fan-out read-only mode failed for ${descriptor.id}`, e);
    }
  }

  /**
   * Switch the sub-session onto the user's previously-configured default model
   * AND effort for this backend (plan Details). Best-effort — a missing default
   * or an unsupported switch leaves the backend's own default in place.
   *
   * Effort travels through two different channels depending on the backend's
   * wire codec, and the orchestrator only holds a raw `(proc, sessionId)` pair
   * (not a full `AgentSession`), so it mirrors `descriptor.applySelection`
   * generically off the codec rather than per agent name:
   *   - Wire-encoded effort (codex, opencode suffix style): `wire.encode`
   *     already packs effort into the model id, so `effortConfigFor` is omitted
   *     (returns nothing) and the lone `setSessionModel` carries everything.
   *   - Config-option effort (Claude SDK): `wire.encode` drops effort and
   *     `effortConfigFor(baseModelId)` exposes the select spec, so effort is
   *     applied with a second `setSessionConfigOption` round-trip — without it
   *     the sub-session silently runs at the backend default effort.
   *
   * Residual: for catalogs whose MODEL switch itself routes through a
   * `category:"model"` config option (opencode ≥ 1.15.13, where
   * `session/set_model` is gone), the raw `setSessionModel` here hits the
   * backend's set_model RPC and may fail, leaving the backend default model.
   * Resolving that needs the session's `BackendState.model.apply` channel,
   * which isn't available from a raw sub-session pair; it's swallowed below so
   * the turn still runs, just on the backend default for that one catalog.
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
      if (selection.effort !== null) {
        const effortConfig = descriptor.wire.effortConfigFor?.(selection.baseModelId);
        if (effortConfig) {
          await proc.setSessionConfigOption({
            sessionId,
            configId: effortConfig.id,
            value: selection.effort,
          });
        }
      }
    } catch (e) {
      logWarn(`[AgentMode] fan-out default model failed for ${backendId}`, e);
    }
  }
}
