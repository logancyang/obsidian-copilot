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
 * Backend capabilities the orchestrator needs from the session manager. A narrow
 * seam so the orchestrator never imports `AgentSessionManager` (dependency cycle)
 * and stays unit-testable with a stub host.
 */
export interface FanoutHost {
  /** Obtain a running backend process + descriptor for `backendId`. */
  ensureBackendForFanout(
    backendId: BackendId
  ): Promise<{ proc: BackendProcess; descriptor: BackendDescriptor }>;
  /** The user's previously-configured default model selection for `backendId`. */
  getDefaultSelection(backendId: BackendId): ModelSelection | null;
  /** Display label for `backendId`, used to label each agent's answer; falls back to the id. */
  getDisplayName(backendId: BackendId): string;
  /** Absolute vault working directory shared by all sub-sessions. */
  getCwd(): string | null;
  /** Neutral MCP server specs to open each sub-session with. */
  getMcpServers(proc: BackendProcess): Parameters<BackendProcess["newSession"]>[0]["mcpServers"];
  /**
   * Register a session id as a read-only fan-out sub-session so the shared
   * permission prompter denies write/exec tools for it. Returns an unregister fn.
   */
  registerReadOnlySession(sessionId: SessionId): () => void;
  /**
   * Tombstone a fan-out sub-session so it never surfaces in Recent Chats.
   * opencode/codex persist `newSession` to disk and the native-discovery sweep
   * would otherwise list these ephemeral sessions as phantom chats.
   */
  excludeSubSessionFromHistory(backendId: BackendId, sessionId: SessionId): void;
}

/**
 * The assistant prose chunk from a session event, or `null` otherwise. Only
 * `agent_message_chunk` text feeds an answer/summary; thoughts and tool calls
 * are excluded.
 */
function textChunkOf(event: SessionEvent): string | null {
  const update = event.update;
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  if (update.content.type !== "text") return null;
  return update.content.text;
}

/** Inputs for one fan-out turn — identical prompt + context for every agent. */
export interface FanoutRunInput {
  /**
   * The `@`-mentioned installed answerers (deduped). Each gets an answer slot.
   * Decoupled from {@link mainAgent}: the summarizer answers only if itself mentioned.
   */
  agents: ReadonlyArray<BackendId>;
  /**
   * The session's main agent — ALWAYS the summarizer, tracked separately from
   * {@link agents}, whether or not it is one of the answerers.
   */
  mainAgent: BackendId;
  /** The identical prompt blocks (text envelope + context + images) every agent receives. */
  prompt: PromptContent[];
  /**
   * Plain text of the user's original question, fed to the summary prompt.
   * Distinct from {@link prompt}, which also carries preamble + context envelope.
   */
  originalPromptText: string;
  /** Aborts every in-flight sub-session prompt when fired. */
  signal: AbortSignal;
  /** Called whenever any slot mutates, so the UI can render live partials. */
  onChange: (turn: FanoutTurn) => void;
}

/**
 * Build the initial live turn: one `running` slot per ANSWERER (insertion order
 * preserved) plus a pending summary. Exported so the caller can seed the UI
 * before the first stream chunk lands.
 */
export function createFanoutTurn(agents: ReadonlyArray<BackendId>): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of agents) {
    answers[backendId] = { backendId, status: "running", text: "" };
  }
  return { answers, summary: { status: "pending", text: "" } };
}

/**
 * Orchestrates a multi-agent read-only QA turn. Every ANSWERER runs in an
 * ephemeral, read-only sub-session on its own backend (never a visible
 * AgentSession/tab) with the identical prompt; answers stream into per-agent
 * slots of one {@link FanoutTurn}. Once every answer settles the main agent
 * (summarizer) writes the narrative summary over the survivors.
 *
 * One agent's error never throws out of the run — its slot goes `error`, others
 * continue. Prompts are cancellable via `signal`; every sub-session closes at
 * turn end.
 */
export class FanoutOrchestrator {
  constructor(private readonly host: FanoutHost) {}

