import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { err2String } from "@/utils";
import {
  EMPTY_ENABLED_MODELS,
  ENABLED_MODEL_WAIT_MS,
  noEnabledModelError,
  pickEnabledModel,
} from "@/agentMode/session/enabledModelSelection";
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

export interface ReadOnlySubSessionHost {
  ensureBackendForSubSession(
    backendId: BackendId
  ): Promise<{ proc: BackendProcess; descriptor: BackendDescriptor }>;
  getDefaultSelection(backendId: BackendId): ModelSelection | null;
  onSelectionApplied?(backendId: BackendId, state: BackendState): void;
  getCwd(): string | null;
  registerReadOnlySession(sessionId: SessionId): () => void;
  excludeSubSessionFromHistory(backendId: BackendId, sessionId: SessionId): void;
}

export interface ReadOnlySubSessionRequest {
  backendId: BackendId;
  prompt: PromptContent[];
  selection?: ModelSelection | null;
  signal: AbortSignal;
  onText: (text: string) => void;
}

interface SubSessionState {
  current: BackendState;
  onChange: (() => void) | null;
}

function textChunkOf(event: SessionEvent): string | null {
  const update = event.update;
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  if (update.content.type !== "text") return null;
  return update.content.text;
}

export class ReadOnlySubSessionRunner {
  constructor(private readonly host: ReadOnlySubSessionHost) {}

  run(params: ReadOnlySubSessionRequest): Promise<"done" | "aborted"> {
    const { backendId, prompt, selection, signal, onText } = params;

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
        this.host.excludeSubSessionFromHistory(backendId, sessionId);

        const live: SubSessionState = { current: opened.state, onChange: null };
        unregisterHandler = proc.registerSessionHandler(sessionId, (event) => {
          if (event.update.sessionUpdate === "state_changed") {
            live.current = event.update.state;
            live.onChange?.();
            return;
          }
          const text = textChunkOf(event);
          if (text !== null) onText(text);
        });

        await Promise.all([
          this.applyReadOnlyMode(proc, descriptor, sessionId),
          this.applyModel(proc, descriptor, backendId, sessionId, live, selection ?? null),
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
            `[AgentMode] read-only sub-session prompt did not settle within the cancel grace; reusing backend anyway`
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
      logWarn(`[AgentMode] read-only sub-session mode failed for ${descriptor.id}`, e);
    }
  }

  private async applyModel(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    sessionId: SessionId,
    live: SubSessionState,
    requested: ModelSelection | null
  ): Promise<void> {
    const seed = requested ?? this.host.getDefaultSelection(backendId);
    const selection = descriptor.routesCopilotModels
      ? await this.settleOnEnabledModel(descriptor, seed, live)
      : (seed ?? live.current.model?.current);
    if (!selection) return;
    // Duplicating codec/config dispatch here bypasses backend default-effort
    // handling. https://github.com/Brevilabs/obsidian-copilot-private/issues/219
    await descriptor.applySelection(
      {
        getState: () => live.current,
        applyModelWireId: async (modelId) => {
          const apply = live.current.model?.apply;
          live.current =
            apply?.kind === "setConfigOption"
              ? await proc.setSessionConfigOption({
                  sessionId,
                  configId: apply.configId,
                  value: modelId,
                })
              : await proc.setSessionModel({ sessionId, modelId });
        },
        setConfigOption: async (configId, value) => {
          live.current = await proc.setSessionConfigOption({ sessionId, configId, value });
        },
      },
      selection
    );
    this.host.onSelectionApplied?.(backendId, live.current);
  }

  // Sub-sessions follow the parent chat's rule: wait for OpenCode's late catalog and never fall
  // back to the agent's own model. https://github.com/Brevilabs/obsidian-copilot-private/issues/625
  private async settleOnEnabledModel(
    descriptor: BackendDescriptor,
    seed: ModelSelection | null,
    live: SubSessionState
  ): Promise<ModelSelection> {
    const enabled = descriptor.getEnabledModelEntries?.(getSettings()) ?? EMPTY_ENABLED_MODELS;
    const pick = () => pickEnabledModel(enabled, live.current.model, seed);
    if (!pick().settled) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          window.clearTimeout(timer);
          live.onChange = null;
          resolve();
        };
        const timer = window.setTimeout(finish, ENABLED_MODEL_WAIT_MS);
        live.onChange = () => {
          if (pick().settled) finish();
        };
      });
    }
    const { target } = pick();
    if (!target) throw noEnabledModelError(descriptor.displayName);
    return target;
  }
}
