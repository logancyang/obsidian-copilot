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

export interface FanoutHost {
  ensureBackendForFanout(
    backendId: BackendId
  ): Promise<{ proc: BackendProcess; descriptor: BackendDescriptor }>;
  getDefaultSelection(backendId: BackendId): ModelSelection | null;
  onSelectionApplied?(backendId: BackendId, state: BackendState): void;
  getDisplayName(backendId: BackendId): string;
  getCwd(): string | null;
  registerReadOnlySession(sessionId: SessionId): () => void;
  excludeSubSessionFromHistory(backendId: BackendId, sessionId: SessionId): void;
}

function textChunkOf(event: SessionEvent): string | null {
  const update = event.update;
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  if (update.content.type !== "text") return null;
  return update.content.text;
}

export interface FanoutRunInput {
  agents: ReadonlyArray<BackendId>;
  mainAgent: BackendId;
  prompt: PromptContent[];
  originalPromptText: string;
  signal: AbortSignal;
  onChange: (turn: FanoutTurn) => void;
}

export function createFanoutTurn(agents: ReadonlyArray<BackendId>): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of agents) {
    answers[backendId] = { backendId, status: "running", text: "" };
  }
  return { answers, summary: { status: "pending", text: "" } };
}

export class FanoutOrchestrator {
  constructor(private readonly host: FanoutHost) {}

  async run(input: FanoutRunInput): Promise<FanoutTurn> {
    const turn = createFanoutTurn(input.agents);
    input.onChange(turn);

    await Promise.all(input.agents.map((backendId) => this.runAgent(backendId, turn, input)));

    // A sole mentioned agent is already the complete response; invoking the main
    // agent would add an unwanted second voice to a direct request.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/481
    if (input.agents.length === 1) {
      turn.summary.status = "done";
      input.onChange(turn);
    } else if (!input.signal.aborted) {
      await this.runSummary(turn, input);
    }

    return turn;
  }

  private async runAgent(
    backendId: BackendId,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    const slot = turn.answers[backendId];
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
      mutateIfRunning(() => (slot.status = outcome === "aborted" ? "cancelled" : "done"));
    } catch (err) {
      mutateIfRunning(() => {
        logWarn(`[AgentMode] fan-out agent ${backendId} failed`, err);
        slot.status = "error";
        slot.error = err2String(err);
      });
    }
  }

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
      if (outcome === "done") turn.summary.complete = true;
    } catch (err) {
      // Keep setup failures actionable even when only the summary session fails.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
      turn.summary.error = err2String(err);
      logWarn(`[AgentMode] fan-out summary failed`, err);
    } finally {
      turn.summary.status = "done";
      input.onChange(turn);
    }
  }

  private async runReadOnlySubSession(params: {
    backendId: BackendId;
    prompt: PromptContent[];
    signal: AbortSignal;
    onText: (text: string) => void;
  }): Promise<"done" | "aborted"> {
    const { backendId, prompt, signal, onText } = params;

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
        });
        sessionId = opened.sessionId;
        unregisterReadOnly = this.host.registerReadOnlySession(sessionId);
        this.host.excludeSubSessionFromHistory(backendId, sessionId);

        unregisterHandler = proc.registerSessionHandler(sessionId, (event) => {
          const text = textChunkOf(event);
          if (text !== null) onText(text);
        });

        await Promise.all([
          this.applyReadOnlyMode(proc, descriptor, sessionId),
          this.applyDefaultModel(proc, descriptor, backendId, sessionId, opened.state),
        ]);

        if (raceSettled()) return "done";

        const promptProc = proc;
        const promptSessionId = sessionId;
        const promptPromise = promptProc.prompt({ sessionId, prompt });
        onPrompt(promptPromise, () => {
          promptProc.cancel({ sessionId: promptSessionId }).catch(() => undefined);
        });
        await promptPromise;
        if (!raceSettled()) await this.awaitTrailingChunks();
        return "done";
      } finally {
        unregisterHandler?.();
        unregisterReadOnly?.();
        if (proc && sessionId) {
          proc.cancel({ sessionId }).catch(() => undefined);
        }
      }
    };

    return this.runAttemptWithTimeout(
      (onPrompt, raceSettled) => attempt(onPrompt, raceSettled),
      signal
    );
  }

  private awaitTrailingChunks(): Promise<void> {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, FANOUT_TRAILING_CHUNK_GRACE_MS);
    });
  }

  private runAttemptWithTimeout(
    attempt: (
      onPrompt: (p: Promise<unknown>, cancelPrompt: () => void) => void,
      raceSettled: () => boolean
    ) => Promise<"done">,
    signal: AbortSignal
  ): Promise<"done" | "aborted"> {
    return new Promise<"done" | "aborted">((resolve, reject) => {
      let settled = false;
      let promptSettled: Promise<void> | null = null;
      let cancelInFlightPrompt: (() => void) | null = null;

      const cleanup = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

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
        void promptSettled.then(() => {
          window.clearTimeout(grace);
          done();
        });
      };

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

      if (signal.aborted) {
        beginCancel(() => resolve("aborted"));
        return;
      }

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

      attempt(onPrompt, () => settled).then(
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(signal.aborted ? "aborted" : "done");
        },
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(err2String(err)));
        }
      );
    });
  }

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