  async run(input: FanoutRunInput): Promise<FanoutTurn> {
    const turn = createFanoutTurn(input.agents);
    input.onChange(turn);

    await Promise.all(input.agents.map((backendId) => this.runAgent(backendId, turn, input)));

    // Every answer settled; the main agent summarizes the survivors. Cancellation
    // skips it — nothing to reconcile and the turn is ending.
    if (!input.signal.aborted) {
      await this.runSummary(turn, input);
    }

    return turn;
  }

  /**
   * Run one agent in an ephemeral read-only sub-session. Resolves (never rejects)
   * once the slot is terminal, so one agent's failure never throws out of the run:
   *
   * - normal completion → `done`
   * - user cancel (run signal aborted) → `cancelled` (not a fault)
   * - per-agent timeout → `error` with the timeout reason
   * - any thrown backend call → `error` with the failure text
   */
  private async runAgent(
    backendId: BackendId,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    const slot = turn.answers[backendId];
    // A slot transitions only while `running`; once terminal it is frozen. Gating
    // every mutation here keeps streamed text, the status flip, and the error path
    // from racing each other.
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
      // An abort is a clean cancel, not a fault: the slot goes `cancelled`, not `done`.
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
   * The main agent's narrative summary, over the agents that SUCCEEDED
   * ({@link selectSummaryInputs}). With ZERO successes it lands `done` with a
   * brief all-failed note rather than an invented summary or a hard error. Runs
   * read-only in its own ephemeral sub-session of the main backend, streaming
   * into `summary.text` while status moves pending → streaming → done.
   */
  private async runSummary(turn: FanoutTurn, input: FanoutRunInput): Promise<void> {
    const inputs = selectSummaryInputs(turn);
    const summaryPrompt = buildSummaryUserPrompt(input.originalPromptText, inputs, (backendId) =>
      this.host.getDisplayName(backendId)
    );
    if (!summaryPrompt) {
      turn.summary.status = "done";
      turn.summary.text = FANOUT_ALL_FAILED_SUMMARY;
      turn.summary.complete = true;
      input.onChange(turn);
      return;
    }

    turn.summary.status = "streaming";
    input.onChange(turn);
    try {
      const outcome = await this.runReadOnlySubSession({
        backendId: input.mainAgent,
        prompt: summaryPrompt,
        signal: input.signal,
        onText: (text) => {
          turn.summary.text += text;
          input.onChange(turn);
        },
      });
      // Only a clean finish is trustworthy; an aborted summary leaves partial text
      // the continuity replay must not prefer.
      if (outcome === "done") turn.summary.complete = true;
    } catch (err) {
      // Errored/timed out mid-stream: partial text, NOT complete.
      logWarn(`[AgentMode] fan-out summary failed`, err);
    } finally {
      turn.summary.status = "done";
      input.onChange(turn);
    }
  }

  /**
   * Open an ephemeral, read-only sub-session on `backendId`, apply the read-only
   * sandbox mode + default model, stream assistant text through `onText`, and
   * tear it down when the attempt settles. Shared by per-agent answers AND the
   * summary. Registered via {@link FanoutHost.registerReadOnlySession} so the
   * permission prompter hard-denies writes.
   *
   * Returns `"aborted"` when the run signal fired (user cancel → `cancelled` slot),
   * else `"done"`. THROWS {@link FANOUT_AGENT_TIMEOUT_ERROR} if the WHOLE attempt
   * — setup AND `prompt()` — outlives {@link FANOUT_AGENT_TIMEOUT_MS}; bounding
   * setup too means a cold/wedged `newSession` can't hang the turn.
   *
   * Teardown (best-effort `cancel` + handler unregister) happens in the attempt's
   * own `finally`, so even a late-resolving `newSession` is torn down after the
   * race bailed. On the normal path the handler is held open through
   * {@link FANOUT_TRAILING_CHUNK_GRACE_MS} so trailing chunks still route in;
   * cancel/timeout suppress that.
   */
  private async runReadOnlySubSession(params: {
    backendId: BackendId;
    prompt: PromptContent[];
    signal: AbortSignal;
    onText: (text: string) => void;
  }): Promise<"done" | "aborted"> {
    const { backendId, prompt, signal, onText } = params;

    // The attempt owns the full lifecycle (setup, prompt, trailing-chunk grace,
    // teardown), so its `finally` always closes any session it opened — even a
    // late-resolving `newSession`. It reports its in-flight `prompt()` via
    // `onPrompt` with a `cancelPrompt` so the race's cancel paths can interrupt
    // and await the query's real settlement before the backend is reused.
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
        // Tombstone the disk-persisted session so the discovery sweep never lists
        // it as a phantom Recent Chat.
        this.host.excludeSubSessionFromHistory(backendId, sessionId);

        unregisterHandler = proc.registerSessionHandler(sessionId, (event) => {
          const text = textChunkOf(event);
          if (text !== null) onText(text);
        });

        // Sandbox mode and model selection mutate disjoint fields, so run both
        // round-trips concurrently. The model channel comes from the sub-session's
        // own `BackendState.model.apply` spec, so config-option backends (opencode
        // ≥ 1.15.13) route through the same RPC the visible session would.
        const modelApply = opened.state.model?.apply ?? null;
        await Promise.all([
          this.applyReadOnlyMode(proc, descriptor, sessionId),
          this.applyDefaultModel(proc, descriptor, backendId, sessionId, modelApply),
        ]);

        // If the race already won during setup, do NOT dispatch: the slot is
        // terminal, and a query now could overlap the later summary on this same
        // backend. The `finally` still tears the sub-session down.
        if (raceSettled()) return "done";

        const promptProc = proc;
        const promptSessionId = sessionId;
        const promptPromise = promptProc.prompt({ sessionId, prompt });
        onPrompt(promptPromise, () => {
          promptProc.cancel({ sessionId: promptSessionId }).catch(() => undefined);
        });
        await promptPromise;
        // Hold the handler open a bounded window so trailing chunks some backends
        // flush after `session/prompt` resolves still route in. Skipped once the
        // race bailed — a cancel-honored prompt must suppress late output.
        if (!raceSettled()) await this.awaitTrailingChunks();
        return "done";
      } finally {
        unregisterHandler?.();
        unregisterReadOnly?.();
        if (proc && sessionId) {
          // Best-effort cancel ends the in-flight query. Runs on every exit (done
          // / aborted / timeout / throw), including a late-opened session.
          proc.cancel({ sessionId }).catch(() => undefined);
        }
      }
    };

