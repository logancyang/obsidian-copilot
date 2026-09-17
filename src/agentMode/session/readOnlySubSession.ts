import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  ModelSelection,
  PromptContent,
  SessionEvent,
  SessionId,
} from "@/agentMode/session/types";
import {
  FANOUT_AGENT_TIMEOUT_ERROR,
  FANOUT_AGENT_TIMEOUT_MS,
  FANOUT_CANCEL_GRACE_MS,
  FANOUT_TRAILING_CHUNK_GRACE_MS,
} from "@/agentMode/session/fanout/fanoutTypes";

/**
 * Backend capabilities an ephemeral read-only sub-session needs. A narrow seam
 * so nothing here imports `AgentSessionManager` (dependency cycle) and every
 * caller stays unit-testable with a stub host.
 */
export interface ReadOnlySubSessionHost {
  /** Obtain a running backend process + descriptor for `backendId`. */
  ensureBackendForSubSession(
    backendId: BackendId
  ): Promise<{ proc: BackendProcess; descriptor: BackendDescriptor }>;
  /** The user's previously-configured default model selection for `backendId`. */
  getDefaultSelection(backendId: BackendId): ModelSelection | null;
  /** Persist a repaired default after the backend confirms the applied selection. */
  onSelectionApplied?(backendId: BackendId, state: BackendState): void;
  /** Absolute vault working directory shared by all sub-sessions. */
  getCwd(): string | null;
  /**
   * Register a session id as read-only so the shared permission prompter denies
   * write/exec tools for it. Returns an unregister fn.
   */
  registerReadOnlySession(sessionId: SessionId): () => void;
  /**
   * Tombstone a sub-session so it never surfaces in Recent Chats.
   * opencode/codex persist `newSession` to disk and the native-discovery sweep
   * would otherwise list these ephemeral sessions as phantom chats.
   */
  excludeSubSessionFromHistory(backendId: BackendId, sessionId: SessionId): void;
}

/** One ephemeral read-only run: what to ask, where, and how to receive the answer. */
export interface ReadOnlySubSessionRequest {
  backendId: BackendId;
  prompt: PromptContent[];
  /** Aborts the run when fired; the run then settles `"aborted"`. */
  signal: AbortSignal;
  /** Receives every assistant prose chunk as it streams. */
  onText: (text: string) => void;
}

/**
 * The assistant prose chunk from a session event, or `null` otherwise. Only
 * `agent_message_chunk` text is prose; thoughts and tool calls are excluded.
 */
function textChunkOf(event: SessionEvent): string | null {
  const update = event.update;
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  if (update.content.type !== "text") return null;
  return update.content.text;
}

/**
 * Runs one-shot prompts in ephemeral, read-only sub-sessions: a session the
 * user never sees, opened on a backend, sandboxed against writes, tombstoned so
 * it never appears in Recent Chats, and torn down when the attempt settles.
 *
 * Its boundary is that single attempt. It owns no conversation state, decides
 * nothing about what the answer means, and reports only whether the run
 * finished or was cancelled — what to do with the streamed text belongs to the
 * caller (a fan-out answer slot, an agent's memory pass).
 */
export class ReadOnlySubSessionRunner {
  constructor(private readonly host: ReadOnlySubSessionHost) {}

  /**
   * Open an ephemeral, read-only sub-session on `backendId`, apply the
   * read-only sandbox mode + default model, stream assistant text through
   * `onText`, and tear it down when the attempt settles. Registered via
   * {@link ReadOnlySubSessionHost.registerReadOnlySession} so the permission
   * prompter hard-denies writes.
   *
   * Returns `"aborted"` when the run signal fired (user cancel), else `"done"`.
   * THROWS {@link FANOUT_AGENT_TIMEOUT_ERROR} if the WHOLE attempt — setup AND
   * `prompt()` — outlives {@link FANOUT_AGENT_TIMEOUT_MS}; bounding setup too
   * means a cold/wedged `newSession` can't hang the caller.
   *
   * Teardown (best-effort `cancel` + handler unregister) happens in the
   * attempt's own `finally`, so even a late-resolving `newSession` is torn down
   * after the race bailed. On the normal path the handler is held open through
   * {@link FANOUT_TRAILING_CHUNK_GRACE_MS} so trailing chunks still route in;
   * cancel/timeout suppress that.
   */
  run(params: ReadOnlySubSessionRequest): Promise<"done" | "aborted"> {
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
        const ensured = await this.host.ensureBackendForSubSession(backendId);
        proc = ensured.proc;
        const descriptor = ensured.descriptor;

        const opened = await proc.newSession({
          cwd: this.host.getCwd() ?? "",
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

        // Sandbox mode and model selection mutate disjoint fields.
        await Promise.all([
          this.applyReadOnlyMode(proc, descriptor, sessionId),
          this.applyDefaultModel(proc, descriptor, backendId, sessionId, opened.state),
        ]);

        // If the race already won during setup, do NOT dispatch: the caller's
        // slot is terminal, and a query now could overlap a later run on this
        // same backend. The `finally` still tears the sub-session down.
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
   * deadline covering the WHOLE attempt. Abort → resolve `"aborted"`; timeout →
   * throw {@link FANOUT_AGENT_TIMEOUT_ERROR}, so a hung backend never blocks the
   * caller. A still-pending setup await is interrupted promptly by either path —
   * the helper settles without waiting on it.
   *
   * Cancel only INTERRUPTS; the `prompt()` promise keeps unwinding the backend
   * query after `cancel` returns. The Claude SDK backend's permission-bridge/
   * session context is process-global for the active query, so reusing that
   * backend mid-unwind can misroute permission decisions or corrupt a following
   * run. So on abort/timeout, if a prompt is in flight, we cancel it and AWAIT
   * its settlement (bounded by {@link FANOUT_CANCEL_GRACE_MS}; log and proceed if
   * it ignores cancel) before settling. During setup (no prompt) there's nothing
   * to await. The happy path never enters this grace.
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
            `[AgentMode] read-only sub-session prompt did not settle within the cancel grace; reusing backend anyway`
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
      // so no live query runs behind an already-terminal caller.
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
          // so the caller lands `cancelled`, not `done`.
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
      logWarn(`[AgentMode] read-only sub-session mode failed for ${descriptor.id}`, e);
    }
  }

  /**
   * Apply the saved model through the same backend policy as visible chats.
   * State is local to this ephemeral session and refreshed after each write.
   */
  private async applyDefaultModel(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    sessionId: SessionId,
    state: BackendState
  ): Promise<void> {
    const selection = this.host.getDefaultSelection(backendId) ?? state.model?.current;
    if (!selection) return;
    // Duplicating codec/config dispatch here bypasses backend default-effort
    // handling. https://github.com/Brevilabs/obsidian-copilot-private/issues/219
    await descriptor.applySelection(
      {
        getState: () => state,
        applyModelWireId: async (modelId) => {
          const apply = state.model?.apply;
          state =
            apply?.kind === "setConfigOption"
              ? await proc.setSessionConfigOption({
                  sessionId,
                  configId: apply.configId,
                  value: modelId,
                })
              : await proc.setSessionModel({ sessionId, modelId });
        },
        setConfigOption: async (configId, value) => {
          state = await proc.setSessionConfigOption({ sessionId, configId, value });
        },
      },
      selection
    );
    this.host.onSelectionApplied?.(backendId, state);
  }
}
