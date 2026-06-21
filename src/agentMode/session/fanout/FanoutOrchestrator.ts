import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  ModelApplySpec,
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
  FANOUT_TRAILING_CHUNK_GRACE_MS,
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
  /**
   * The `@`-mentioned installed answerers (deduped). Each gets an answer slot.
   * Decoupled from {@link mainAgent}: the summarizer is NOT assumed to be one of
   * these (it answers only if it was itself `@`-mentioned).
   */
  agents: ReadonlyArray<BackendId>;
  /**
   * The session's main agent — ALWAYS the summarizer, tracked separately from
   * {@link agents}. It generates the narrative summary after every non-failed
   * answer settles (D6), in its own read-only sub-session, whether or not it is
   * one of the answerers.
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
 * Build the initial live turn: one `running` slot per ANSWERER (insertion order
 * preserved) plus a pending summary. The summarizer (the session main agent)
 * gets no answer slot unless it is itself one of the answerers. Exported for
 * tests and for the caller that needs to seed the UI before the first stream
 * chunk lands.
 */
export function createFanoutTurn(agents: ReadonlyArray<BackendId>): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of agents) {
    answers[backendId] = { backendId, status: "running", text: "" };
  }
  return { answers, summary: { status: "pending", text: "" } };
}

/**
 * Orchestrates a multi-agent read-only QA turn. Every ANSWERER runs in a
 * freshly created, ephemeral, read-only sub-session on its own backend — never
 * registered as a visible AgentSession / tab — and receives the identical
 * prompt + context. Answers stream into per-agent slots of a single in-memory
 * {@link FanoutTurn}; once every answer settles the session's main agent (the
 * summarizer, distinct from the answerers unless it was also `@`-mentioned)
 * writes the narrative summary over the survivors into the summary slot (D6/D7).
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
   * assistant text through `onText`, and tear the sub-session down when the
   * attempt settles. Shared by every per-agent answer AND the main-agent
   * summary, so both run through the exact same read-only registration + sandbox
   * path. The sub-session is registered via
   * {@link FanoutHost.registerReadOnlySession}, so the permission prompter
   * hard-denies writes for it (D5).
   *
   * Returns `"aborted"` when the run signal fired before/during the attempt
   * (user cancel → a terminal `cancelled` slot, not a fault), else `"done"`.
   * THROWS {@link FANOUT_AGENT_TIMEOUT_ERROR} if the WHOLE attempt — setup
   * (`ensureBackendForFanout` / `newSession` / mode+model round-trips) AND the
   * `prompt()` — outlives {@link FANOUT_AGENT_TIMEOUT_MS}. Bounding setup too
   * (not just the prompt) means a cold or wedged backend whose `newSession`
   * never resolves can no longer hang the turn: the abort signal interrupts the
   * pending setup await promptly, and the deadline fails the slot on its own —
   * the {@link runAttemptWithTimeout} race resolves the slot WITHOUT waiting on
   * the stuck attempt.
   *
   * The sub-session is closed (best-effort `cancel`) and its handlers
   * unregistered in the ATTEMPT's own `finally`, which runs exactly when the
   * attempt truly settles. That is what guarantees no orphan even when the race
   * already bailed during setup: a `newSession` that resolves LATE still records
   * its `sessionId`, and the attempt's `finally` then tears that session down.
   * On the normal path the handler is held open through
   * {@link FANOUT_TRAILING_CHUNK_GRACE_MS} inside the attempt (before teardown)
   * so trailing chunks still route into the slot; cancel/timeout suppress that.
   */
  private async runReadOnlySubSession(params: {
    backendId: BackendId;
    prompt: PromptContent[];
    signal: AbortSignal;
    onText: (text: string) => void;
  }): Promise<"done" | "aborted"> {
    const { backendId, prompt, signal, onText } = params;

    // The attempt owns the full lifecycle — setup, prompt, trailing-chunk grace,
    // and teardown — so its `finally` always closes any session it opened, even
    // one from a `newSession` that resolves AFTER the race below already bailed
    // on abort/timeout. It reports its in-flight `prompt()` (once dispatched) via
    // `onPrompt`, with a `cancelPrompt` that interrupts that prompt's backend
    // query, so the race's cancel paths can request the cancel and await the
    // query's real settlement before the backend is reused.
    const attempt = async (
      onPrompt: (p: Promise<unknown>, cancelPrompt: () => void) => void,
      raceSettled: () => boolean
    ): Promise<"done"> => {
      let proc: BackendProcess | null = null;
      let sessionId: SessionId | null = null;
      let unregisterReadOnly: (() => void) | null = null;
      let unregisterHandler: (() => void) | null = null;
      try {
        const ensured = await this.host.ensureBackendForFanout(backendId);
        proc = ensured.proc;
        const descriptor = ensured.descriptor;

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
        // session fields, so run both round-trips concurrently to halve
        // per-agent setup latency on the path before `prompt()`. The model
        // channel comes from the freshly opened sub-session's own
        // `BackendState.model.apply` spec, so backends whose model switch is a
        // config option (opencode ≥ 1.15.13) route through the same RPC the
        // visible session would.
        const modelApply = opened.state.model?.apply ?? null;
        await Promise.all([
          this.applyReadOnlyMode(proc, descriptor, sessionId),
          this.applyDefaultModel(proc, descriptor, backendId, sessionId, modelApply),
        ]);

        const promptProc = proc;
        const promptSessionId = sessionId;
        const promptPromise = promptProc.prompt({ sessionId, prompt });
        onPrompt(promptPromise, () => {
          promptProc.cancel({ sessionId: promptSessionId }).catch(() => undefined);
        });
        await promptPromise;
        // Hold the still-registered handler open a short bounded window so
        // trailing `agent_message_chunk` events some backends flush AFTER
        // `session/prompt` resolves still route into the slot instead of being
        // dropped. Skipped once the race already bailed (abort OR timeout): a
        // prompt that resolved only because the backend honored the cancel must
        // suppress late output and tear down at once, not linger for the grace.
        if (!raceSettled()) await this.awaitTrailingChunks();
        return "done";
      } finally {
        unregisterHandler?.();
        unregisterReadOnly?.();
        if (proc && sessionId) {
          // Best-effort cancel closes the ephemeral session on the shared
          // backend process; it is never persisted as a session. Runs on every
          // exit (done / aborted / timeout / throw) so no sub-session leaks —
          // including a session a late `newSession` opened after the race bailed.
          proc.cancel({ sessionId }).catch(() => undefined);
        }
      }
    };

    return this.runAttemptWithTimeout(
      (onPrompt, raceSettled) => attempt(onPrompt, raceSettled),
      signal
    );
  }

  /**
   * Hold {@link FANOUT_TRAILING_CHUNK_GRACE_MS} so an ephemeral sub-session's
   * still-registered handler captures the final `agent_message_chunk` events a
   * backend flushes just after `session/prompt` resolves. The one-shot timer
   * resolves and is gone, so it cannot outlive the wait or leak.
   */
  private awaitTrailingChunks(): Promise<void> {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, FANOUT_TRAILING_CHUNK_GRACE_MS);
    });
  }

  /**
   * Run one per-agent `attempt` (setup + prompt) racing both the run signal
   * (user cancel) and a single per-agent deadline that covers the WHOLE attempt.
   * On abort: resolve `"aborted"` (the slot goes terminal-cancelled). On
   * timeout: throw {@link FANOUT_AGENT_TIMEOUT_ERROR} (the slot goes
   * terminal-error) so a hung agent never blocks the turn or the summary. A
   * setup await that is still pending (a cold/wedged backend whose `newSession`
   * never resolves) is interrupted PROMPTLY by either path — the helper settles
   * without waiting on it, so the turn can never spin behind it.
   *
   * `attempt` reports its in-flight `prompt()` (once dispatched) via `onPrompt`.
   * Cancel only INTERRUPTS — the underlying `prompt()` promise keeps unwinding
   * the backend query after `cancel` returns. The Claude SDK backend's
   * permission-bridge/session context is process-global for the active query,
   * so reusing that backend (the summary reuses the main agent's) while a
   * cancelled/timed-out prompt is still unwinding can misroute permission
   * decisions or corrupt the summary. So on the abort AND timeout paths, IF a
   * prompt is already in flight, we cancel it and AWAIT its real settlement
   * (swallowed) before this helper settles — "settled" then means the backend
   * query truly stopped, not just that cancel was requested. That wait is
   * bounded by {@link FANOUT_CANCEL_GRACE_MS} so a backend that ignores cancel
   * cannot hang the turn forever (we log and proceed). When abort/timeout fires
   * during SETUP (no prompt yet) there is nothing to settle, so the helper
   * resolves immediately; the still-running attempt tears its own session down
   * in its `finally` once it unwinds. The happy path (prompt resolves on its
   * own) never enters this grace.
   *
   * Both the deadline timer and the abort listener are torn down on whichever
   * path settles first, so a settled attempt leaks neither a live deadline timer
   * (the abort path) nor an abort handler (the timeout/resolve path).
   */
  private runAttemptWithTimeout(
    attempt: (
      onPrompt: (p: Promise<unknown>, cancelPrompt: () => void) => void,
      raceSettled: () => boolean
    ) => Promise<"done">,
    signal: AbortSignal
  ): Promise<"done" | "aborted"> {
    return new Promise<"done" | "aborted">((resolve, reject) => {
      let settled = false;
      // The in-flight prompt's settlement, mapped to `undefined` on BOTH
      // outcomes — a cancelled/timed-out backend prompt usually REJECTS, and we
      // only care that it stopped. Stays `null` while still in setup (no prompt
      // dispatched yet), so the cancel paths know there is nothing to await.
      // Mapping both outcomes here also keeps the swallowed rejection from
      // surfacing as unhandled.
      let promptSettled: Promise<void> | null = null;
      // Interrupts the in-flight prompt's backend query (set once dispatched).
      let cancelInFlightPrompt: (() => void) | null = null;

      // Tear down BOTH the deadline timer and the abort listener on whichever
      // path settles first.
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

      // Request the in-flight prompt's cancel, then wait (bounded by the grace)
      // for it to actually settle before finishing via `done()`. With no prompt
      // in flight (still setting up) there is nothing to interrupt or unwind, so
      // finish immediately — the still-running attempt tears down any session a
      // late `newSession` opens in its own `finally`. `done` wraps the outer
      // promise's resolve/reject, so calling it twice (grace fired, then the
      // prompt settled, or vice-versa) is a no-op.
      const settleAfterCancel = (done: () => void) => {
        if (promptSettled === null) {
          done();
          return;
        }
        cancelInFlightPrompt?.();
        const grace = window.setTimeout(() => {
          logWarn(
            `[AgentMode] fan-out prompt did not settle within the cancel grace; reusing backend anyway`
          );
          done();
        }, FANOUT_CANCEL_GRACE_MS);
        // `promptSettled` never rejects (both outcomes mapped to undefined), so
        // this branch cannot leak an unhandled rejection.
        void promptSettled.then(() => {
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

      // If Stop was pressed during the async work BEFORE this attempt (license
      // re-verify, web-tab serialization, …), the signal is ALREADY aborted and
      // the listener just armed will never fire. Settle now via the same cancel
      // path and return WITHOUT starting `attempt`, so no sub-session is opened
      // and no read-only prompt is dispatched after Stop.
      if (signal.aborted) {
        beginCancel(() => resolve("aborted"));
        return;
      }

      // `onPrompt` records the dispatched prompt so a later abort/timeout can
      // cancel it and await its real unwind. If abort/timeout ALREADY fired
      // (during setup), cancel it right away — the slot is already terminal, so
      // we must not leave a live backend query running behind it.
      const onPrompt = (p: Promise<unknown>, cancelPrompt: () => void) => {
        promptSettled = p.then(
          () => undefined,
          () => undefined
        );
        cancelInFlightPrompt = cancelPrompt;
        if (settled) {
          cancelPrompt();
          p.catch(() => undefined);
        }
      };

      // `raceSettled()` is true once abort or timeout has won the race, so the
      // attempt can skip its trailing-chunk hold and tear down at once on either
      // bail (not just on the run-signal abort).
      attempt(onPrompt, () => settled).then(
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          // An attempt that resolved only because the backend honored the
          // cancel is still a user abort — read it off the signal so the slot
          // lands `cancelled`, not `done`. No grace here: it settled on its own.
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
   * The orchestrator only holds a raw `(proc, sessionId)` pair (not a full
   * `AgentSession`), so it mirrors `AgentSession.applyModelWireId` +
   * `descriptor.applySelection` generically off the sub-session's own
   * `BackendState.model.apply` spec (`modelApply`) rather than per agent name.
   * Both the MODEL and the EFFORT channel are driven by that spec:
   *
   *   - `setModel` spec (claude, codex, opencode ≤ 1.15.12): the model goes
   *     through `setSessionModel` (the ACP `session/set_model` channel). Effort
   *     either rides the wire id (codex / suffix-style, `effortConfigFor`
   *     omitted) or — for descriptor-style backends (Claude SDK) where
   *     `wire.encode` drops effort — applies via a second `setSessionConfigOption`
   *     using `wire.effortConfigFor(baseModelId)`. Without that second call the
   *     sub-session silently runs at the backend default effort.
   *
   *   - `setConfigOption` spec (opencode ≥ 1.15.13, where `session/set_model` is
   *     gone and the catalog is a `category:"model"` config option): the MODEL
   *     itself is set with `setSessionConfigOption({ configId, value: wire })` —
   *     `setSessionModel` would hit the now-unsupported RPC and leave the backend
   *     default. Effort is a sibling `category:"thought_level"` option opencode
   *     only surfaces for the ACTIVE model, so (mirroring opencode's
   *     `applySelection`) we activate the bare model first, then read the
   *     refreshed state's `effortConfigId` and apply effort against it.
   */
  private async applyDefaultModel(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    sessionId: SessionId,
    modelApply: ModelApplySpec | null
  ): Promise<void> {
    const selection = this.host.getDefaultSelection(backendId);
    if (!selection) return;
    try {
      if (modelApply?.kind === "setConfigOption") {
        await this.applyConfigOptionModel(proc, descriptor, sessionId, selection, modelApply);
        return;
      }
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

  /**
   * Apply model + effort for the config-option model channel (opencode ≥
   * 1.15.13), mirroring opencode's `descriptor.applySelection`. The model is set
   * with the bare wire id (effort dropped) so the backend can surface the
   * model-specific effort option; effort is then applied against the
   * `effortConfigId` reported by the state the model switch returns.
   */
  private async applyConfigOptionModel(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    sessionId: SessionId,
    selection: ModelSelection,
    modelApply: Extract<ModelApplySpec, { kind: "setConfigOption" }>
  ): Promise<void> {
    const bareWire = descriptor.wire.encode({
      baseModelId: selection.baseModelId,
      effort: null,
    });
    const refreshed = await proc.setSessionConfigOption({
      sessionId,
      configId: modelApply.configId,
      value: bareWire,
    });
    if (selection.effort === null) return;
    const refreshedApply = refreshed.model?.apply;
    const effortConfigId =
      refreshedApply?.kind === "setConfigOption"
        ? refreshedApply.effortConfigId
        : modelApply.effortConfigId;
    if (!effortConfigId) return;
    await proc.setSessionConfigOption({
      sessionId,
      configId: effortConfigId,
      value: selection.effort,
    });
  }
}