    return this.runAttemptWithTimeout(
      (onPrompt, raceSettled) => attempt(onPrompt, raceSettled),
      signal
    );
  }

  /** Hold {@link FANOUT_TRAILING_CHUNK_GRACE_MS} so the handler captures trailing chunks. */
  private awaitTrailingChunks(): Promise<void> {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, FANOUT_TRAILING_CHUNK_GRACE_MS);
    });
  }

  /**
   * Run one `attempt` (setup + prompt) racing the run signal (user cancel) and a
   * per-agent deadline covering the WHOLE attempt. Abort → resolve `"aborted"`;
   * timeout → throw {@link FANOUT_AGENT_TIMEOUT_ERROR}, so a hung agent never
   * blocks the turn. A still-pending setup await is interrupted promptly by either
   * path — the helper settles without waiting on it.
   *
   * Cancel only INTERRUPTS; the `prompt()` promise keeps unwinding the backend
   * query after `cancel` returns. The Claude SDK backend's permission-bridge/
   * session context is process-global for the active query, so reusing that
   * backend (the summary reuses the main agent's) mid-unwind can misroute
   * permission decisions or corrupt the summary. So on abort/timeout, if a prompt
   * is in flight, we cancel it and AWAIT its settlement (bounded by
   * {@link FANOUT_CANCEL_GRACE_MS}; log and proceed if it ignores cancel) before
   * settling. During setup (no prompt) there's nothing to await. The happy path
   * never enters this grace.
   *
   * The deadline timer and abort listener are both torn down on whichever path
   * settles first, so neither leaks.
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
      // The in-flight prompt's settlement, mapped to `undefined` on BOTH outcomes
      // (a cancelled prompt usually rejects; we only care that it stopped, and the
      // mapping keeps the swallowed rejection from surfacing as unhandled). Stays
      // `null` during setup, so the cancel paths know there's nothing to await.
      let promptSettled: Promise<void> | null = null;
      // Interrupts the in-flight prompt's backend query (set once dispatched).
      let cancelInFlightPrompt: (() => void) | null = null;

      const cleanup = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

      // Cancel the in-flight prompt, then wait (bounded by the grace) for it to
      // settle before `done()`. With no prompt in flight, finish immediately. `done`
      // wraps the outer resolve/reject, so a double call (grace vs settle) is a no-op.
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
        // `promptSettled` never rejects (both outcomes mapped to undefined).
        void promptSettled.then(() => {
          window.clearTimeout(grace);
          done();
        });
      };

      // Both cancel paths share one single-shot teardown, differing only in how
      // the helper settles (aborted vs. timeout error).
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

      // If Stop was pressed before this attempt, the signal is already aborted and
      // the just-armed listener will never fire. Settle now WITHOUT starting
      // `attempt`, so no sub-session is opened after Stop.
      if (signal.aborted) {
        beginCancel(() => resolve("aborted"));
        return;
      }

      // Records the dispatched prompt so a later abort/timeout can cancel and await
      // its unwind. If abort/timeout ALREADY fired (during setup), cancel at once
      // so no live query runs behind an already-terminal slot.
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

      // `raceSettled()` is true once abort/timeout won, so the attempt skips its
      // trailing-chunk hold and tears down at once on either bail.
      attempt(onPrompt, () => settled).then(
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          // A cancel-honored resolve is still a user abort — read it off the signal
          // so the slot lands `cancelled`, not `done`.
          resolve(signal.aborted ? "aborted" : "done");
        },
        (err) => {
          // Lost the race: the terminal state is chosen — swallow the rejection.
          if (settled) return;
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(err2String(err)));
        }
      );
    });
  }

  /**
   * Apply the backend's genuine read-only sandbox mode when it advertises one via
   * `ModeMapping.readOnlyModeId` (codex → `read-only`). Belt-and-suspenders on top
   * of the prompt preamble + permission denial.
   *
   * Keyed off `readOnlyModeId`, NOT `canonical.plan`: a backend's plan mode may
   * write plan artifacts (Claude's `plan` writes files), the opposite of
   * read-only. Backends without a true read-only sandbox leave it unset and rely
   * on the prompt + permission layers (which hard-deny writes regardless).
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
   * Switch the sub-session onto the user's configured default model AND effort.
   * Best-effort — a missing default or unsupported switch leaves the backend's own.
   *
   * The orchestrator holds only a raw `(proc, sessionId)` pair, so it mirrors
   * `AgentSession.applyModelWireId` + `descriptor.applySelection` generically off
   * the sub-session's own `BackendState.model.apply` spec (`modelApply`):
   *
   *   - `setModel` spec (claude, codex, opencode ≤ 1.15.12): model via
   *     `setSessionModel`. Effort rides the wire id (codex) or applies via a
   *     second `setSessionConfigOption` using `wire.effortConfigFor` (Claude SDK,
   *     where `wire.encode` drops effort) — without it, the default effort runs.
   *
   *   - `setConfigOption` spec (opencode ≥ 1.15.13, `session/set_model` gone): the
   *     MODEL is set via `setSessionConfigOption` (`setSessionModel` would hit the
   *     unsupported RPC). Effort is a sibling option only surfaced for the ACTIVE
   *     model, so we activate the bare model first, then apply effort against the
   *     refreshed `effortConfigId` (mirroring opencode's `applySelection`).
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
   * Apply model + effort for the config-option channel (opencode ≥ 1.15.13),
   * mirroring opencode's `descriptor.applySelection`. The bare model is set first
   * (effort dropped) so the backend surfaces the model-specific effort option;
   * effort is then applied against the returned state's `effortConfigId`.
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
