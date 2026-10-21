import { mockTFile } from "@/__tests__/mockObsidian";
import { resolveEffort } from "@/lib/model-effort";
import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import { logWarn } from "@/logger";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { waitFor } from "@testing-library/react";
import { FileSystemAdapter, type App } from "obsidian";
import {
  AgentSession,
  type AgentSessionListener,
  type AgentSessionStartOptions,
  type AgentSessionStateOptions,
} from "./AgentSession";
import { ensureMultiAgentEntitlement, showMultiAgentUpgradePrompt } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { ContextProcessor } from "@/contextProcessor";
import { GLOBAL_SCOPE } from "./scope";
import { writePermissionRequest } from "./testing/permissionPrompts";
import { OUTPUT_LIMIT_CONTINUATION_PROMPT } from "./promptEnvelope";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { AuthRequiredError, MethodUnsupportedError } from "./errors";
import type { FanoutRunInput } from "./fanout/FanoutOrchestrator";
import type { FanoutTurn } from "./fanout/fanoutTypes";
import type {
  AgentChatMessage,
  AgentToolCallOutput,
  BackendDescriptor,
  BackendProcess,
  BackendState,
  CopilotMode,
  EnabledModelEntry,
  PromptInput,
  SessionEvent,
  SessionUpdateHandler,
  StopReason,
  TurnEnd,
} from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

interface MockBackend {
  asBackend: BackendProcess;
  registerHandler: jest.Mock;
  emit: (event: SessionEvent) => void;
  emitUpdate: (update: SessionEvent["update"], occurredAt?: number) => void;
  prompt: jest.Mock;
  cancel: jest.Mock;
  closeSession: jest.Mock;
  newSession: jest.Mock;
  setSessionModel: jest.Mock;
  setSessionConfigOption: jest.Mock;
  setSessionMode: jest.Mock;
  listSessions: jest.Mock;
}

function emptyState(): BackendState {
  return { model: null, mode: null };
}

function makeMockBackend(): MockBackend {
  let handler: SessionUpdateHandler | null = null;
  const registerHandler = jest.fn((_id: string, h: SessionUpdateHandler) => {
    handler = h;
    return () => {
      handler = null;
    };
  });
  const prompt = jest.fn(
    async (_input: PromptInput): Promise<Omit<TurnEnd, "turnId">> => ({ stopReason: "end_turn" })
  );
  const emitTurn = (update: SessionEvent["update"]) => handler?.({ sessionId: "acp-1", update });
  const acceptPrompt = async (input: PromptInput): Promise<void> => {
    emitTurn({ sessionUpdate: "message_delivered", promptId: input.promptId });
    emitTurn({ sessionUpdate: "turn_started", turnId: input.promptId });
    void prompt(input).then(
      (outcome) => emitTurn({ sessionUpdate: "turn_ended", turnId: input.promptId, ...outcome }),
      (error: unknown) =>
        emitTurn({
          sessionUpdate: "turn_ended",
          turnId: input.promptId,
          stopReason: "end_turn",
          error: error as Error,
        })
    );
  };
  const cancel = jest.fn(async () => undefined);
  const closeSession = jest.fn(async () => undefined);
  const newSession = jest.fn(async () => ({ sessionId: "acp-1", state: emptyState() }));
  const setSessionModel = jest.fn(async () => emptyState());
  const setSessionConfigOption = jest.fn(async () => emptyState());
  const setSessionMode = jest.fn(async () => emptyState());
  const listSessions = jest.fn(async () => ({ sessions: [] }));
  const backend: BackendProcess = {
    isRunning: () => true,
    onExit: () => () => {},
    setPermissionPrompter: () => {},
    registerSessionHandler: registerHandler,
    newSession: newSession,
    prompt: acceptPrompt,
    cancel: cancel,
    closeSession,
    setSessionModel: setSessionModel,
    isSetSessionModelSupported: () => true,
    setSessionMode: setSessionMode,
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: setSessionConfigOption,
    isSetSessionConfigOptionSupported: () => true,
    listSessions: listSessions,
    resumeSession: () => Promise.reject(new MethodUnsupportedError("resume")),
    loadSession: () => Promise.reject(new MethodUnsupportedError("load")),
    shutdown: async () => {},
  };
  return {
    asBackend: backend,
    registerHandler,
    prompt,
    cancel,
    closeSession,
    newSession,
    setSessionModel,
    setSessionConfigOption,
    setSessionMode,
    listSessions,
    emit: (event) => handler?.(event),
    emitUpdate: (update, occurredAt) =>
      handler?.({
        sessionId: "acp-1",
        update,
        ...(occurredAt === undefined ? {} : { occurredAt }),
      }),
  };
}

function summarizingDescriptor(): BackendDescriptor {
  return { summarizesSessionTitle: true } as unknown as BackendDescriptor;
}

function nonSummarizingDescriptor(): BackendDescriptor {
  return { summarizesSessionTitle: false } as unknown as BackendDescriptor;
}

function makeWireOnlyDescriptor(): BackendDescriptor {
  const wire = {
    encode: (selection: { baseModelId: string; effort: string | null }) =>
      selection.effort ? `${selection.baseModelId}/${selection.effort}` : selection.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
  };
  return {
    wire,
    applySelection: (
      session: AgentSession,
      selection: { baseModelId: string; effort: string | null }
    ) => session.applyModelWireId(wire.encode(selection)),
  } as unknown as BackendDescriptor;
}

function makeConfigOptionDescriptor(): BackendDescriptor {
  const wire = {
    encode: (selection: { baseModelId: string; effort: string | null }) =>
      selection.effort ? `${selection.baseModelId}/${selection.effort}` : selection.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
  };
  return {
    wire,
    applySelection: async (
      session: AgentSession,
      selection: { baseModelId: string; effort: string | null }
    ) => {
      const apply = session.getState()?.model?.apply;
      if (apply?.kind === "setConfigOption" && apply.effortConfigId) {
        const currentBase = session.getState()?.model?.current.baseModelId;
        if (currentBase !== selection.baseModelId) {
          await session.applyModelWireId(
            wire.encode({ baseModelId: selection.baseModelId, effort: null })
          );
        }
        const effort = resolveEffort(
          selection.effort,
          session
            .getState()
            ?.model?.availableModels.find((model) => model.baseModelId === selection.baseModelId)
            ?.effortOptions
        );
        if (effort !== null) {
          const refreshed = session.getState()?.model?.apply;
          const effortConfigId =
            refreshed?.kind === "setConfigOption" ? refreshed.effortConfigId : undefined;
          if (effortConfigId) await session.setConfigOption(effortConfigId, effort);
        }
        return;
      }
      await session.applyModelWireId(wire.encode(selection));
    },
  } as unknown as BackendDescriptor;
}

function makeDescriptorWireWithoutEffort(): BackendDescriptor {
  const wire = {
    encode: (selection: { baseModelId: string; effort: string | null }) => selection.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
    effortConfigFor: () => ({ id: "effort", kind: "select" }),
  };
  return {
    wire,
    applySelection: async (
      session: AgentSession,
      selection: { baseModelId: string; effort: string | null }
    ) => {
      const currentBase = session.getState()?.model?.current.baseModelId;
      if (currentBase !== selection.baseModelId)
        await session.applyModelWireId(wire.encode(selection));
      if (selection.effort !== null) await session.setConfigOption("effort", selection.effort);
    },
  } as unknown as BackendDescriptor;
}

function makeSession(
  mock: MockBackend,
  { initialState = null, ...overrides }: ResumedSessionOverrides = {}
): AgentSession {
  const session = makeAwaitingResumeSession(mock, overrides);
  session.completeResume(initialState);
  return session;
}

const replayText = (
  sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
  text: string,
  messageId?: string
): SessionEvent["update"] => ({
  sessionUpdate,
  content: { type: "text", text },
  messageId,
});

function bubbles(session: AgentSession): { sender: string; message: string }[] {
  return session.store.getDisplayMessages().map((m) => ({ sender: m.sender, message: m.message }));
}

interface ResumedSessionOverrides extends Partial<AgentSessionStateOptions> {
  initialState?: BackendState | null;
}

function makeAwaitingResumeSession(
  mock: MockBackend,
  overrides: Partial<AgentSessionStateOptions> = {}
): AgentSession {
  return new AgentSession({
    backend: mock.asBackend,
    backendSessionId: "acp-1",
    internalId: "internal-1",
    backendId: "opencode",
    ...overrides,
  });
}

function startSession(
  mock: MockBackend,
  overrides: Partial<AgentSessionStartOptions> = {}
): AgentSession {
  return AgentSession.start({
    backend: mock.asBackend,
    cwd: "/vault",
    internalId: "internal-1",
    backendId: "opencode",
    ...overrides,
  });
}

function midTurnDescriptor(): BackendDescriptor {
  return { midTurnDelivery: true } as unknown as BackendDescriptor;
}

function recordPrompts(mock: MockBackend): PromptInput[] {
  const sent: PromptInput[] = [];
  mock.asBackend.prompt = async (input) => {
    sent.push(input);
  };
  return sent;
}

function promptText(input: PromptInput): string {
  return input.prompt.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function holdPrompt(mock: MockBackend): (stopReason?: StopReason) => void {
  let resolve: (result: { stopReason: StopReason }) => void = () => {};
  mock.prompt.mockImplementation(() => new Promise((r) => (resolve = r)));
  return (stopReason = "end_turn") => resolve({ stopReason });
}

function aiMessages(session: AgentSession) {
  return session.store.getDisplayMessages().filter((m) => m.sender === AI_SENDER);
}

function aiMessage(session: AgentSession) {
  return aiMessages(session)[0];
}

function subscribeTo(session: AgentSession, listener: Partial<AgentSessionListener> = {}) {
  return session.subscribe({
    onMessagesChanged: () => {},
    onStatusChanged: () => {},
    ...listener,
  });
}

const PLUS_FLASH = "copilot-plus/copilot-plus-flash";
const STEP_FLASH = "openrouter/stepfun/step-3.5-flash";
const BIG_PICKLE = "opencode/big-pickle";
const FLEDGE = "opencode/fledge-alpha-free";
const PARETO = "openrouter/unbiased/pareto-26.10-preview";

function enabledModel(baseModelId: string): EnabledModelEntry {
  return { baseModelId, name: baseModelId, credentialState: "ok" };
}

function enabledModelsOnlyDescriptor(enabled: EnabledModelEntry[]): BackendDescriptor {
  return {
    ...makeWireOnlyDescriptor(),
    displayName: "opencode",
    routesCopilotModels: true,
    getEnabledModelEntries: () => enabled,
  };
}

function catalogState(
  modelIds: string[],
  current: string,
  modes: CopilotMode[] = ["auto"]
): BackendState {
  return {
    model: {
      current: { baseModelId: current, effort: null },
      apply: { kind: "setConfigOption", configId: "model" },
      availableModels: modelIds.map((baseModelId) => ({
        baseModelId,
        name: baseModelId,
        provider: null,
        effortOptions: [],
      })),
    },
    mode: {
      current: "auto",
      options: modes.map((value) => ({ value, label: value })),
      apply: Object.fromEntries(
        modes.map((value) => [value, { kind: "setConfigOption", configId: "mode", value }])
      ),
    },
  };
}

function fakeCatalogAgent(
  mock: MockBackend,
  initial: BackendState
): { push: (next: BackendState) => void } {
  let state = initial;
  mock.newSession.mockResolvedValue({ sessionId: "acp-1", state });
  mock.setSessionConfigOption.mockImplementation(
    async ({ configId, value }: { configId: string; value: string }) => {
      if (configId === "model") {
        if (!state.model?.availableModels.some((entry) => entry.baseModelId === value)) {
          throw new Error("Invalid params: model not found");
        }
        state = {
          ...state,
          model: { ...state.model, current: { baseModelId: value, effort: null } },
        };
      }
      if (configId === "mode" && state.mode) {
        state = { ...state, mode: { ...state.mode, current: value as CopilotMode } };
      }
      return state;
    }
  );
  return {
    push: (next) => {
      state = next;
      mock.emitUpdate({ sessionUpdate: "state_changed", state: next });
    },
  };
}

function sonnetAndGpt5State(): BackendState {
  return {
    model: {
      current: { baseModelId: "anthropic/sonnet", effort: null },
      apply: { kind: "setModel" },
      availableModels: [
        {
          baseModelId: "anthropic/sonnet",
          name: "Claude Sonnet",
          provider: "anthropic",
          effortOptions: [],
        },
        { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
      ],
    },
    mode: null,
  };
}

describe("AgentSession", () => {
  describe("AgentSession", () => {
    describe("constructor()", () => {
      it("mints a distinct chat input id unless one is explicitly provided", () => {
        const mock = makeMockBackend();
        const fresh = makeSession(mock);
        const preserved = makeSession(mock, {
          backendSessionId: "acp-2",
          internalId: "internal-2",
          chatInputId: "chat-input-1",
        });

        expect(fresh.chatInputId).not.toBe(fresh.internalId);
        expect(preserved.chatInputId).toBe("chat-input-1");
      });

      it("defaults to GLOBAL_SCOPE when no projectId option is given", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        expect(session.projectId).toBe(GLOBAL_SCOPE);
      });

      it("binds the provided projectId (immutable, like backendId)", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { projectId: "proj-42" });
        expect(session.projectId).toBe("proj-42");
      });

      it("stays starting on an adopted session until setModel resolves so sendPrompt can't fire on the probe model", async () => {
        const mock = makeMockBackend();
        const probeState: BackendState = {
          model: {
            current: { baseModelId: "anthropic/sonnet", effort: null },
            apply: { kind: "setModel" },
            availableModels: [
              {
                baseModelId: "anthropic/sonnet",
                name: "Sonnet",
                provider: "anthropic",
                effortOptions: [],
              },
              { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
            ],
          },
          mode: null,
        };
        let resolveSetModel!: (s: BackendState) => void;
        mock.setSessionModel.mockImplementationOnce(
          () => new Promise<BackendState>((resolve) => (resolveSetModel = resolve))
        );

        const session = makeSession(mock, {
          backendSessionId: "probe-1",
          initialState: probeState,
          defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
          getDescriptor: () => makeWireOnlyDescriptor(),
        });

        await waitFor(() => {
          expect(mock.setSessionModel).toHaveBeenCalledWith({
            sessionId: "probe-1",
            modelId: "openai/gpt-5",
          });
        });
        expect(session.getStatus()).toBe("starting");
        expect(() => session.sendPrompt("too early")).toThrow("Session is still starting");
        expect(mock.prompt).not.toHaveBeenCalled();

        resolveSetModel({
          model: {
            ...probeState.model!,
            current: { baseModelId: "openai/gpt-5", effort: null },
          },
          mode: null,
        });
        await session.ready;
        expect(session.getState()?.model?.current.baseModelId).toBe("openai/gpt-5");
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 keeps a session usable when a saved selection cannot be encoded", async () => {
        const mock = makeMockBackend();
        const descriptor = makeWireOnlyDescriptor();
        descriptor.wire.encode = () => {
          throw new Error("Choose an explicit effort");
        };
        const initialState = emptyState();
        const session = makeSession(mock, {
          backendSessionId: "probe-1",
          backendId: "codex",
          initialState,
          defaultModelSelection: { baseModelId: "saved-model", effort: null },
          getDescriptor: () => descriptor,
        });
        await session.ready;
        expect(session.getStatus()).toBe("idle");
        expect(session.getState()).toBe(initialState);
        expect(mock.setSessionModel).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 moves a resumed session off a model the user has not enabled onto the first enabled one", async () => {
        const mock = makeMockBackend();
        const resumedState = catalogState([PARETO, STEP_FLASH], PARETO);
        fakeCatalogAgent(mock, resumedState);
        const session = makeSession(mock, {
          initialState: resumedState,
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(STEP_FLASH)]),
        });

        await session.ready;

        expect(session.getState()?.model?.current.baseModelId).toBe(STEP_FLASH);
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 keeps the agent's model and refuses turns when a resumed session cannot be switched to the enabled default", async () => {
        const mock = makeMockBackend();
        const resumedState = catalogState([PLUS_FLASH, PARETO], PARETO);
        fakeCatalogAgent(mock, resumedState);
        mock.setSessionConfigOption.mockRejectedValue(new Error("Invalid params: model not found"));
        const session = makeSession(mock, {
          initialState: resumedState,
          defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
        });

        await session.ready;

        expect(session.getState()?.model?.current.baseModelId).toBe(PARETO);
        expect(await session.sendPrompt("hello").turn).toBe("refusal");
        expect(mock.prompt).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 waits for a late catalog to list an enabled model, then moves a resumed session off its disabled model", async () => {
        const mock = makeMockBackend();
        const resumedState = catalogState([PARETO], PARETO);
        const agent = fakeCatalogAgent(mock, resumedState);
        const session = makeSession(mock, {
          initialState: resumedState,
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(STEP_FLASH)]),
        });
        expect(session.getStatus()).toBe("starting");

        agent.push(catalogState([PARETO, STEP_FLASH], PARETO));
        await session.ready;

        expect(session.getState()?.model?.current.baseModelId).toBe(STEP_FLASH);
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 leaves a resumed session open for picking a model, but refuses its turns, when no enabled model is offered within 10 seconds", async () => {
        jest.useFakeTimers();
        try {
          const mock = makeMockBackend();
          const resumedState = catalogState([PARETO], PARETO);
          fakeCatalogAgent(mock, resumedState);
          const session = makeSession(mock, {
            initialState: resumedState,
            getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(BIG_PICKLE)]),
          });

          await jest.advanceTimersByTimeAsync(9_999);
          expect(session.getStatus()).toBe("starting");

          await jest.advanceTimersByTimeAsync(1);
          await session.ready;

          expect(session.getStatus()).toBe("idle");
          expect(await session.sendPrompt("hello").turn).toBe("refusal");
          expect(mock.prompt).not.toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 applies the saved Copilot mode to a resumed session once a late catalog update lists it", async () => {
        const mock = makeMockBackend();
        const resumedState = catalogState([BIG_PICKLE], BIG_PICKLE, ["auto"]);
        const agent = fakeCatalogAgent(mock, resumedState);
        const session = makeSession(mock, {
          initialState: resumedState,
          defaultMode: "default",
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(BIG_PICKLE)]),
        });
        expect(session.getStatus()).toBe("starting");

        agent.push(catalogState([BIG_PICKLE], BIG_PICKLE, ["default", "auto"]));
        await session.ready;

        expect(session.getState()?.mode?.current).toBe("default");
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/638 attaches a replayed compaction to the reply it followed, ahead of the next user message, without a dropped-update warning", () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);
        jest.mocked(logWarn).mockClear();

        mock.emitUpdate(replayText("user_message_chunk", "first", "u1"));
        mock.emitUpdate(replayText("agent_message_chunk", "one", "a1"));
        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "c1",
          status: "completed",
          trigger: "manual",
        });
        mock.emitUpdate(replayText("user_message_chunk", "second", "u2"));
        mock.emitUpdate(replayText("agent_message_chunk", "two", "a2"));
        session.completeResume(emptyState());

        const [, firstReply, , secondReply] = session.store.getDisplayMessages();
        expect(session.store.getDisplayMessages()).toHaveLength(4);
        expect(firstReply.parts?.map((p) => p.kind)).toEqual(["text", "compaction"]);
        expect(firstReply.parts?.[1]).toMatchObject({
          kind: "compaction",
          id: "c1",
          status: "completed",
          trigger: "manual",
        });
        expect(secondReply.parts?.map((p) => p.kind)).toEqual(["text"]);
        expect(logWarn).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/638 keeps the meter reading a replayed compaction's post-compaction tokens would otherwise overwrite", () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);
        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 90_000, contextWindow: 200_000, updatedAt: 1 },
        });

        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "c1",
          status: "completed",
          trigger: "manual",
          postTokens: 4_000,
        });

        expect(session.getSessionUsage()).toEqual({
          usedTokens: 90_000,
          contextWindow: 200_000,
          updatedAt: 1,
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 does not open a plan-approval card for a replayed ExitPlanMode call", async () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);
        const onCurrentPlanChanged = jest.fn();
        subscribeTo(session, { onCurrentPlanChanged });

        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "exit-1",
          title: "ExitPlanMode",
          kind: "switch_mode",
          status: "completed",
          rawInput: { plan: "# Old plan\n\n1. step" },
        });
        session.completeResume(emptyState());
        await session.ready;

        expect(session.getCurrentPlan()).toBeNull();
        expect(onCurrentPlanChanged).not.toHaveBeenCalled();
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/643 restores the last replayed task list as the current todo list", async () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);
        const onCurrentTodoListChanged = jest.fn();
        subscribeTo(session, { onCurrentTodoListChanged });

        mock.emitUpdate({
          sessionUpdate: "plan",
          entries: [{ content: "step", status: "pending", priority: "medium" }],
        });
        mock.emitUpdate({
          sessionUpdate: "plan",
          entries: [{ content: "step", status: "completed", priority: "medium" }],
        });
        session.completeResume(emptyState());
        await session.ready;

        expect(session.getCurrentTodoList()).toEqual([{ content: "step", status: "completed" }]);
        expect(onCurrentTodoListChanged).toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 gives a replayed reply the agent started on its own its own bubble when the replay ends the turn before it", () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);

        mock.emitUpdate(replayText("user_message_chunk", "start a task", "u1"));
        mock.emitUpdate(replayText("agent_message_chunk", "Started.", "a1"));
        mock.emitUpdate({ sessionUpdate: "turn_ended", turnId: "", stopReason: "end_turn" });
        mock.emitUpdate(replayText("agent_message_chunk", "The task finished.", "a2"));

        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "start a task" },
          { sender: AI_SENDER, message: "Started." },
          { sender: AI_SENDER, message: "The task finished." },
        ]);
        expect(session.getStatus()).toBe("starting");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 keeps handling state and usage updates normally while history is collected", () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);
        const state = catalogState([PARETO], PARETO);

        mock.emitUpdate({ sessionUpdate: "state_changed", state });

        expect(session.getState()).toBe(state);
        expect(bubbles(session)).toEqual([]);
      });

      it("ready resolves immediately when no default selection is supplied", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, {
          backendSessionId: "probe-1",
          initialState: emptyState(),
        });
        await session.ready;
        expect(mock.setSessionModel).not.toHaveBeenCalled();
      });
    });

    describe("completeResume()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 collects replayed frames before the backend state arrives and stays starting until it does", async () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);

        mock.emitUpdate(replayText("user_message_chunk", "hi", "u1"));
        mock.emitUpdate(replayText("agent_message_chunk", "hello", "a1"));

        expect(session.getStatus()).toBe("starting");
        expect(mock.registerHandler).toHaveBeenCalledWith("acp-1", expect.any(Function));
        expect(bubbles(session).map((b) => b.message)).toEqual(["hi", "hello"]);

        const state = emptyState();
        session.completeResume(state);
        await session.ready;

        expect(session.getState()).toBe(state);
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 keeps the history collected before the backend state, including a user message still open, and drops out-of-turn conversation frames that arrive afterwards", () => {
        const mock = makeMockBackend();
        const session = makeAwaitingResumeSession(mock);
        mock.emitUpdate(replayText("user_message_chunk", "earlier", "u1"));

        session.completeResume(emptyState());
        mock.emitUpdate(replayText("user_message_chunk", "echo", "u2"));
        mock.emitUpdate(replayText("agent_message_chunk", "background", "a1"));

        expect(bubbles(session)).toEqual([{ sender: USER_SENDER, message: "earlier" }]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 ends history right away for a session that starts with its state, so out-of-turn frames are not taken for past turns", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { initialState: emptyState() });

        mock.emitUpdate(replayText("user_message_chunk", "echo", "u1"));
        mock.emitUpdate(replayText("agent_message_chunk", "background", "a1"));

        expect(bubbles(session)).toEqual([]);
      });

      it("applies the startup selection only after the state arrives and holds ready until it is applied", async () => {
        const mock = makeMockBackend();
        const state = sonnetAndGpt5State();
        let resolveSetModel!: (s: BackendState) => void;
        mock.setSessionModel.mockImplementationOnce(
          () => new Promise<BackendState>((resolve) => (resolveSetModel = resolve))
        );
        const session = makeAwaitingResumeSession(mock, {
          defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
          getDescriptor: () => makeWireOnlyDescriptor(),
        });
        let readySettled = false;
        void session.ready.then(() => (readySettled = true));
        expect(mock.setSessionModel).not.toHaveBeenCalled();

        session.completeResume(state);
        await waitFor(() => expect(mock.setSessionModel).toHaveBeenCalled());
        expect(session.getStatus()).toBe("starting");
        expect(readySettled).toBe(false);

        resolveSetModel({
          ...state,
          model: { ...state.model!, current: { baseModelId: "openai/gpt-5", effort: null } },
        });
        await session.ready;

        expect(readySettled).toBe(true);
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 moves a session that attached before its state arrived onto the enabled model", async () => {
        const mock = makeMockBackend();
        const resumedState = catalogState([PARETO, STEP_FLASH], PARETO);
        fakeCatalogAgent(mock, resumedState);
        const session = makeAwaitingResumeSession(mock, {
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(STEP_FLASH)]),
        });

        session.completeResume(resumedState);
        await session.ready;

        expect(session.getState()?.model?.current.baseModelId).toBe(STEP_FLASH);
        expect(await session.sendPrompt("hello").turn).toBe("end_turn");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 refuses turns on a model the user has not enabled after a deferred resume cannot switch it", async () => {
        const mock = makeMockBackend();
        const resumedState = catalogState([PLUS_FLASH, PARETO], PARETO);
        fakeCatalogAgent(mock, resumedState);
        mock.setSessionConfigOption.mockRejectedValue(new Error("Invalid params: model not found"));
        const session = makeAwaitingResumeSession(mock, {
          defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
        });

        session.completeResume(resumedState);
        await session.ready;

        expect(await session.sendPrompt("hello").turn).toBe("refusal");
        expect(mock.prompt).not.toHaveBeenCalled();
      });
    });

    describe("start()", () => {
      it("exposes the model catalog reported by newSession through getState", async () => {
        const mock = makeMockBackend();
        const stateWithModel = sonnetAndGpt5State();
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithModel });
        const session = startSession(mock);
        await session.ready;
        expect(session.getState()?.model?.current.baseModelId).toBe("anthropic/sonnet");
        expect(session.getState()?.model?.availableModels).toHaveLength(2);
      });

      it("creates the backend session in the global scope when started with defaults", async () => {
        const mock = makeMockBackend();
        const session = startSession(mock);
        await session.ready;
        expect(mock.newSession).toHaveBeenCalledWith({ cwd: "/vault", projectId: GLOBAL_SCOPE });
      });

      it("passes the plugin's MCP servers into the newSession payload", async () => {
        const mock = makeMockBackend();
        const mcpServers = [
          { name: "obsidian-copilot", url: "http://127.0.0.1:1/mcp", headers: { A: "b" } },
        ];
        const session = startSession(mock, { mcpServers });
        await session.ready;
        expect(mock.newSession).toHaveBeenCalledWith(expect.objectContaining({ mcpServers }));
      });

      it("passes the session's projectId into the newSession payload", async () => {
        const mock = makeMockBackend();
        const session = startSession(mock, { cwd: "/vault/Projects/p", projectId: "proj-7" });
        await session.ready;
        expect(mock.newSession).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: "/vault/Projects/p", projectId: "proj-7" })
        );
      });

      it("confirms a Claude-style seed against the backend-reported model", async () => {
        const mock = makeMockBackend();
        const stateWithSonnet = sonnetAndGpt5State();
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithSonnet });
        const session = startSession(mock, {
          backendId: "claude",
          defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
          getDescriptor: () => ClaudeBackendDescriptor,
        });
        await session.ready;
        expect(mock.setSessionModel).toHaveBeenCalledWith({
          sessionId: "acp-1",
          modelId: "openai/gpt-5",
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/630 reports the agent's own model until the startup switch lands, then the chat's", async () => {
        const mock = makeMockBackend();
        const stateWithSonnet = sonnetAndGpt5State();
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithSonnet });
        let resolveSetModel: ((s: BackendState) => void) | null = null;
        mock.setSessionModel.mockImplementationOnce(
          () => new Promise<BackendState>((resolve) => (resolveSetModel = resolve))
        );
        const session = startSession(mock, {
          defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
          getDescriptor: () => makeWireOnlyDescriptor(),
        });

        const observed: Array<string | undefined> = [];
        subscribeTo(session, {
          onModelChanged: () => observed.push(session.getState()?.model?.current.baseModelId),
        });

        await waitFor(() => {
          expect(mock.setSessionModel).toHaveBeenCalledWith({
            sessionId: "acp-1",
            modelId: "openai/gpt-5",
          });
        });
        expect(observed).toEqual(["anthropic/sonnet"]);

        resolveSetModel!({
          ...stateWithSonnet,
          model: {
            ...stateWithSonnet.model!,
            current: { baseModelId: "openai/gpt-5", effort: null },
          },
        });
        await session.ready;

        expect(observed).toEqual(["anthropic/sonnet", "openai/gpt-5"]);
      });

      it("stays starting until a newly created session has had the desired model applied", async () => {
        const mock = makeMockBackend();
        const backendState: BackendState = {
          model: {
            current: { baseModelId: "kimi-2.6", effort: null },
            apply: { kind: "setModel" },
            availableModels: [
              { baseModelId: "kimi-2.6", name: "Kimi 2.6", provider: "moon", effortOptions: [] },
              {
                baseModelId: "big-pickle",
                name: "Big Pickle",
                provider: "moon",
                effortOptions: [],
              },
            ],
          },
          mode: null,
        };
        let resolveNewSession: ((r: { sessionId: string; state: BackendState }) => void) | null =
          null;
        mock.newSession.mockImplementationOnce(
          () =>
            new Promise<{ sessionId: string; state: BackendState }>(
              (resolve) => (resolveNewSession = resolve)
            )
        );
        let resolveSetModel: ((state: BackendState) => void) | null = null;
        mock.setSessionModel.mockImplementationOnce(
          () => new Promise<BackendState>((resolve) => (resolveSetModel = resolve))
        );
        const session = startSession(mock, {
          defaultModelSelection: { baseModelId: "big-pickle", effort: null },
          getDescriptor: () => makeWireOnlyDescriptor(),
        });

        expect(session.getState()).toBeNull();

        resolveNewSession!({ sessionId: "acp-1", state: backendState });
        await waitFor(() => {
          expect(session.getState()?.model?.current.baseModelId).toBe("kimi-2.6");
          expect(mock.setSessionModel).toHaveBeenCalledWith({
            sessionId: "acp-1",
            modelId: "big-pickle",
          });
        });
        expect(session.getStatus()).toBe("starting");
        expect(() => session.sendPrompt("too early")).toThrow("Session is still starting");
        expect(mock.prompt).not.toHaveBeenCalled();

        resolveSetModel!({
          ...backendState,
          model: backendState.model
            ? {
                ...backendState.model,
                current: { baseModelId: "big-pickle", effort: null },
              }
            : null,
        });
        await session.ready;
        expect(session.getState()?.model?.current.baseModelId).toBe("big-pickle");
        expect(session.getStatus()).toBe("idle");
      });

      it("applies a seeded effort via setConfigOption without a redundant setModel", async () => {
        const mock = makeMockBackend();
        const backendState: BackendState = {
          model: {
            current: { baseModelId: "anthropic/sonnet", effort: "low" },
            apply: { kind: "setModel" },
            availableModels: [
              {
                baseModelId: "anthropic/sonnet",
                name: "Claude Sonnet",
                provider: "anthropic",
                effortOptions: [
                  { value: "low", label: "Low" },
                  { value: "high", label: "High" },
                ],
              },
            ],
          },
          mode: null,
        };
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: backendState });
        mock.setSessionConfigOption.mockResolvedValueOnce({
          model: {
            ...backendState.model!,
            current: { baseModelId: "anthropic/sonnet", effort: "high" },
          },
          mode: null,
        });
        const session = startSession(mock, {
          backendId: "claude",
          defaultModelSelection: { baseModelId: "anthropic/sonnet", effort: "high" },
          getDescriptor: () => makeDescriptorWireWithoutEffort(),
        });
        await session.ready;
        expect(mock.setSessionModel).not.toHaveBeenCalled();
        expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "acp-1",
          configId: "effort",
          value: "high",
        });
        expect(session.getState()?.model?.current.effort).toBe("high");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/630 keeps the agent's own model and starts when the startup switch fails", async () => {
        const mock = makeMockBackend();
        const stateWithSonnet = sonnetAndGpt5State();
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithSonnet });
        mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
        const session = startSession(mock, {
          defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
          getDescriptor: () => makeWireOnlyDescriptor(),
        });
        await session.ready;
        expect(session.getStatus()).toBe("idle");
        expect(session.getState()?.model?.current.baseModelId).toBe("anthropic/sonnet");
      });

      it("seeds config-option opencode effort via the effort option, not the model id", async () => {
        const mock = makeMockBackend();
        const gpt5Entry = {
          baseModelId: "openai/gpt-5",
          name: "GPT-5",
          provider: "openai",
          effortOptions: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        };
        const reportedState: BackendState = {
          model: {
            current: { baseModelId: "anthropic/sonnet", effort: null },
            apply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought_level" },
            availableModels: [
              {
                baseModelId: "anthropic/sonnet",
                name: "Sonnet",
                provider: "anthropic",
                effortOptions: [],
              },
              gpt5Entry,
            ],
          },
          mode: null,
        };
        const switchedState: BackendState = {
          model: {
            current: { baseModelId: "openai/gpt-5", effort: null },
            apply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought_level" },
            availableModels: [reportedState.model!.availableModels[0], gpt5Entry],
          },
          mode: null,
        };
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: reportedState });
        let resolveModelSwitch!: (state: BackendState) => void;
        mock.setSessionConfigOption
          .mockImplementationOnce(
            () => new Promise<BackendState>((resolve) => (resolveModelSwitch = resolve))
          )
          .mockResolvedValue(switchedState);

        const session = startSession(mock, {
          defaultModelSelection: { baseModelId: "openai/gpt-5", effort: "high" },
          getDescriptor: () => makeConfigOptionDescriptor(),
        });
        await waitFor(() =>
          expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
            sessionId: "acp-1",
            configId: "model",
            value: "openai/gpt-5",
          })
        );
        expect(session.getState()?.model?.current.baseModelId).toBe("anthropic/sonnet");

        resolveModelSwitch(switchedState);
        await session.ready;

        expect(mock.setSessionModel).not.toHaveBeenCalled();
        expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "acp-1",
          configId: "model",
          value: "openai/gpt-5",
        });
        expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "acp-1",
          configId: "thought_level",
          value: "high",
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 applies the lowest effort when a saved preference omits effort", async () => {
        const mock = makeMockBackend();
        const entry = {
          baseModelId: "openai/gpt-5",
          name: "GPT-5",
          provider: "openai",
          effortOptions: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        };
        const staleState: BackendState = {
          model: {
            current: { baseModelId: "openai/gpt-5", effort: "high" },
            apply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought_level" },
            availableModels: [entry],
          },
          mode: null,
        };
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: staleState });
        mock.setSessionConfigOption.mockResolvedValue({
          model: { ...staleState.model!, current: { baseModelId: "openai/gpt-5", effort: "low" } },
          mode: null,
        });

        jest.mocked(getSettings).mockReturnValue({
          agentMode: {},
          providers: {
            zen: {
              providerId: "zen",
              displayName: "OpenCode Zen",
              origin: { kind: "agent", agentType: "opencode" },
            },
          },
          configuredModels: [
            {
              configuredModelId: "gpt-5",
              providerId: "zen",
              info: { id: "openai/gpt-5", displayName: "GPT-5" },
            },
          ],
          backends: { opencode: { enabledModels: ["gpt-5"] } },
        } as never);
        try {
          const session = startSession(mock, {
            defaultModelSelection: { baseModelId: "openai/gpt-5", effort: null },
            getDescriptor: () => OpencodeBackendDescriptor,
          });
          await session.ready;

          expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
            sessionId: "acp-1",
            configId: "thought_level",
            value: "low",
          });
          expect(session.getState()?.model?.current.effort).toBe("low");
        } finally {
          jest.mocked(getSettings).mockReturnValue({ agentMode: {} } as never);
        }
      });

      describe("on a backend that may only run models the user enabled", () => {
        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 applies an enabled default the first catalog already lists, without waiting for an update", async () => {
          const mock = makeMockBackend();
          fakeCatalogAgent(mock, catalogState([FLEDGE, PLUS_FLASH], FLEDGE));
          const session = startSession(mock, {
            defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
            getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
          });

          await session.ready;

          expect(session.getState()?.model?.current.baseModelId).toBe(PLUS_FLASH);
          expect(session.getStatus()).toBe("idle");
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 stays starting until a catalog update lists the enabled default, then applies it", async () => {
          const mock = makeMockBackend();
          const agent = fakeCatalogAgent(mock, catalogState([FLEDGE, BIG_PICKLE], FLEDGE));
          const session = startSession(mock, {
            defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
            getDescriptor: () =>
              enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH), enabledModel(BIG_PICKLE)]),
          });
          await waitFor(() => expect(session.getState()).not.toBeNull());

          expect(session.getStatus()).toBe("starting");
          expect(() => session.sendPrompt("too early")).toThrow("Session is still starting");

          agent.push(catalogState([FLEDGE, BIG_PICKLE, PLUS_FLASH, PARETO], PARETO));
          await session.ready;

          expect(session.getState()?.model?.current.baseModelId).toBe(PLUS_FLASH);
          expect(session.getStatus()).toBe("idle");
          expect(mock.setSessionConfigOption).toHaveBeenCalledTimes(1);
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 falls back to the first enabled model in the catalog when the default is still missing after 10 seconds", async () => {
          jest.useFakeTimers();
          try {
            const mock = makeMockBackend();
            fakeCatalogAgent(mock, catalogState([FLEDGE, STEP_FLASH], FLEDGE));
            const session = startSession(mock, {
              defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
              getDescriptor: () =>
                enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH), enabledModel(STEP_FLASH)]),
            });

            await jest.advanceTimersByTimeAsync(9_999);
            expect(session.getStatus()).toBe("starting");

            await jest.advanceTimersByTimeAsync(1);
            await session.ready;

            expect(session.getState()?.model?.current.baseModelId).toBe(STEP_FLASH);
            expect(session.getStatus()).toBe("idle");
          } finally {
            jest.useRealTimers();
          }
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 falls back at once to an offered enabled model when the default's provider key is missing", async () => {
          const mock = makeMockBackend();
          fakeCatalogAgent(mock, catalogState([FLEDGE, STEP_FLASH], FLEDGE));
          const session = startSession(mock, {
            defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
            getDescriptor: () =>
              enabledModelsOnlyDescriptor([
                { ...enabledModel(PLUS_FLASH), credentialState: "missing_key" },
                enabledModel(STEP_FLASH),
              ]),
          });

          await session.ready;

          expect(session.getState()?.model?.current.baseModelId).toBe(STEP_FLASH);
          expect(session.getStatus()).toBe("idle");
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 keeps the agent's model and refuses turns when switching to the enabled default fails during startup", async () => {
          const mock = makeMockBackend();
          fakeCatalogAgent(mock, catalogState([PLUS_FLASH, PARETO], PARETO));
          mock.setSessionConfigOption.mockRejectedValue(
            new Error("Invalid params: model not found")
          );
          const session = startSession(mock, {
            defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
            getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
          });

          await expect(session.ready).rejects.toThrow("model not found");

          expect(session.getState()?.model?.current.baseModelId).toBe(PARETO);
          expect(await session.sendPrompt("hello").turn).toBe("refusal");
          expect(mock.prompt).not.toHaveBeenCalled();
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 fails to start, keeping the agent's model, when no enabled model reaches the catalog within 10 seconds", async () => {
          jest.useFakeTimers();
          try {
            const mock = makeMockBackend();
            fakeCatalogAgent(mock, catalogState([FLEDGE], FLEDGE));
            const session = startSession(mock, {
              defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
              getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
            });
            const startup = session.ready.catch((error: Error) => error.message);

            await jest.advanceTimersByTimeAsync(10_000);

            expect(await startup).toBe(
              "None of the models enabled for opencode are available. Check them in Copilot's model settings."
            );
            expect(session.getStatus()).toBe("error");
            expect(session.getState()?.model?.current.baseModelId).toBe(FLEDGE);
            expect(mock.setSessionConfigOption).not.toHaveBeenCalled();
          } finally {
            jest.useRealTimers();
          }
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 stays starting until the saved Copilot mode arrives", async () => {
          const mock = makeMockBackend();
          const agent = fakeCatalogAgent(mock, catalogState([BIG_PICKLE], BIG_PICKLE, ["auto"]));
          const session = startSession(mock, {
            defaultModelSelection: { baseModelId: BIG_PICKLE, effort: null },
            defaultMode: "default",
            getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(BIG_PICKLE)]),
          });
          await waitFor(() => expect(session.getState()).not.toBeNull());
          expect(session.getStatus()).toBe("starting");

          agent.push(catalogState([BIG_PICKLE], BIG_PICKLE, ["default", "auto"]));
          await session.ready;

          expect(session.getState()?.mode?.current).toBe("default");
          expect(session.getStatus()).toBe("idle");
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 stops waiting for the catalog, without touching the agent, when the chat is closed", async () => {
          jest.useFakeTimers();
          try {
            const mock = makeMockBackend();
            fakeCatalogAgent(mock, catalogState([FLEDGE], FLEDGE));
            const session = startSession(mock, {
              defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
              getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
            });
            await jest.advanceTimersByTimeAsync(0);
            expect(session.getStatus()).toBe("starting");

            await session.dispose();

            await expect(session.ready).resolves.toBeUndefined();
            expect(mock.setSessionConfigOption).not.toHaveBeenCalled();
          } finally {
            jest.useRealTimers();
          }
        });
      });
    });

    describe("applyModelWireId()", () => {
      it("sends set_config_option when the model catalog is config-option-backed", async () => {
        const mock = makeMockBackend();
        const configBackedState: BackendState = {
          model: {
            current: { baseModelId: "omlx/a", effort: null },
            apply: { kind: "setConfigOption", configId: "model" },
            availableModels: [
              { baseModelId: "omlx/a", name: "A", provider: null, effortOptions: [] },
            ],
          },
          mode: null,
        };
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: configBackedState });
        const session = startSession(mock);
        await session.ready;
        await session.applyModelWireId("omlx/b");
        expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "acp-1",
          configId: "model",
          value: "omlx/b",
        });
        expect(mock.setSessionModel).not.toHaveBeenCalled();
      });

      it("sends set_model when the model catalog is models-backed", async () => {
        const mock = makeMockBackend();
        const modelsBackedState: BackendState = {
          model: {
            current: { baseModelId: "gpt-5", effort: null },
            apply: { kind: "setModel" },
            availableModels: [
              { baseModelId: "gpt-5", name: "GPT-5", provider: null, effortOptions: [] },
            ],
          },
          mode: null,
        };
        mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: modelsBackedState });
        const session = startSession(mock, { backendId: "codex" });
        await session.ready;
        await session.applyModelWireId("o3");
        expect(mock.setSessionModel).toHaveBeenCalledWith({ sessionId: "acp-1", modelId: "o3" });
        expect(mock.setSessionConfigOption).not.toHaveBeenCalled();
      });
    });

    describe("sendPrompt()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 refuses to run a turn, and says why, while the agent is on a model the user has not enabled", async () => {
        const mock = makeMockBackend();
        const agent = fakeCatalogAgent(mock, catalogState([PLUS_FLASH, PARETO], PLUS_FLASH));
        const session = startSession(mock, {
          defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
        });
        await session.ready;
        agent.push(catalogState([PARETO], PARETO));

        const stopReason = await session.sendPrompt("hello").turn;

        expect(stopReason).toBe("refusal");
        expect(mock.prompt).not.toHaveBeenCalled();
        expect(aiMessage(session)?.message).toBe(
          "**Error:** This chat's model isn't enabled for opencode. Pick an enabled model to continue."
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 refuses a turn whose model switches to one the user has not enabled while its web tabs load", async () => {
        const mock = makeMockBackend();
        const agent = fakeCatalogAgent(mock, catalogState([PLUS_FLASH, PARETO], PLUS_FLASH));
        const session = startSession(mock, {
          defaultModelSelection: { baseModelId: PLUS_FLASH, effort: null },
          getDescriptor: () => enabledModelsOnlyDescriptor([enabledModel(PLUS_FLASH)]),
        });
        await session.ready;
        let finishWebTabs: (text: string) => void = () => {};
        const getInstance = jest.spyOn(ContextProcessor, "getInstance").mockReturnValue({
          processContextWebTabs: () =>
            new Promise<string>((resolve) => {
              finishWebTabs = resolve;
            }),
        } as never);
        try {
          const { turn } = session.sendPrompt("hello", {
            notes: [],
            urls: [],
            webTabs: [{ url: "https://example.com" }],
          });
          await waitFor(() => expect(getInstance).toHaveBeenCalled());

          agent.push(catalogState([PARETO], PARETO));
          finishWebTabs("<web-tab />");

          expect(await turn).toBe("refusal");
          expect(mock.prompt).not.toHaveBeenCalled();
        } finally {
          getInstance.mockRestore();
        }
      });

      it("appends the user message and a running placeholder, then goes idle with the stop reason when the prompt resolves", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const { userMessageId, turn } = session.sendPrompt("Hi there");

        const messages = session.store.getDisplayMessages();
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({
          id: userMessageId,
          sender: USER_SENDER,
          message: "Hi there",
        });
        expect(messages[0].content).toBeUndefined();
        expect(messages[1]).toMatchObject({ sender: AI_SENDER, message: "" });
        expect(session.getStatus()).toBe("running");

        const stopReason = await turn;
        expect(stopReason).toBe("end_turn");
        expect(session.getStatus()).toBe("idle");
        expect(mock.prompt).toHaveBeenCalledWith({
          sessionId: "acp-1",
          promptId: userMessageId,
          prompt: [{ type: "text", text: "Hi there" }],
        });
      });

      it("uses the placeholder timestamp as the live start and freezes elapsed time on completion", async () => {
        jest.useFakeTimers();
        try {
          jest.setSystemTime(10_000);
          const mock = makeMockBackend();
          const finishPrompt = holdPrompt(mock);
          const session = makeSession(mock);

          const { turn } = session.sendPrompt("time this");
          const running = aiMessage(session);
          expect(running?.timestamp?.epoch).toBe(10_000);
          expect(running?.turnDurationMs).toBeUndefined();

          jest.advanceTimersByTime(138_000);
          finishPrompt();
          await turn;

          const completed = aiMessage(session);
          expect(completed?.turnDurationMs).toBe(138_000);
        } finally {
          jest.useRealTimers();
        }
      });

      it("forwards image content blocks to the backend prompt", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        await session.sendPrompt("describe", undefined, [
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        ]).turn;
        const messages = session.store.getDisplayMessages();
        expect(messages[0].message).toBe("describe");
        expect(messages[0].content).toEqual([
          { type: "text", text: "describe" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        ]);
        expect(mock.prompt).toHaveBeenCalledWith({
          sessionId: "acp-1",
          promptId: expect.any(String),
          prompt: [
            { type: "text", text: "describe" },
            { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          ],
        });
      });

      it("throws when a turn is already in flight", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        session.sendPrompt("first");
        expect(() => session.sendPrompt("second")).toThrow(/in flight/);
      });

      it("injects the project-context-updates note and acks its epoch after acceptance", async () => {
        const mock = makeMockBackend();
        const markDelivered = jest.fn();
        const session = makeSession(mock, {
          projectId: "proj-1",
          getProjectContextUpdates: () => ({
            epoch: 5,
            block: "<project_context_updates>changed</project_context_updates>",
          }),
          markProjectContextUpdatesDelivered: markDelivered,
        });

        await session.sendPrompt("hi").turn;

        const promptArg = mock.prompt.mock.calls[0][0] as { prompt: Array<{ text?: string }> };
        expect(promptArg.prompt[0].text).toContain(
          "<project_context_updates>changed</project_context_updates>"
        );
        expect(markDelivered).toHaveBeenCalledWith(5);
      });

      it("does not ack when the updates getter returns null", async () => {
        const mock = makeMockBackend();
        const markDelivered = jest.fn();
        const session = makeSession(mock, {
          projectId: "proj-1",
          getProjectContextUpdates: () => null,
          markProjectContextUpdatesDelivered: markDelivered,
        });

        await session.sendPrompt("hi").turn;

        const promptArg = mock.prompt.mock.calls[0][0] as { prompt: Array<{ text?: string }> };
        expect(promptArg.prompt[0].text).not.toContain("<project_context_updates>");
        expect(markDelivered).not.toHaveBeenCalled();
      });

      const PROJECT_CONTEXT =
        "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>";
      const UPDATES = {
        epoch: 7,
        block: "<project_context_updates>changed</project_context_updates>",
      };
      const noteFile = mockTFile({ path: "Notes/Active.md", basename: "Active" });
      const richContext = {
        notes: [noteFile],
        urls: [],
        selectedTextContexts: [
          {
            id: "sel-1",
            sourceType: "web" as const,
            title: "Page",
            url: "https://example.com",
            content: "selected words",
          },
        ],
        webTabs: [{ url: "https://example.com/tab", title: "Tab" }],
      };
      const imageBlock = { type: "image" as const, mimeType: "image/png", data: "aGVsbG8=" };

      const promptBlocks = (mock: MockBackend, call: number) =>
        (mock.prompt.mock.calls[call][0] as { prompt: unknown[] }).prompt;

      async function startProjectSession(
        mock: MockBackend,
        overrides: Partial<AgentSessionStartOptions> = {}
      ): Promise<AgentSession> {
        const session = startSession(mock, {
          cwd: "/vault/Projects/p",
          projectId: "proj-7",
          getProjectContextBlock: () => PROJECT_CONTEXT,
          getProjectContextUpdates: () => UPDATES,
          ...overrides,
        });
        await session.ready;
        return session;
      }

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 sends /compact as the whole prompt even with every context source present`, async () => {
        const processContextWebTabs = jest.fn().mockResolvedValue("<active_web_tab />");
        const getInstance = jest
          .spyOn(ContextProcessor, "getInstance")
          .mockReturnValue({ processContextWebTabs } as never);
        try {
          const mock = makeMockBackend();
          const session = await startProjectSession(mock);

          await session.sendPrompt("/compact", richContext, [imageBlock]).turn;

          expect(promptBlocks(mock, 0)).toEqual([{ type: "text", text: "/compact" }]);
          expect(processContextWebTabs).not.toHaveBeenCalled();
        } finally {
          getInstance.mockRestore();
        }
      });

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 shows the /compact message without the attachments that were not sent`, async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);

        await session.sendPrompt("/compact", richContext, [imageBlock]).turn;

        const [userMessage] = session.store.getDisplayMessages();
        expect(userMessage.message).toBe("/compact");
        expect(userMessage.context).toBeUndefined();
        expect(userMessage.content).toBeUndefined();
      });

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 passes arguments after /compact through unchanged on the trimmed text`, async () => {
        const mock = makeMockBackend();
        const session = await startProjectSession(mock);

        await session.sendPrompt("  /compact keep the API shapes \n", richContext).turn;

        expect(promptBlocks(mock, 0)).toEqual([
          { type: "text", text: "/compact keep the API shapes" },
        ]);
      });

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 leaves project context and project-context updates for the next normal turn`, async () => {
        const mock = makeMockBackend();
        const markDelivered = jest.fn();
        const session = await startProjectSession(mock, {
          markProjectContextUpdatesDelivered: markDelivered,
        });

        await session.sendPrompt("/compact").turn;
        expect(markDelivered).not.toHaveBeenCalled();

        await session.sendPrompt("now continue").turn;
        const nextText = (promptBlocks(mock, 1)[0] as { text: string }).text;
        expect(nextText).toContain("<project_context>");
        expect(nextText).toContain("<project_context_updates>changed</project_context_updates>");
        expect(markDelivered).toHaveBeenCalledWith(7);
      });

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 keeps buffered fan-out context for the next normal turn`, async () => {
        const mock = makeMockBackend();
        const fanoutTurn: FanoutTurn = {
          answers: {
            opencode: { backendId: "opencode", status: "done", text: "a" },
            claude: { backendId: "claude", status: "done", text: "b" },
          },
          summary: { status: "done", text: "the fan-out summary", complete: true },
        };
        const runFanoutTurn = jest.fn(async (input: FanoutRunInput) => {
          input.onChange(fanoutTurn);
          return fanoutTurn;
        });
        const session = makeSession(mock, { runFanoutTurn });
        await session.sendPrompt("compare X and Y", undefined, undefined, ["opencode", "claude"])
          .turn;

        await session.sendPrompt("/compact").turn;
        expect(promptBlocks(mock, 0)).toEqual([{ type: "text", text: "/compact" }]);

        await session.sendPrompt("now expand").turn;
        expect((promptBlocks(mock, 1)[0] as { text: string }).text).toContain(
          "the fan-out summary"
        );
      });

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 compacts only this chat's agent when other agents are @mentioned`, async () => {
        const mock = makeMockBackend();
        const runFanoutTurn = jest.fn();
        const session = makeSession(mock, { runFanoutTurn });
        jest.mocked(ensureMultiAgentEntitlement).mockClear();

        await session.sendPrompt("/compact", undefined, undefined, ["opencode", "claude"]).turn;

        expect(ensureMultiAgentEntitlement).not.toHaveBeenCalled();
        expect(runFanoutTurn).not.toHaveBeenCalled();
        expect(promptBlocks(mock, 0)).toEqual([{ type: "text", text: "/compact" }]);
      });

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 does not title a chat from its /compact message`, async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { getDescriptor: nonSummarizingDescriptor });

        await session.sendPrompt("/compact").turn;
        expect(session.getLabel()).toBeNull();

        await session.sendPrompt("Plan the migration").turn;
        expect(session.getLabel()).toBe("Plan the migration");
      });

      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/634 wraps text that only mentions /compact like any other message`, async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);

        await session.sendPrompt("please /compact", { notes: [noteFile], urls: [] }).turn;

        const text = (promptBlocks(mock, 0)[0] as { text: string }).text;
        expect(text).toContain("<copilot-context>");
        expect(text).toContain("<user-message>\nplease /compact\n</user-message>");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 hands the cause back once in the same reply when the agent stops at its output limit, failing the cut-off tool call first", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        mock.prompt
          .mockImplementationOnce(async () => {
            mock.emitUpdate({
              sessionUpdate: "tool_call",
              toolCallId: "w1",
              title: "write",
              kind: "edit",
              status: "pending",
            });
            return { stopReason: "max_tokens" as const };
          })
          .mockImplementationOnce(async () => {
            mock.emitUpdate(replayText("agent_message_chunk", "Saved the note in blocks."));
            return { stopReason: "end_turn" as const };
          });

        expect(await session.sendPrompt("Write the meeting note").turn).toBe("end_turn");

        expect(mock.prompt).toHaveBeenCalledTimes(2);
        expect(mock.prompt.mock.calls[1][0]).toEqual({
          sessionId: "acp-1",
          promptId: expect.any(String),
          prompt: [{ type: "text", text: OUTPUT_LIMIT_CONTINUATION_PROMPT }],
        });
        expect(bubbles(session).map((b) => b.sender)).toEqual([USER_SENDER, AI_SENDER]);
        expect(aiMessage(session)?.parts).toEqual([
          expect.objectContaining({ kind: "tool_call", id: "w1", status: "failed" }),
          { kind: "text", text: "Saved the note in blocks." },
        ]);
        expect(aiMessage(session)?.turnStopReason).toBe("end_turn");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 shows the cut-off tool call as failed before the continuation runs", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const notifiedToolCalls: unknown[] = [];
        subscribeTo(session, {
          onMessagesChanged: () => notifiedToolCalls.push(aiMessage(session)?.parts?.[0]),
        });
        let toolCallsSeenByContinuation: unknown[] = [];
        mock.prompt
          .mockImplementationOnce(async () => {
            mock.emitUpdate({
              sessionUpdate: "tool_call",
              toolCallId: "w1",
              title: "write",
              kind: "edit",
              status: "pending",
            });
            return { stopReason: "max_tokens" as const };
          })
          .mockImplementationOnce(async () => {
            toolCallsSeenByContinuation = [...notifiedToolCalls];
            return { stopReason: "end_turn" as const };
          });

        await session.sendPrompt("Write the meeting note").turn;

        expect(toolCallsSeenByContinuation).toContainEqual(
          expect.objectContaining({ kind: "tool_call", id: "w1", status: "failed" })
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 continues at most once, leaving the reply at max_tokens when the agent is cut off again", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        mock.prompt.mockResolvedValue({ stopReason: "max_tokens" });

        expect(await session.sendPrompt("Write the meeting note").turn).toBe("max_tokens");

        expect(mock.prompt).toHaveBeenCalledTimes(2);
        expect(aiMessage(session)?.turnStopReason).toBe("max_tokens");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 never continues a turn the user cancelled or the model refused", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("Write the meeting note");
        await session.cancel();
        finishPrompt("max_tokens");
        expect(await turn).toBe("cancelled");

        mock.prompt.mockResolvedValueOnce({ stopReason: "refusal" });
        expect(await session.sendPrompt("Write the meeting note").turn).toBe("refusal");

        expect(mock.prompt).toHaveBeenCalledTimes(2);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 fails a tool call the agent left pending when its turn ends", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        mock.prompt.mockImplementationOnce(async () => {
          mock.emitUpdate({
            sessionUpdate: "tool_call",
            toolCallId: "e1",
            title: "edit",
            status: "pending",
          });
          return { stopReason: "end_turn" as const };
        });

        await session.sendPrompt("Write the meeting note").turn;

        expect(aiMessage(session)?.parts).toEqual([
          expect.objectContaining({ kind: "tool_call", id: "e1", status: "failed" }),
        ]);
      });

      it("marks an empty completed turn as a visible error message", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);

        await session.sendPrompt("hi").turn;

        const placeholder = aiMessage(session);
        expect(placeholder?.isErrorMessage).toBe(true);
        expect(placeholder?.message).toMatch(
          /without returning any assistant text or tool activity/
        );
      });

      it("replaces the compaction row in the in-flight reply as its status advances, keeping when it started", async () => {
        jest.useFakeTimers();
        try {
          jest.setSystemTime(10_000);
          const mock = makeMockBackend();
          const finishPrompt = holdPrompt(mock);
          const session = makeSession(mock);
          const { turn } = session.sendPrompt("/compact");

          mock.emitUpdate({
            sessionUpdate: "compaction",
            id: "c1",
            status: "in_progress",
            trigger: "manual",
          });
          jest.advanceTimersByTime(7_000);
          mock.emitUpdate({
            sessionUpdate: "compaction",
            id: "c1",
            status: "completed",
            trigger: "manual",
            preTokens: 182_000,
            postTokens: 24_000,
          });

          expect(aiMessage(session)?.parts).toEqual([
            {
              kind: "compaction",
              id: "c1",
              status: "completed",
              trigger: "manual",
              preTokens: 182_000,
              postTokens: 24_000,
              startedAtMs: 10_000,
            },
          ]);

          finishPrompt();
          await turn;
        } finally {
          jest.useRealTimers();
        }
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 finishes a turn whose only activity is a compaction without the empty-turn error", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("/compact");
        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "c1",
          status: "completed",
          trigger: "manual",
        });

        finishPrompt();
        await turn;

        const reply = aiMessage(session);
        expect(reply?.isErrorMessage).toBeFalsy();
        expect(reply?.message).toBe("");
        expect(reply?.turnStopReason).toBe("end_turn");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 settles a compaction still in progress when the turn ends to cancelled", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("keep going");
        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "auto-1",
          status: "in_progress",
          trigger: "auto",
        });
        mock.emitUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done." },
        });

        finishPrompt();
        await turn;

        expect(aiMessage(session)?.parts).toEqual([
          expect.objectContaining({ kind: "compaction", id: "auto-1", status: "cancelled" }),
          { kind: "text", text: "Done." },
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 settles a compaction still in progress to failed and reports the prompt's error once, on the turn, when the prompt rejects", async () => {
        const mock = makeMockBackend();
        let rejectPrompt: (error: Error) => void = () => {};
        mock.prompt.mockImplementation(
          () =>
            new Promise((_resolve, reject) => {
              rejectPrompt = reject;
            })
        );
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("/compact");
        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "c1",
          status: "in_progress",
          trigger: "manual",
        });

        rejectPrompt(new Error("stream error"));
        await expect(turn).rejects.toThrow("stream error");

        const message = aiMessage(session);
        expect(message?.parts?.[0]).toMatchObject({
          kind: "compaction",
          status: "failed",
          error: undefined,
        });
        expect(message?.message).toContain("stream error");
      });

      it("shows the nested provider error on the placeholder when the prompt rejects", async () => {
        const mock = makeMockBackend();
        const error = new Error("stream error");
        (error as { cause?: unknown }).cause = {
          data: {
            error: {
              type: "FreeUsageLimitError",
              message: "Rate limit exceeded. Please try again later.",
            },
          },
        };
        mock.prompt.mockRejectedValueOnce(error);
        const session = makeSession(mock);

        await expect(session.sendPrompt("hi").turn).rejects.toThrow("stream error");

        const placeholder = aiMessage(session);
        expect(placeholder?.isErrorMessage).toBe(true);
        expect(placeholder?.message).toContain("FreeUsageLimitError");
        expect(placeholder?.message).toContain("Rate limit exceeded");
        expect(placeholder?.turnDurationMs).toEqual(expect.any(Number));
      });

      it("surfaces a provider error stringified inside data.message (codex-acp)", async () => {
        const mock = makeMockBackend();
        const error = new Error("Internal error");
        (error as { data?: unknown }).data = {
          message: JSON.stringify({
            type: "error",
            status: 400,
            error: {
              type: "invalid_request_error",
              message:
                "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
            },
          }),
          codex_error_info: "other",
        };
        mock.prompt.mockRejectedValueOnce(error);
        const session = makeSession(mock, { backendId: "codex" });

        await expect(session.sendPrompt("hi").turn).rejects.toThrow("Internal error");

        const placeholder = aiMessage(session);
        expect(placeholder?.isErrorMessage).toBe(true);
        expect(placeholder?.message).toContain("invalid_request_error");
        expect(placeholder?.message).toContain("requires a newer version of Codex");
      });

      it("renders a visible error (not an empty bubble) when the backend refuses the prompt because auth is required", async () => {
        const mock = makeMockBackend();
        mock.asBackend.prompt = () =>
          Promise.reject(new AuthRequiredError("You're not signed in to Claude."));
        const session = makeSession(mock, { backendId: "claude" });

        await expect(session.sendPrompt("hi").turn).rejects.toBeInstanceOf(AuthRequiredError);

        const placeholder = aiMessage(session);
        expect(placeholder?.isErrorMessage).toBe(true);
        expect(placeholder?.message).toContain("not signed in to Claude");
        expect(session.getStatus()).toBe("error");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 hands a message sent while the agent works to a backend that takes mid-turn input at once, and lists it as queued instead of showing it", async () => {
        const mock = makeMockBackend();
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("list the notes");

        const steer = session.sendPrompt("only do the first two");

        await waitFor(() => expect(sent).toHaveLength(2));
        expect(promptText(sent[1])).toContain("only do the first two");
        expect(sent[1].promptId).toBe(steer.userMessageId);
        expect(session.getQueuedPrompts()).toEqual([
          expect.objectContaining({ id: steer.userMessageId, text: "only do the first two" }),
        ]);
        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "list the notes" },
          { sender: AI_SENDER, message: "" },
        ]);
        expect(session.getStatus()).toBe("running");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 refuses a message sent while the agent works on a backend without mid-turn input, so Copilot keeps holding it", async () => {
        const mock = makeMockBackend();
        const sent = recordPrompts(mock);
        const session = makeSession(mock);
        session.sendPrompt("list the notes");

        expect(() => session.sendPrompt("only do the first two")).toThrow(
          "Session already has a turn in flight"
        );
        await waitFor(() => expect(sent).toHaveLength(1));
        expect(session.getQueuedPrompts()).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 refuses /compact and multi-agent questions while the agent works, even on a backend that takes mid-turn input", () => {
        const mock = makeMockBackend();
        recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("list the notes");

        expect(() => session.sendPrompt("/compact")).toThrow(
          "Session already has a turn in flight"
        );
        expect(() =>
          session.sendPrompt("compare", undefined, undefined, ["claude", "codex"])
        ).toThrow("Session already has a turn in flight");
        expect(session.getQueuedPrompts()).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 shows a queued message at the point it reached the agent, keeps the work before it in its own reply, and renders later work below it in the same turn", async () => {
        const mock = makeMockBackend();
        const emit = (update: SessionEvent["update"]) => mock.emitUpdate(update);
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        const first = session.sendPrompt("list the notes");
        await waitFor(() => expect(sent).toHaveLength(1));
        emit({ sessionUpdate: "message_delivered", promptId: sent[0].promptId });
        emit({ sessionUpdate: "turn_started", turnId: "t1" });
        emit(replayText("agent_message_chunk", "Alpha: about A."));
        const steer = session.sendPrompt("only do the first two");
        await waitFor(() => expect(sent).toHaveLength(2));

        emit({ sessionUpdate: "message_delivered", promptId: steer.userMessageId });
        emit(replayText("agent_message_chunk", "Beta: about B. Stopping there."));

        expect(session.getQueuedPrompts()).toEqual([]);
        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "list the notes" },
          { sender: AI_SENDER, message: "Alpha: about A." },
          { sender: USER_SENDER, message: "only do the first two" },
          { sender: AI_SENDER, message: "Beta: about B. Stopping there." },
        ]);
        expect(aiMessages(session)[0].turnStopReason).toBe("end_turn");
        expect(session.getStatus()).toBe("running");
        emit({ sessionUpdate: "turn_ended", turnId: "t1", stopReason: "end_turn" });
        await expect(first.turn).resolves.toBe("end_turn");
        await expect(steer.turn).resolves.toBe("end_turn");
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 leaves no empty reply above a queued message the agent takes before saying anything", async () => {
        const mock = makeMockBackend();
        const emit = (update: SessionEvent["update"]) => mock.emitUpdate(update);
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("first");
        const steer = session.sendPrompt("second");
        await waitFor(() => expect(sent).toHaveLength(2));

        emit({ sessionUpdate: "message_delivered", promptId: sent[0].promptId });
        emit({ sessionUpdate: "turn_started", turnId: "t1" });
        emit({ sessionUpdate: "message_delivered", promptId: steer.userMessageId });
        emit(replayText("agent_message_chunk", "Both answered."));

        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "first" },
          { sender: USER_SENDER, message: "second" },
          { sender: AI_SENDER, message: "Both answered." },
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 shows a queued message that runs after the turn as its own exchange", async () => {
        const mock = makeMockBackend();
        const emit = (update: SessionEvent["update"]) => mock.emitUpdate(update);
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("first");
        await waitFor(() => expect(sent).toHaveLength(1));
        emit({ sessionUpdate: "message_delivered", promptId: sent[0].promptId });
        emit({ sessionUpdate: "turn_started", turnId: "t1" });
        emit(replayText("agent_message_chunk", "First answer."));
        const steer = session.sendPrompt("now this", undefined, undefined, undefined, {
          interrupt: true,
        });
        await waitFor(() => expect(sent).toHaveLength(2));
        emit({ sessionUpdate: "turn_ended", turnId: "t1", stopReason: "end_turn" });
        await waitFor(() => expect(session.getStatus()).toBe("idle"));
        expect(session.getQueuedPrompts()).toHaveLength(1);

        emit({ sessionUpdate: "message_delivered", promptId: steer.userMessageId });
        emit({ sessionUpdate: "turn_started", turnId: "t2" });
        emit(replayText("agent_message_chunk", "Second answer."));
        emit({ sessionUpdate: "turn_ended", turnId: "t2", stopReason: "end_turn" });

        await expect(steer.turn).resolves.toBe("end_turn");
        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "first" },
          { sender: AI_SENDER, message: "First answer." },
          { sender: USER_SENDER, message: "now this" },
          { sender: AI_SENDER, message: "Second answer." },
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 asks the backend to interrupt the running turn for an interrupt-and-send message", async () => {
        const mock = makeMockBackend();
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("first");
        session.sendPrompt("plain steer");
        session.sendPrompt("urgent", undefined, undefined, undefined, { interrupt: true });

        await waitFor(() => expect(sent).toHaveLength(3));
        expect(sent.map((input) => input.interrupt)).toEqual([undefined, undefined, true]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 hands messages to the backend in the order they were sent, even while an earlier one is still being handed over", async () => {
        const mock = makeMockBackend();
        const order: string[] = [];
        let acceptFirst!: () => void;
        mock.asBackend.prompt = (input) => {
          order.push(promptText(input));
          if (order.length > 1) return Promise.resolve();
          return new Promise<void>((resolve) => (acceptFirst = resolve));
        };
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("first");
        session.sendPrompt("second");
        session.sendPrompt("third");
        await waitFor(() => expect(order).toHaveLength(1));
        expect(order[0]).toContain("first");

        acceptFirst();

        await waitFor(() => expect(order).toHaveLength(3));
        expect(order[1]).toContain("second");
        expect(order[2]).toContain("third");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 drops a queued message from the list and fails its send when the backend refuses it", async () => {
        const mock = makeMockBackend();
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("first");
        await waitFor(() => expect(sent).toHaveLength(1));
        mock.asBackend.prompt = () => Promise.reject(new Error("pipe closed"));

        const steer = session.sendPrompt("second");

        await expect(steer.turn).rejects.toThrow("pipe closed");
        expect(session.getQueuedPrompts()).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 clears queued messages the agent withdraws, such as when it exits", async () => {
        const mock = makeMockBackend();
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        session.sendPrompt("first");
        const steer = session.sendPrompt("second");
        await waitFor(() => expect(sent).toHaveLength(2));

        mock.emitUpdate({ sessionUpdate: "messages_withdrawn", promptIds: [steer.userMessageId] });

        await expect(steer.turn).resolves.toBe("cancelled");
        expect(session.getQueuedPrompts()).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 shows the reply at send, fills it once the turn starts, and stays running from send to the turn's end", async () => {
        const mock = makeMockBackend();
        const emit = (update: SessionEvent["update"]) => mock.emitUpdate(update);
        let promptId = "";
        mock.asBackend.prompt = async (input) => {
          promptId = input.promptId;
        };
        const session = makeSession(mock);

        const { turn } = session.sendPrompt("hi");
        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "hi" },
          { sender: AI_SENDER, message: "" },
        ]);
        expect(session.getStatus()).toBe("running");

        emit({ sessionUpdate: "message_delivered", promptId });
        emit({ sessionUpdate: "turn_started", turnId: "t1" });
        emit(replayText("agent_message_chunk", "hello"));
        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "hi" },
          { sender: AI_SENDER, message: "hello" },
        ]);
        emit({ sessionUpdate: "turn_ended", turnId: "t1", stopReason: "end_turn" });

        expect(await turn).toBe("end_turn");
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 leaves a prompt waiting through a turn that ended before the prompt was delivered", async () => {
        const mock = makeMockBackend();
        const emit = (update: SessionEvent["update"]) => mock.emitUpdate(update);
        let promptId = "";
        mock.asBackend.prompt = async (input) => {
          promptId = input.promptId;
        };
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("follow-up");

        emit({ sessionUpdate: "turn_started", turnId: "earlier" });
        emit(replayText("agent_message_chunk", "earlier work"));
        emit({ sessionUpdate: "turn_ended", turnId: "earlier", stopReason: "refusal" });
        emit({ sessionUpdate: "message_delivered", promptId });
        emit({ sessionUpdate: "turn_started", turnId: "answer" });
        emit(replayText("agent_message_chunk", "the answer"));
        emit({ sessionUpdate: "turn_ended", turnId: "answer", stopReason: "end_turn" });

        expect(await turn).toBe("end_turn");
        expect(aiMessages(session).map((m) => m.message)).toEqual(["earlier work", "the answer"]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 gives a turn the agent starts before a sent prompt arrives its own reply, and answers the prompt in a reply below it", async () => {
        const mock = makeMockBackend();
        const emit = (update: SessionEvent["update"]) => mock.emitUpdate(update);
        let promptId = "";
        mock.asBackend.prompt = async (input) => {
          promptId = input.promptId;
        };
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("unrelated question");

        emit({ sessionUpdate: "turn_started", turnId: "notification" });
        emit(replayText("agent_message_chunk", "The subagent finished."));
        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "unrelated question" },
          { sender: AI_SENDER, message: "The subagent finished." },
        ]);
        emit({ sessionUpdate: "turn_ended", turnId: "notification", stopReason: "end_turn" });
        emit({ sessionUpdate: "message_delivered", promptId });
        emit({ sessionUpdate: "turn_started", turnId: "answer" });
        emit(replayText("agent_message_chunk", "Here is the answer."));
        emit({ sessionUpdate: "turn_ended", turnId: "answer", stopReason: "end_turn" });

        expect(await turn).toBe("end_turn");
        expect(bubbles(session)).toEqual([
          { sender: USER_SENDER, message: "unrelated question" },
          { sender: AI_SENDER, message: "The subagent finished." },
          { sender: AI_SENDER, message: "Here is the answer." },
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 settles a prompt the agent withdrew as cancelled", async () => {
        const mock = makeMockBackend();
        let promptId = "";
        mock.asBackend.prompt = async (input) => {
          promptId = input.promptId;
        };
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("hi");
        await waitFor(() => expect(promptId).not.toBe(""));

        mock.emitUpdate({ sessionUpdate: "messages_withdrawn", promptIds: [promptId] });

        expect(await turn).toBe("cancelled");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 shows a disconnect in the waiting reply, settles the prompt, and sends the next prompt normally", async () => {
        const mock = makeMockBackend();
        let promptId = "";
        const realPrompt = mock.asBackend.prompt;
        mock.asBackend.prompt = async (input) => {
          promptId = input.promptId;
        };
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("hi");
        await waitFor(() => expect(promptId).not.toBe(""));

        mock.emitUpdate({ sessionUpdate: "messages_withdrawn", promptIds: [promptId] });
        mock.emitUpdate({
          sessionUpdate: "session_disconnected",
          error: new Error("Claude Code stopped unexpectedly."),
        });
        expect(await turn).toBe("cancelled");
        expect(aiMessage(session)).toMatchObject({
          isErrorMessage: true,
          message: expect.stringContaining("Claude Code stopped unexpectedly."),
        });
        expect(session.getStatus()).toBe("error");

        mock.asBackend.prompt = realPrompt;
        expect(await session.sendPrompt("again").turn).toBe("end_turn");
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 ignores the end of a turn that is not running", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("hi");
        mock.emitUpdate(replayText("agent_message_chunk", "still working"));

        mock.emitUpdate({ sessionUpdate: "turn_ended", turnId: "unknown", stopReason: "end_turn" });

        expect(session.getStatus()).toBe("running");
        expect(aiMessage(session)?.turnStopReason).toBeUndefined();
        finishPrompt();
        expect(await turn).toBe("end_turn");
      });

      it("appends streamed message chunks to the assistant placeholder", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("hi");

        mock.emitUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        });
        mock.emitUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: ", world." },
        });

        const placeholder = aiMessage(session);
        expect(placeholder?.message).toBe("Hello, world.");

        finishPrompt();
        await turn;
      });

      it("appends a content chunk that trails past the prompt result (messageId race)", async () => {
        jest.useFakeTimers();
        try {
          jest.setSystemTime(10_000);
          const mock = makeMockBackend();
          const finishPrompt = holdPrompt(mock);
          const session = makeSession(mock);
          const { turn } = session.sendPrompt("hi");

          mock.emitUpdate({
            sessionUpdate: "agent_message_chunk",
            messageId: "msg-1",
            content: { type: "text", text: "Hello" },
          });
          jest.setSystemTime(20_000);
          finishPrompt();
          await turn;
          expect(aiMessage(session)?.turnDurationMs).toBe(10_000);

          jest.setSystemTime(25_000);
          mock.emitUpdate({
            sessionUpdate: "agent_message_chunk",
            messageId: "msg-1",
            content: { type: "text", text: ", world." },
          });

          const placeholder = aiMessage(session);
          expect(placeholder?.message).toBe("Hello, world.");
          expect(placeholder?.turnDurationMs).toBe(15_000);
        } finally {
          jest.useRealTimers();
        }
      });

      it("routes a trailing chunk to its own message, not a newer turn", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);

        const { turn: turnA } = session.sendPrompt("first");
        mock.emitUpdate({
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-a",
          content: { type: "text", text: "A-before" },
        });
        finishPrompt();
        await turnA;

        const { turn: turnB } = session.sendPrompt("second");
        mock.emitUpdate({
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-b",
          content: { type: "text", text: "B-text" },
        });
        mock.emitUpdate({
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-a",
          content: { type: "text", text: "A-after" },
        });

        const ai = aiMessages(session);
        expect(ai[0]?.message).toBe("A-beforeA-after");
        expect(ai[1]?.message).toBe("B-text");

        finishPrompt();
        await turnB;
      });

      it("merges a tool_call and its later tool_call_update into one tool part", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("hi");

        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc1",
          title: "Read README",
          kind: "read",
          status: "pending",
          rawInput: { path: "README.md" },
        });
        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "file contents" } }],
        });

        const placeholder = aiMessage(session);
        expect(placeholder?.parts).toHaveLength(1);
        expect(placeholder?.parts?.[0]).toMatchObject({
          kind: "tool_call",
          id: "tc1",
          title: "Read README",
          status: "completed",
          output: [{ type: "text", text: "file contents" }],
        });

        finishPrompt();
        await turn;
      });

      it("routes a tool_call_update for a prior turn's tool call to its original message", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude-code" });

        const first = session.sendPrompt("launch a background agent");
        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc-agent",
          title: "Agent",
          status: "in_progress",
        });
        finishPrompt();
        await first.turn;

        const second = session.sendPrompt("meanwhile");
        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-agent",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "agent report" } }],
        });

        const ai = aiMessages(session);
        expect(ai[0]?.parts?.[0]).toMatchObject({
          kind: "tool_call",
          id: "tc-agent",
          status: "completed",
          output: [{ type: "text", text: "agent report" }],
        });
        expect(ai[1]?.parts ?? []).toHaveLength(0);

        finishPrompt();
        await second.turn;

        const laterTurn = aiMessages(session)[1];
        expect(laterTurn).toMatchObject({ message: "", turnStopReason: "end_turn" });
        expect(laterTurn?.isErrorMessage).not.toBe(true);
      });

      it("merges partial progress updates into the tool part's progress", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude-code" });
        const { turn } = session.sendPrompt("hi");

        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc1",
          title: "Agent",
          status: "in_progress",
          progress: { description: "Inspect vault", toolUses: 1 },
        });
        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc1",
          progress: { toolUses: 3, durationMs: 9851 },
        });

        const part = aiMessage(session)?.parts?.[0];
        expect(part).toMatchObject({
          kind: "tool_call",
          progress: { description: "Inspect vault", toolUses: 3, durationMs: 9851 },
        });

        finishPrompt();
        await turn;
      });

      const storedToolOutput = async (text: string): Promise<AgentToolCallOutput | undefined> => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "codex" });
        const { turn } = session.sendPrompt("hi");
        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text } }],
        });
        const part = aiMessage(session)?.parts?.[0];
        finishPrompt();
        await turn;
        if (part?.kind !== "tool_call") throw new Error("expected tool_call part");
        return part.output?.[0];
      };

      it("stores a large (but under-cap) text tool output in full", async () => {
        const text = "x".repeat(100_000);
        expect(await storedToolOutput(text)).toEqual({ type: "text", text });
      });

      it("trims a runaway tool output above the backstop, noting the agent got it all", async () => {
        const output = await storedToolOutput("y".repeat(300_000));
        if (output?.type !== "text") throw new Error("expected text output");
        expect(output.text.length).toBeLessThan(300_000);
        expect(output.text).toContain("Display trimmed");
        expect(output.text).toContain("The agent received the full output");
      });

      it("builds the <project_context> block when the first prompt is sent and injects it into that prompt only", async () => {
        const mock = makeMockBackend();
        const getProjectContextBlock = jest.fn(
          () => "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>"
        );
        const session = startSession(mock, {
          cwd: "/vault/Projects/p",
          projectId: "proj-7",
          getProjectContextBlock,
        });
        await session.ready;
        expect(getProjectContextBlock).not.toHaveBeenCalled();

        await session.sendPrompt("first").turn;
        await session.sendPrompt("second").turn;

        const promptText = (call: number): string => {
          const input = mock.prompt.mock.calls[call][0] as {
            prompt: Array<{ type: string; text?: string }>;
          };
          return input.prompt.map((b) => b.text ?? "").join("\n");
        };
        expect(promptText(0)).toContain("<project_context>");
        expect(promptText(0)).toContain("`/vault/Papers`");
        expect(promptText(0)).toContain("<user-message>\nfirst\n</user-message>");
        expect(promptText(1)).not.toContain("<project_context>");
        expect(getProjectContextBlock).toHaveBeenCalledTimes(1);
      });

      it("re-injects the <project_context> block on retry when the first prompt fails", async () => {
        const mock = makeMockBackend();
        mock.prompt.mockRejectedValueOnce(new Error("transport down"));
        const session = startSession(mock, {
          cwd: "/vault/Projects/p",
          projectId: "proj-7",
          getProjectContextBlock: () =>
            "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>",
        });
        await session.ready;

        await expect(session.sendPrompt("first").turn).rejects.toThrow("transport down");
        await session.sendPrompt("retry").turn;

        const promptText = (call: number): string => {
          const input = mock.prompt.mock.calls[call][0] as {
            prompt: Array<{ type: string; text?: string }>;
          };
          return input.prompt.map((b) => b.text ?? "").join("\n");
        };
        expect(promptText(0)).toContain("<project_context>");
        expect(promptText(1)).toContain("<project_context>");
      });

      describe("with the same web page on several turns", () => {
        const PAGE = {
          url: "https://www.youtube.com/watch?v=arj7oStGLkU",
          title: "Procrastination talk",
          isActive: true,
        };
        const fullBlock = (content: string): string =>
          `<youtube_video_context>\n<title>${PAGE.title}</title>\n<url>${PAGE.url}</url>\n<content>\n${content}\n</content>\n</youtube_video_context>`;
        const pageContext = () => ({ notes: [], urls: [], webTabs: [PAGE] });
        const promptText = (mock: MockBackend, call: number): string =>
          (mock.prompt.mock.calls[call][0] as { prompt: Array<{ text?: string }> }).prompt
            .map((b) => b.text ?? "")
            .join("\n");
        const stubWebTabs = (...blocks: string[]) => {
          const processContextWebTabs = jest.fn();
          for (const block of blocks) processContextWebTabs.mockResolvedValueOnce(block);
          return jest
            .spyOn(ContextProcessor, "getInstance")
            .mockReturnValue({ processContextWebTabs } as never);
        };

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/667 sends an unchanged page in full once, leaves it out while unchanged, and sends it in full again once it changes", async () => {
          const getInstance = stubWebTabs(
            fullBlock("TRANSCRIPT A"),
            fullBlock("TRANSCRIPT A"),
            fullBlock("TRANSCRIPT B")
          );
          try {
            const mock = makeMockBackend();
            const session = makeSession(mock);

            await session.sendPrompt("first", pageContext()).turn;
            await session.sendPrompt("second", pageContext()).turn;
            await session.sendPrompt("third", pageContext()).turn;

            expect(promptText(mock, 0)).toContain("TRANSCRIPT A");
            expect(promptText(mock, 1)).not.toContain(PAGE.url);
            expect(promptText(mock, 1)).toContain("second");
            expect(promptText(mock, 2)).toContain("TRANSCRIPT B");
          } finally {
            getInstance.mockRestore();
          }
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/667 resends the page in full after the prompt that carried it failed", async () => {
          const getInstance = stubWebTabs(fullBlock("TRANSCRIPT A"), fullBlock("TRANSCRIPT A"));
          try {
            const mock = makeMockBackend();
            mock.prompt.mockRejectedValueOnce(new Error("transport down"));
            const session = makeSession(mock);

            await expect(session.sendPrompt("first", pageContext()).turn).rejects.toThrow(
              "transport down"
            );
            await session.sendPrompt("retry", pageContext()).turn;

            expect(promptText(mock, 1)).toContain("TRANSCRIPT A");
          } finally {
            getInstance.mockRestore();
          }
        });
      });

      describe("with several mentioned agents", () => {
        const mockedEnsure = ensureMultiAgentEntitlement as jest.MockedFunction<
          typeof ensureMultiAgentEntitlement
        >;
        const mockedUpgradePrompt = showMultiAgentUpgradePrompt as jest.MockedFunction<
          typeof showMultiAgentUpgradePrompt
        >;
        const BOTH_AGENTS = ["opencode", "claude"];

        const fanoutRunner = (turn: FanoutTurn) =>
          jest.fn(async (input: FanoutRunInput): Promise<FanoutTurn> => {
            input.onChange(turn);
            return turn;
          });

        const twoAgentTurn = (
          answers: [string, string] = ["a", "b"],
          summary: FanoutTurn["summary"] = { status: "done", text: "summary" }
        ): FanoutTurn => ({
          answers: {
            opencode: { backendId: "opencode", status: "done", text: answers[0] },
            claude: { backendId: "claude", status: "done", text: answers[1] },
          },
          summary,
        });

        const fanoutPromptText = (runFanoutTurn: jest.Mock): string =>
          (runFanoutTurn.mock.calls[0][0].prompt[0] as { type: "text"; text: string }).text;

        const lastPromptText = (mock: MockBackend): string => {
          const calls = mock.prompt.mock.calls;
          return (calls[calls.length - 1][0] as { prompt: Array<{ text: string }> }).prompt[0].text;
        };

        beforeEach(() => {
          mockedEnsure.mockReset();
          mockedEnsure.mockResolvedValue(true);
          mockedUpgradePrompt.mockReset();
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/667 gives mentioned agents the full page even after the main agent received it", async () => {
          const page = { url: "https://example.com/report", title: "Report", isActive: true };
          const block = "<active_web_tab>\n<content>\nREPORT BODY\n</content>\n</active_web_tab>";
          const processContextWebTabs = jest.fn().mockResolvedValue(block);
          const getInstance = jest
            .spyOn(ContextProcessor, "getInstance")
            .mockReturnValue({ processContextWebTabs } as never);
          try {
            const mock = makeMockBackend();
            const runFanoutTurn = fanoutRunner(twoAgentTurn());
            const session = makeSession(mock, { runFanoutTurn });
            const context = { notes: [], urls: [], webTabs: [page] };

            await session.sendPrompt("summarize", context).turn;
            await session.sendPrompt("review", context, undefined, BOTH_AGENTS).turn;

            expect(fanoutPromptText(runFanoutTurn)).toContain("REPORT BODY");
          } finally {
            getInstance.mockRestore();
          }
        });

        it("hands the turn to the fan-out runner instead of backend.prompt for an entitled user", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner(
            twoAgentTurn(["opencode answer", "claude answer"], { status: "pending", text: "" })
          );
          const session = makeSession(mock, { runFanoutTurn });

          const stopReason = await session.sendPrompt("review", undefined, undefined, BOTH_AGENTS)
            .turn;

          expect(stopReason).toBe("end_turn");
          expect(mockedEnsure).toHaveBeenCalledTimes(1);
          expect(mockedUpgradePrompt).not.toHaveBeenCalled();
          expect(runFanoutTurn).toHaveBeenCalledTimes(1);
          expect(mock.prompt).not.toHaveBeenCalled();
          expect(runFanoutTurn.mock.calls[0][0].agents).toEqual(BOTH_AGENTS);
          expect(runFanoutTurn.mock.calls[0][0].mainAgent).toBe("opencode");
          expect(fanoutPromptText(runFanoutTurn)).toContain("read-only");
          expect(fanoutPromptText(runFanoutTurn)).toContain("review");
          expect(aiMessage(session)?.fanout?.answers.claude.text).toBe("claude answer");
        });

        it("persists the full composite (summary + per-agent answers + markers) and keeps the live turn on the message", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner(
            twoAgentTurn(["OPENCODE_ANSWER", "CLAUDE_ANSWER"], {
              status: "done",
              text: "the narrative summary",
            })
          );
          const session = makeSession(mock, { runFanoutTurn });

          await session.sendPrompt("review", undefined, undefined, BOTH_AGENTS).turn;

          const placeholder = aiMessage(session);
          expect(placeholder?.message).toContain("<!--copilot:multi-agent v=1-->");
          expect(placeholder?.message).toContain("the narrative summary");
          expect(placeholder?.message).toContain("OPENCODE_ANSWER");
          expect(placeholder?.message).toContain("CLAUDE_ANSWER");
          expect(placeholder?.fanout?.summary.text).toBe("the narrative summary");
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/481 persists an empty failed single-agent response so it survives reload", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner({
            answers: {
              claude: { backendId: "claude", status: "error", text: "", error: "backend boom" },
            },
            summary: { status: "done", text: "" },
          });
          const session = makeSession(mock, { runFanoutTurn });

          await session.sendPrompt("review", undefined, undefined, ["claude"]).turn;

          const response = aiMessage(session);
          expect(response?.message).toContain('id="claude"');
          expect(response?.message).toContain('status="error"');
          expect(response?.message).toContain('error="backend boom"');
          expect(mock.prompt).not.toHaveBeenCalled();
        });

        it("refuses the turn with an upgrade prompt and an error message when the user is not entitled", async () => {
          mockedEnsure.mockResolvedValue(false);
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner(twoAgentTurn());
          const session = makeSession(mock, { runFanoutTurn });

          const stopReason = await session.sendPrompt("review", undefined, undefined, BOTH_AGENTS)
            .turn;

          expect(stopReason).toBe("refusal");
          expect(runFanoutTurn).not.toHaveBeenCalled();
          expect(mock.prompt).not.toHaveBeenCalled();
          expect(mockedUpgradePrompt).toHaveBeenCalledTimes(1);
          expect(session.getStatus()).toBe("idle");
          const placeholder = aiMessage(session);
          expect(placeholder?.isErrorMessage).toBe(true);
          expect(placeholder?.message).toContain("Copilot Plus");
          expect(placeholder?.fanout).toBeUndefined();
        });

        it("skips the entitlement gate when no other agent is mentioned", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = jest.fn();
          const session = makeSession(mock, { runFanoutTurn });

          await session.sendPrompt("hi").turn;
          await session.sendPrompt("hi again", undefined, undefined, ["opencode"]).turn;

          expect(mockedEnsure).not.toHaveBeenCalled();
          expect(runFanoutTurn).not.toHaveBeenCalled();
          expect(mock.prompt).toHaveBeenCalledTimes(2);
        });

        it("does not let a first-turn fan-out consume the visible session's project context", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner(twoAgentTurn());
          const session = makeSession(mock, { runFanoutTurn });
          (
            session as unknown as { getProjectContextBlockFn: () => string }
          ).getProjectContextBlockFn = () =>
            "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>";

          await session.sendPrompt("review", undefined, undefined, BOTH_AGENTS).turn;
          expect(fanoutPromptText(runFanoutTurn)).toContain("<project_context>");
          expect(mock.prompt).not.toHaveBeenCalled();

          await session.sendPrompt("now you").turn;
          expect(mock.prompt).toHaveBeenCalledTimes(1);
          expect(lastPromptText(mock)).toContain("<project_context>");
        });

        it("includes the prior transcript as a conversation_history block on a fan-out follow-up", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner(twoAgentTurn());
          const session = makeSession(mock, { runFanoutTurn });

          await session.sendPrompt("what is the master plan").turn;
          session.store.appendAgentText(aiMessage(session).id, "the master plan is X");

          await session.sendPrompt("expand on that plan", undefined, undefined, BOTH_AGENTS).turn;

          const text = fanoutPromptText(runFanoutTurn);
          expect(text).toContain("<conversation_history>");
          expect(text).toContain("what is the master plan");
          expect(text).toContain("the master plan is X");
          expect(text).toContain("<user-message>\nexpand on that plan\n</user-message>");
          expect((text.match(/expand on that plan/g) ?? []).length).toBe(1);
        });

        it("injects the buffered question + summary on the next single-agent turn, then clears", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner(
            twoAgentTurn(["a", "b"], {
              status: "done",
              text: "the fan-out summary",
              complete: true,
            })
          );
          const session = makeSession(mock, { runFanoutTurn });

          await session.sendPrompt("compare X and Y", undefined, undefined, BOTH_AGENTS).turn;
          expect(mock.prompt).not.toHaveBeenCalled();

          await session.sendPrompt("now expand on that").turn;

          const text = lastPromptText(mock);
          expect(text).toContain("<prior_turns>");
          expect(text).toContain("compare X and Y");
          expect(text).toContain("the fan-out summary");
          expect(text).toContain("<user-message>\nnow expand on that\n</user-message>");

          await session.sendPrompt("and again").turn;
          expect(lastPromptText(mock)).not.toContain("<prior_turns>");
        });

        it("replays the agents' answers on the next single-agent turn when no summary was generated", async () => {
          const mock = makeMockBackend();
          const runFanoutTurn = fanoutRunner(
            twoAgentTurn(["answer a", "answer b"], { status: "done", text: "" })
          );
          const session = makeSession(mock, { runFanoutTurn });

          await session.sendPrompt("multi question", undefined, undefined, BOTH_AGENTS).turn;
          await session.sendPrompt("follow-up").turn;

          const text = lastPromptText(mock);
          expect(text).toContain("<prior_turns>");
          expect(text).toContain("multi question");
          expect(text).toContain("answer a");
          expect(text).toContain("answer b");
          expect(text).not.toContain("a combined summary could not be generated");
        });
      });

      describe("turn file changes", () => {
        function makeVault(initial: Record<string, string>) {
          const files = new Map(Object.entries(initial));
          const adapter = new FileSystemAdapter();
          adapter.read = jest.fn((p: string) => {
            const content = files.get(p);
            return content === undefined
              ? Promise.reject(new Error(`ENOENT: ${p}`))
              : Promise.resolve(content);
          });
          const app = { vault: { adapter } } as unknown as App;
          return { files, adapter, app };
        }

        function makeSession(mock: ReturnType<typeof makeMockBackend>, app: App) {
          const session = new AgentSession({
            backend: mock.asBackend,
            backendSessionId: "acp-1",
            internalId: "internal-1",
            backendId: "claude",
            getApp: () => app,
          });
          session.completeResume(null);
          return session;
        }

        const toolCall = (
          toolCallId: string,
          kind: "edit" | "delete" | "read",
          locations: string[]
        ) => ({
          sessionId: "acp-1",
          update: {
            sessionUpdate: "tool_call" as const,
            toolCallId,
            title: kind,
            kind,
            status: "in_progress" as const,
            locations: locations.map((path) => ({ path })),
          },
        });

        const editCall = (toolCallId: string, filePath: string) =>
          toolCall(toolCallId, "edit", [filePath]);

        const toolResult = (toolCallId: string, originalFiles: Record<string, string | null>) => ({
          sessionId: "acp-1",
          update: {
            sessionUpdate: "tool_call_update" as const,
            toolCallId,
            status: "completed" as const,
            originalFiles,
          },
        });

        function fileChangesOf(session: AgentSession) {
          const messages = session.store.getDisplayMessages().filter((m) => m.sender === AI_SENDER);
          return messages[messages.length - 1]?.fileChanges;
        }

        beforeEach(() => {
          __resetVaultBaseCache();
        });

        afterEach(() => {
          __resetVaultBaseCache();
        });

        it("reports one change per file, from the file the turn first saw to the file at turn end", async () => {
          const vault = makeVault({ "notes/a.md": "one\ntwo\n" });
          const mock = makeMockBackend();
          mock.prompt.mockImplementation(async () => {
            mock.emit(editCall("t1", "/vault/notes/a.md"));
            mock.emit(editCall("t2", "/vault/notes/a.md"));
            mock.emit(editCall("t3", "/vault/notes/a.md"));
            vault.files.set("notes/a.md", "ONE\ntwo\nthree\n");
            return { stopReason: "end_turn" as const };
          });
          const session = makeSession(mock, vault.app);

          await session.sendPrompt("edit it three times").turn;

          expect(fileChangesOf(session)).toEqual([
            {
              path: "notes/a.md",
              status: "modified",
              before: "one\ntwo\n",
              after: "ONE\ntwo\nthree\n",
              additions: 2,
              deletions: 1,
            },
          ]);
        });

        it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 reports one Files changed card for a turn a queued message extended, counting edits from before and after it", async () => {
          const vault = makeVault({ "notes/a.md": "a\n", "notes/b.md": "b\n" });
          const mock = makeMockBackend();
          const sent = recordPrompts(mock);
          const session = new AgentSession({
            backend: mock.asBackend,
            backendSessionId: "acp-1",
            internalId: "internal-1",
            backendId: "claude",
            getApp: () => vault.app,
            getDescriptor: midTurnDescriptor,
          });
          session.completeResume(null);
          const first = session.sendPrompt("edit a, then b");
          await waitFor(() => expect(sent).toHaveLength(1));
          mock.emitUpdate({ sessionUpdate: "message_delivered", promptId: sent[0].promptId });
          mock.emitUpdate({ sessionUpdate: "turn_started", turnId: "t1" });
          mock.emit(editCall("e1", "/vault/notes/a.md"));
          vault.files.set("notes/a.md", "A\n");
          const steer = session.sendPrompt("also uppercase b");
          await waitFor(() => expect(sent).toHaveLength(2));
          mock.emitUpdate({ sessionUpdate: "message_delivered", promptId: steer.userMessageId });
          mock.emit(editCall("e2", "/vault/notes/b.md"));
          vault.files.set("notes/b.md", "B\n");
          mock.emitUpdate({ sessionUpdate: "turn_ended", turnId: "t1", stopReason: "end_turn" });
          await first.turn;

          const replies = session.store.getDisplayMessages().filter((m) => m.sender === AI_SENDER);
          expect(replies).toHaveLength(2);
          expect(replies[0].fileChanges).toBeUndefined();
          expect(replies[1].fileChanges?.map((change) => change.path)).toEqual([
            "notes/a.md",
            "notes/b.md",
          ]);
        });

        it("reports a file missing when the turn first named it as created, and one missing at turn end as deleted", async () => {
          const vault = makeVault({ "notes/old.md": "stale\n" });
          const mock = makeMockBackend();
          mock.prompt.mockImplementation(async () => {
            mock.emit(editCall("t1", "/vault/notes/new.md"));
            mock.emit(toolCall("t2", "delete", ["/vault/notes/old.md"]));
            vault.files.set("notes/new.md", "fresh\n");
            vault.files.delete("notes/old.md");
            return { stopReason: "end_turn" as const };
          });
          const session = makeSession(mock, vault.app);

          await session.sendPrompt("replace the old note").turn;

          expect(fileChangesOf(session)).toEqual([
            {
              path: "notes/new.md",
              status: "created",
              before: null,
              after: "fresh\n",
              additions: 1,
              deletions: 0,
            },
            {
              path: "notes/old.md",
              status: "deleted",
              before: "stale\n",
              after: null,
              additions: 0,
              deletions: 1,
            },
          ]);
        });

        it("reports nothing for a file the turn edited and then restored", async () => {
          const vault = makeVault({ "notes/a.md": "original\n" });
          const mock = makeMockBackend();
          mock.prompt.mockImplementation(async () => {
            mock.emit(editCall("t1", "/vault/notes/a.md"));
            vault.files.set("notes/a.md", "changed\n");
            vault.files.set("notes/a.md", "original\n");
            return { stopReason: "end_turn" as const };
          });
          const session = makeSession(mock, vault.app);

          await session.sendPrompt("edit and undo").turn;

          expect(fileChangesOf(session)).toBeUndefined();
        });

        it("leaves a file the turn only read out of the reported changes https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
          const vault = makeVault({ "notes/a.md": "unchanged\n" });
          const mock = makeMockBackend();
          mock.prompt.mockImplementation(async () => {
            mock.emit(toolCall("t1", "read", ["/vault/notes/a.md"]));
            vault.files.set("notes/a.md", "changed by someone else\n");
            return { stopReason: "end_turn" as const };
          });
          const session = makeSession(mock, vault.app);

          await session.sendPrompt("read it").turn;

          expect(fileChangesOf(session)).toBeUndefined();
        });

        it("ignores paths outside the vault and inside hidden folders https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
          const vault = makeVault({});
          const mock = makeMockBackend();
          mock.prompt.mockImplementation(async () => {
            mock.emit(editCall("t1", "/tmp/scratch.md"));
            mock.emit(editCall("t2", "/vault/.config/plugins/copilot/data.json"));
            vault.files.set(".config/plugins/copilot/data.json", "{}");
            return { stopReason: "end_turn" as const };
          });
          const session = makeSession(mock, vault.app);

          await session.sendPrompt("touch everything").turn;

          expect(fileChangesOf(session)).toBeUndefined();
          expect(vault.adapter.read).not.toHaveBeenCalled();
        });

        it("still reports what landed when the user cancels the turn", async () => {
          const vault = makeVault({ "notes/a.md": "one\n" });
          const mock = makeMockBackend();
          let markPromptEntered!: () => void;
          const promptEntered = new Promise<void>((resolve) => {
            markPromptEntered = resolve;
          });
          mock.prompt.mockImplementation(() => {
            mock.emit(editCall("t1", "/vault/notes/a.md"));
            vault.files.set("notes/a.md", "one\ntwo\n");
            markPromptEntered();
            return new Promise<never>(() => {});
          });
          const session = makeSession(mock, vault.app);

          const { turn } = session.sendPrompt("edit it");
          await promptEntered;
          await session.cancel();
          await turn;

          expect(fileChangesOf(session)).toMatchObject([
            { path: "notes/a.md", status: "modified", additions: 1, deletions: 0 },
          ]);
        });

        it("starts each turn from a clean slate so an earlier turn's files are not re-reported", async () => {
          const vault = makeVault({ "notes/a.md": "one\n" });
          const mock = makeMockBackend();
          mock.prompt.mockImplementationOnce(async () => {
            mock.emit(editCall("t1", "/vault/notes/a.md"));
            vault.files.set("notes/a.md", "one\ntwo\n");
            return { stopReason: "end_turn" as const };
          });
          mock.prompt.mockImplementationOnce(async () => ({ stopReason: "end_turn" as const }));
          const session = makeSession(mock, vault.app);

          await session.sendPrompt("edit it").turn;
          expect(fileChangesOf(session)).toHaveLength(1);

          await session.sendPrompt("say hello").turn;
          expect(fileChangesOf(session)).toBeUndefined();
        });

        it("ignores a late update to an earlier turn's edit so the current turn does not report it https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
          const vault = makeVault({ "notes/a.md": "one\n" });
          const mock = makeMockBackend();
          mock.prompt.mockImplementationOnce(async () => {
            mock.emit(editCall("t1", "/vault/notes/a.md"));
            vault.files.set("notes/a.md", "one\ntwo\n");
            return { stopReason: "end_turn" as const };
          });
          mock.prompt.mockImplementationOnce(async () => {
            mock.emit(toolResult("t1", { "/vault/notes/a.md": "one\n" }));
            return { stopReason: "end_turn" as const };
          });
          const session = makeSession(mock, vault.app);

          await session.sendPrompt("edit it").turn;
          expect(fileChangesOf(session)).toHaveLength(1);

          await session.sendPrompt("say hello").turn;
          expect(fileChangesOf(session)).toBeUndefined();
        });

        it("captures nothing when the session has no app to read the vault through", async () => {
          const mock = makeMockBackend();
          mock.prompt.mockImplementation(async () => {
            mock.emit(editCall("t1", "notes/a.md"));
            return { stopReason: "end_turn" as const };
          });
          const session = new AgentSession({
            backend: mock.asBackend,
            backendSessionId: "acp-1",
            internalId: "internal-1",
            backendId: "claude",
          });
          session.completeResume(null);

          await session.sendPrompt("edit it").turn;

          expect(fileChangesOf(session)).toBeUndefined();
        });

        describe("before text from the first-mention snapshot", () => {
          it("snapshots as soon as a permission request names the file it wants to edit", async () => {
            const vault = makeVault({ "notes/a.md": "before the turn\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              void session.handleToolPermission({
                sessionId: "acp-1",
                toolCall: {
                  toolCallId: "t1",
                  title: "write",
                  kind: "edit",
                  locations: [{ path: "/vault/notes/a.md" }],
                },
                options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
              });
              vault.files.set("notes/a.md", "written by the agent\n");
              mock.emit(editCall("t1", "/vault/notes/a.md"));
              return { stopReason: "end_turn" as const };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("write it").turn;

            expect(fileChangesOf(session)).toMatchObject([
              { path: "notes/a.md", before: "before the turn\n", after: "written by the agent\n" },
            ]);
          });

          it("keeps the snapshot from an earlier read so a later write's announcement cannot overtake it", async () => {
            const vault = makeVault({ "notes/a.md": "before the turn\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit(toolCall("t1", "read", ["/vault/notes/a.md"]));
              vault.files.set("notes/a.md", "written by the agent\n");
              mock.emit(editCall("t2", "/vault/notes/a.md"));
              return { stopReason: "end_turn" as const };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("rewrite it").turn;

            expect(fileChangesOf(session)).toMatchObject([
              { path: "notes/a.md", before: "before the turn\n", after: "written by the agent\n" },
            ]);
          });

          it("captures an edit whose path and kind arrive only in later updates to the tool call", async () => {
            const vault = makeVault({ "notes/a.md": "one\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit({
                sessionId: "acp-1",
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: "t1",
                  title: "edit",
                  kind: "edit",
                  status: "pending",
                },
              });
              mock.emit({
                sessionId: "acp-1",
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: "t1",
                  status: "in_progress",
                  locations: [{ path: "/vault/notes/a.md" }],
                },
              });
              vault.files.set("notes/a.md", "one\ntwo\n");
              return { stopReason: "end_turn" as const };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("edit it").turn;

            expect(fileChangesOf(session)).toMatchObject([
              { path: "notes/a.md", before: "one\n", after: "one\ntwo\n" },
            ]);
          });
        });

        describe("before text from tool result originals", () => {
          it("takes the original a tool result reports over a snapshot the write overtook https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
            const vault = makeVault({ "notes/a.md": "already written by the agent\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit(editCall("t1", "/vault/notes/a.md"));
              mock.emit(toolResult("t1", { "/vault/notes/a.md": "the true original\n" }));
              return { stopReason: "end_turn" as const };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("edit it").turn;

            expect(fileChangesOf(session)).toMatchObject([
              { before: "the true original\n", after: "already written by the agent\n" },
            ]);
          });

          it("keeps the first original when a later edit to the same file reports its own https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
            const vault = makeVault({ "notes/a.md": "third\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit(editCall("t1", "/vault/notes/a.md"));
              mock.emit(toolResult("t1", { "/vault/notes/a.md": "first\n" }));
              mock.emit(editCall("t2", "/vault/notes/a.md"));
              mock.emit(toolResult("t2", { "/vault/notes/a.md": "second\n" }));
              return { stopReason: "end_turn" as const };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("edit it twice").turn;

            expect(fileChangesOf(session)).toMatchObject([
              { path: "notes/a.md", before: "first\n", after: "third\n" },
            ]);
          });

          it("matches each original to its own file when one call changes several https://github.com/Brevilabs/obsidian-copilot-private/issues/687", async () => {
            const vault = makeVault({ "notes/a.md": "a after\n", "notes/moved.md": "moved\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit(
                toolCall("t1", "edit", [
                  "/vault/notes/a.md",
                  "/vault/notes/old.md",
                  "/vault/notes/moved.md",
                ])
              );
              mock.emit(
                toolResult("t1", {
                  "/vault/notes/a.md": "a before\n",
                  "/vault/notes/old.md": "moved\n",
                  "/vault/notes/moved.md": null,
                })
              );
              return { stopReason: "end_turn" as const };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("patch and move").turn;

            expect(fileChangesOf(session)).toEqual([
              expect.objectContaining({ path: "notes/a.md", before: "a before\n" }),
              expect.objectContaining({ path: "notes/old.md", status: "deleted" }),
              expect.objectContaining({ path: "notes/moved.md", status: "created" }),
            ]);
          });
        });

        describe("before text from the backend's turn diff", () => {
          const turnDiff = {
            root: "/vault",
            unifiedDiff: [
              "diff --git a/notes/a.md b/notes/a.md",
              "--- a/notes/a.md",
              "+++ b/notes/a.md",
              "@@ -1,3 +1,4 @@",
              " one",
              "-two",
              "+TWO",
              "+inserted",
              " three",
              "",
            ].join("\n"),
          };

          it("recovers a file's before text by reversing the turn diff over a snapshot the write overtook https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
            const vault = makeVault({ "notes/a.md": "one\nTWO\ninserted\nthree\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit(editCall("t1", "/vault/notes/a.md"));
              return { stopReason: "end_turn" as const, turnDiff };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("patch it").turn;

            expect(fileChangesOf(session)).toMatchObject([
              {
                path: "notes/a.md",
                status: "modified",
                before: "one\ntwo\nthree\n",
                after: "one\nTWO\ninserted\nthree\n",
              },
            ]);
          });

          it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 ends the turn without a file change card when the turn diff is malformed", async () => {
            const vault = makeVault({ "notes/a.md": "one\nTWO\ninserted\nthree\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit(editCall("t1", "/vault/notes/a.md"));
              return {
                stopReason: "end_turn" as const,
                turnDiff: { root: "/vault", unifiedDiff: "@@ -1 +1 @@\n?not a diff line\n" },
              };
            });
            const session = makeSession(mock, vault.app);

            await expect(session.sendPrompt("patch it").turn).resolves.toBe("end_turn");
            expect(fileChangesOf(session)).toBeUndefined();
            expect(session.getStatus()).toBe("idle");
          });

          it("falls back to the snapshot for a file the turn diff no longer applies to https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
            const vault = makeVault({ "notes/a.md": "snapshot\n" });
            const mock = makeMockBackend();
            mock.prompt.mockImplementation(async () => {
              mock.emit(editCall("t1", "/vault/notes/a.md"));
              vault.files.set("notes/a.md", "rewritten after the patch\n");
              return { stopReason: "end_turn" as const, turnDiff };
            });
            const session = makeSession(mock, vault.app);

            await session.sendPrompt("patch it").turn;

            expect(fileChangesOf(session)).toMatchObject([
              { path: "notes/a.md", before: "snapshot\n", after: "rewritten after the patch\n" },
            ]);
          });
        });
      });
    });

    describe("cancel()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 keeps a message queued for the agent's next step through Stop, and shows its turn when the agent runs it", async () => {
        const mock = makeMockBackend();
        const emit = (update: SessionEvent["update"]) => mock.emitUpdate(update);
        const sent = recordPrompts(mock);
        const session = makeSession(mock, { getDescriptor: midTurnDescriptor });
        const first = session.sendPrompt("first");
        await waitFor(() => expect(sent).toHaveLength(1));
        emit({ sessionUpdate: "message_delivered", promptId: sent[0].promptId });
        emit({ sessionUpdate: "turn_started", turnId: "t1" });
        const steer = session.sendPrompt("second");
        await waitFor(() => expect(sent).toHaveLength(2));

        await session.cancel();
        emit({ sessionUpdate: "turn_ended", turnId: "t1", stopReason: "cancelled" });
        await expect(first.turn).resolves.toBe("cancelled");
        expect(session.getQueuedPrompts()).toHaveLength(1);

        emit({ sessionUpdate: "message_delivered", promptId: steer.userMessageId });
        emit({ sessionUpdate: "turn_started", turnId: "t2" });
        emit(replayText("agent_message_chunk", "Second answer."));
        emit({ sessionUpdate: "turn_ended", turnId: "t2", stopReason: "end_turn" });

        await expect(steer.turn).resolves.toBe("end_turn");
        expect(bubbles(session).slice(-2)).toEqual([
          { sender: USER_SENDER, message: "second" },
          { sender: AI_SENDER, message: "Second answer." },
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 settles a prompt held behind a stopped turn as cancelled, without sending it, when the chat closes", async () => {
        const mock = makeMockBackend();
        mock.prompt.mockImplementationOnce(() => new Promise(() => undefined));
        const session = makeSession(mock);
        const first = session.sendPrompt("first");
        await session.cancel();
        await expect(first.turn).resolves.toBe("cancelled");

        const next = session.sendPrompt("second");
        await session.dispose();

        await expect(next.turn).resolves.toBe("cancelled");
        expect(mock.prompt).toHaveBeenCalledTimes(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 sends nothing and keeps one cancelled reply for a prompt stopped while it waits behind a stopped turn", async () => {
        const mock = makeMockBackend();
        const endFirstTurn = holdPrompt(mock);
        const session = makeSession(mock);
        const first = session.sendPrompt("first");
        await session.cancel();
        await expect(first.turn).resolves.toBe("cancelled");

        const next = session.sendPrompt("second");
        await session.cancel();
        endFirstTurn("cancelled");

        await expect(next.turn).resolves.toBe("cancelled");
        expect(mock.prompt).toHaveBeenCalledTimes(1);
        expect(session.store.getDisplayMessages().map((m) => [m.sender, m.turnStopReason])).toEqual(
          [
            [USER_SENDER, undefined],
            [AI_SENDER, "cancelled"],
            [USER_SENDER, undefined],
            [AI_SENDER, "cancelled"],
          ]
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 settles a turn stopped while the agent is still accepting its prompt as cancelled and leaves the chat idle", async () => {
        const mock = makeMockBackend();
        mock.asBackend.prompt = () => new Promise(() => undefined);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("hi");
        await session.cancel();

        await expect(turn).resolves.toBe("cancelled");
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 leaves one cancelled reply and runs no agents when Stop lands during the multi-agent entitlement check", async () => {
        const mock = makeMockBackend();
        let finishEntitlementCheck!: (entitled: boolean) => void;
        jest
          .mocked(ensureMultiAgentEntitlement)
          .mockImplementationOnce(
            () => new Promise<boolean>((resolve) => (finishEntitlementCheck = resolve))
          );
        const runFanoutTurn = jest.fn();
        const session = makeSession(mock, { runFanoutTurn });
        const { turn } = session.sendPrompt("review", undefined, undefined, ["opencode", "claude"]);

        await session.cancel();
        finishEntitlementCheck(true);

        await expect(turn).resolves.toBe("cancelled");
        expect(runFanoutTurn).not.toHaveBeenCalled();
        expect(session.store.getDisplayMessages().map((m) => [m.sender, m.turnStopReason])).toEqual(
          [
            [USER_SENDER, undefined],
            [AI_SENDER, "cancelled"],
          ]
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 sends the next prompt once the stopped prompt is withdrawn, without waiting for a turn that will never come", async () => {
        const mock = makeMockBackend();
        let stoppedPromptId = "";
        const realPrompt = mock.asBackend.prompt;
        mock.asBackend.prompt = async (input) => {
          stoppedPromptId = input.promptId;
        };
        const session = makeSession(mock);
        const first = session.sendPrompt("first");
        await waitFor(() => expect(stoppedPromptId).not.toBe(""));
        await session.cancel();
        await first.turn;
        mock.asBackend.prompt = realPrompt;

        const next = session.sendPrompt("second");
        mock.emitUpdate({ sessionUpdate: "messages_withdrawn", promptIds: [stoppedPromptId] });

        expect(await next.turn).toBe("end_turn");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 keeps a background task's permission request answerable when Stop ends the main turn", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("hi");
        void session.handleToolPermission(writePermissionRequest());
        const fromTask = session.handleToolPermission({
          ...writePermissionRequest(),
          requester: { taskId: "task-1" },
          toolCall: { ...writePermissionRequest().toolCall, toolCallId: "tc-task" },
        });

        await session.cancel();
        finishPrompt("cancelled");
        await turn;

        expect(session.getPendingToolPermissions().map((p) => p.toolCall.toolCallId)).toEqual([
          "tc-task",
        ]);
        session.resolveToolPermission("tc-task", "allow_once");
        await expect(fromTask).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "allow_once" },
        });
      });

      it("sends a cancel to the backend and resolves the turn as cancelled", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("hi");
        await session.cancel();
        expect(mock.cancel).toHaveBeenCalledWith({ sessionId: "acp-1" });
        finishPrompt("cancelled");
        expect(await turn).toBe("cancelled");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 drops compaction updates that arrive after a cancel and settles the open row to cancelled", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        const { turn } = session.sendPrompt("/compact");
        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "c1",
          status: "in_progress",
          trigger: "manual",
        });

        await session.cancel();
        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "c1",
          status: "completed",
          trigger: "manual",
        });
        mock.emitUpdate({
          sessionUpdate: "compaction",
          id: "late",
          status: "in_progress",
          trigger: "auto",
        });
        finishPrompt("cancelled");
        await turn;

        expect(aiMessage(session)?.parts).toEqual([
          expect.objectContaining({ kind: "compaction", id: "c1", status: "cancelled" }),
        ]);
      });

      it("settles locally, drops retry output, and holds the next prompt until the stopped turn ends when backend cancellation fails", async () => {
        const mock = makeMockBackend();
        let resolveBackingPrompt: ((value: { stopReason: "cancelled" }) => void) | null = null;
        let resolveSecondPrompt: ((value: { stopReason: "end_turn" }) => void) | null = null;
        let secondPromptSent!: () => void;
        const secondPromptSending = new Promise<void>((resolve) => (secondPromptSent = resolve));
        mock.prompt
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolveBackingPrompt = resolve;
              })
          )
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolveSecondPrompt = resolve;
                secondPromptSent();
              })
          );
        const session = makeSession(mock);
        const emitChunk = (
          sessionUpdate: "agent_thought_chunk" | "agent_message_chunk",
          text: string,
          messageId = "msg-first"
        ) => mock.emitUpdate({ sessionUpdate, messageId, content: { type: "text", text } });
        const { turn } = session.sendPrompt("first");

        emitChunk("agent_thought_chunk", "initial thought");
        emitChunk("agent_message_chunk", "partial answer");
        mock.cancel.mockImplementation(() => {
          emitChunk("agent_thought_chunk", " retry during cancel");
          mock.emitUpdate({
            sessionUpdate: "tool_call",
            toolCallId: "tc-stale",
            title: "Stale retry tool",
            status: "pending",
          });
          return Promise.reject(new Error("cancel unsupported"));
        });

        await session.cancel();
        await expect(turn).resolves.toBe("cancelled");
        expect(session.getStatus()).toBe("idle");

        emitChunk("agent_message_chunk", " retry after cancel");
        const firstAnswer = aiMessage(session);
        expect(firstAnswer?.message).toBe("partial answer");
        expect(firstAnswer?.parts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "thought", text: "initial thought" }),
          ])
        );
        expect(firstAnswer?.parts?.some((part) => part.kind === "tool_call")).toBe(false);
        expect(firstAnswer?.turnStopReason).toBe("cancelled");

        const next = session.sendPrompt("second");
        expect(mock.prompt).toHaveBeenCalledTimes(1);
        emitChunk("agent_message_chunk", " stale retry", "msg-retry");

        resolveBackingPrompt!({ stopReason: "cancelled" });
        await secondPromptSending;
        emitChunk("agent_message_chunk", " stale trailing chunk", "msg-retry");
        emitChunk("agent_message_chunk", "recovered", "msg-second");
        resolveSecondPrompt!({ stopReason: "end_turn" });
        await expect(next.turn).resolves.toBe("end_turn");
        expect(session.store.getDisplayMessages().at(-1)?.message).toBe("recovered");
      });

      it("routes a prior turn's tool update after the current turn is cancelled", async () => {
        const mock = makeMockBackend();
        const resolvePrompts: Array<(value: { stopReason: "end_turn" | "cancelled" }) => void> = [];
        mock.prompt.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolvePrompts.push(resolve);
            })
        );
        const session = makeSession(mock, { backendId: "claude-code" });

        const first = session.sendPrompt("launch a background agent");
        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc-agent",
          title: "Agent",
          status: "in_progress",
        });
        resolvePrompts[0]({ stopReason: "end_turn" });
        await first.turn;

        const second = session.sendPrompt("do something else");
        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc-cancelled",
          title: "Current turn tool",
          status: "in_progress",
        });
        await session.cancel();
        await expect(second.turn).resolves.toBe("cancelled");

        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-agent",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "agent report" } }],
        });
        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-cancelled",
          status: "completed",
        });

        const ai = aiMessages(session);
        expect(ai[0]?.parts?.[0]).toMatchObject({
          kind: "tool_call",
          id: "tc-agent",
          status: "completed",
          output: [{ type: "text", text: "agent report" }],
        });
        expect(ai[1]?.parts?.[0]).toMatchObject({
          kind: "tool_call",
          id: "tc-cancelled",
          status: "in_progress",
        });

        resolvePrompts[1]({ stopReason: "cancelled" });
      });

      it("rejects a pending inline tool permission before awaiting backend cancel", async () => {
        const mock = makeMockBackend();
        let decisionPromise: Promise<unknown> = Promise.resolve();
        const finishPrompt = holdPrompt(mock);
        mock.cancel.mockImplementation(() => decisionPromise.then(() => undefined));
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("edit a file");

        decisionPromise = session.handleToolPermission(writePermissionRequest());

        const cancelPromise = session.cancel();
        await expect(decisionPromise).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
        expect(session.getPendingToolPermissions()).toHaveLength(0);
        await cancelPromise;

        finishPrompt("cancelled");
        await turn;
      });

      it("flushes a pending AskUserQuestion with empty answers when the turn is cancelled", async () => {
        const mock = makeMockBackend();
        let answersPromise: Promise<unknown> = Promise.resolve();
        const finishPrompt = holdPrompt(mock);
        mock.cancel.mockImplementation(() => answersPromise.then(() => undefined));
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("ask me something");

        answersPromise = session.handleAskUserQuestion({
          sessionId: "acp-1",
          requestId: "tc-ask",
          questions: [{ question: "Pick a fruit", options: [{ label: "Apple" }] }],
        });
        expect(session.getStatus()).toBe("awaiting_permission");

        const cancelPromise = session.cancel();
        await expect(answersPromise).resolves.toEqual({});
        expect(session.getPendingAskUserQuestions()).toHaveLength(0);
        await cancelPromise;

        finishPrompt("cancelled");
        await turn;
      });
    });

    describe("releaseBackendSession()", () => {
      function setupReleaseSession() {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        return { mock, session };
      }

      it("closes a running backend session without waiting for cancellation https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const { mock, session } = setupReleaseSession();
        mock.cancel.mockImplementation(() => new Promise<void>(() => undefined));
        let finishPrompt!: (result: { stopReason: "cancelled" }) => void;
        mock.prompt.mockImplementation(
          () =>
            new Promise((resolve) => {
              finishPrompt = resolve;
            })
        );
        const turn = session.sendPrompt("release this session").turn;

        const release = session.releaseBackendSession();
        await Promise.resolve();

        expect(mock.closeSession).toHaveBeenCalledWith({ sessionId: "acp-1" });
        expect(mock.cancel).not.toHaveBeenCalled();
        await release;
        finishPrompt({ stopReason: "cancelled" });
        await turn;
      });

      it.each(["missing", "unsupported"])(
        "explains %s close support for https://github.com/Brevilabs/obsidian-copilot-private/issues/429",
        async (kind) => {
          const { mock, session } = setupReleaseSession();
          if (kind === "missing") delete mock.asBackend.closeSession;
          else mock.closeSession.mockRejectedValueOnce(new MethodUnsupportedError("session/close"));

          await expect(session.releaseBackendSession()).rejects.toThrow(
            "This agent does not support closing individual sessions."
          );
        }
      );
    });

    describe("loadDisplayMessages()", () => {
      it("replaces the transcript and notifies subscribers so an open view re-renders", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const onMessagesChanged = jest.fn();
        subscribeTo(session, { onMessagesChanged });

        session.loadDisplayMessages([
          {
            id: "m0",
            sender: USER_SENDER,
            message: "earlier prompt",
            isVisible: true,
            timestamp: null,
          },
          {
            id: "m1",
            sender: AI_SENDER,
            message: "earlier reply",
            isVisible: true,
            timestamp: null,
          },
        ]);

        expect(onMessagesChanged).toHaveBeenCalledTimes(1);
        expect(session.hasUserVisibleMessages()).toBe(true);
        expect(session.store.getDisplayMessages().map((m) => m.message)).toEqual([
          "earlier prompt",
          "earlier reply",
        ]);
      });
    });

    describe("resendSavedHistoryOnNextTurn()", () => {
      const ISSUE_3643 = "https://github.com/logancyang/obsidian-copilot/issues/3643";
      const savedChat: AgentChatMessage[] = [
        {
          id: "m0",
          sender: USER_SENDER,
          message: "my secret word is PELICAN",
          isVisible: true,
          timestamp: null,
        },
        {
          id: "m1",
          sender: AI_SENDER,
          message: "Noted: PELICAN",
          isVisible: true,
          timestamp: null,
        },
      ];
      const promptTexts = (mock: MockBackend): string[] =>
        mock.prompt.mock.calls.map(
          (call) => (call[0] as { prompt: Array<{ text: string }> }).prompt[0].text
        );

      it(`${ISSUE_3643} sends the saved turns as conversation_history ahead of the next prompt, then never again`, async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        session.loadDisplayMessages(savedChat);
        session.resendSavedHistoryOnNextTurn();

        await session.sendPrompt("what is my secret word?").turn;
        await session.sendPrompt("and backwards?").turn;

        const [first, second] = promptTexts(mock);
        expect(first).toContain("<conversation_history>");
        expect(first).toContain('<turn role="user">\nmy secret word is PELICAN\n</turn>');
        expect(first).toContain('<turn role="assistant">\nNoted: PELICAN\n</turn>');
        expect(first).toContain("<user-message>\nwhat is my secret word?\n</user-message>");
        expect(second).toBe("and backwards?");
      });

      it(`${ISSUE_3643} keeps the saved turns for the following prompt when the first turn is cancelled`, async () => {
        const mock = makeMockBackend();
        mock.prompt.mockResolvedValueOnce({ stopReason: "cancelled" });
        const session = makeSession(mock);
        session.loadDisplayMessages(savedChat);
        session.resendSavedHistoryOnNextTurn();

        await session.sendPrompt("what is my secret word?").turn;
        await session.sendPrompt("what is my secret word?").turn;

        const [, retry] = promptTexts(mock);
        expect(retry).toContain("<conversation_history>");
        expect(retry).toContain("my secret word is PELICAN");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 never resends the saved turns after a prompt cut off at its output limit delivered them, even when the continuation fails", async () => {
        const mock = makeMockBackend();
        mock.prompt
          .mockResolvedValueOnce({ stopReason: "max_tokens" })
          .mockRejectedValueOnce(new Error("connection dropped"));
        const session = makeSession(mock);
        session.loadDisplayMessages(savedChat);
        session.resendSavedHistoryOnNextTurn();

        await expect(session.sendPrompt("what is my secret word?").turn).rejects.toThrow(
          "connection dropped"
        );
        await session.sendPrompt("and backwards?").turn;

        expect(promptTexts(mock)[2]).toBe("and backwards?");
      });

      it("sends no conversation_history when no saved history is queued", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        session.loadDisplayMessages(savedChat);

        await session.sendPrompt("what is my secret word?").turn;

        expect(promptTexts(mock)).toEqual(["what is my secret word?"]);
      });
    });

    describe("setModel()", () => {
      it("switches the model on the backend and replaces the cached state", async () => {
        const mock = makeMockBackend();
        const newState: BackendState = {
          model: {
            current: { baseModelId: "x/y", effort: null },
            apply: { kind: "setModel" },
            availableModels: [
              { baseModelId: "x/y", name: "X Y", provider: null, effortOptions: [] },
            ],
          },
          mode: null,
        };
        mock.setSessionModel.mockResolvedValueOnce(newState);
        const session = makeSession(mock);
        await session.setModel("x/y");
        expect(mock.setSessionModel).toHaveBeenCalledWith({ sessionId: "acp-1", modelId: "x/y" });
        expect(session.getState()?.model?.current.baseModelId).toBe("x/y");
      });

      it("rethrows MethodUnsupportedError without mutating local state", async () => {
        const mock = makeMockBackend();
        mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
        const session = makeSession(mock);
        await expect(session.setModel("x/y")).rejects.toBeInstanceOf(MethodUnsupportedError);
        expect(session.getState()).toBeNull();
      });

      it("notifies onModelChanged listeners after successful switch", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const onModelChanged = jest.fn();
        subscribeTo(session, { onModelChanged });
        await session.setModel("x/y");
        expect(onModelChanged).toHaveBeenCalledTimes(1);
      });
    });

    describe("setConfigOption()", () => {
      it("sends the option to the backend and replaces the cached state with its response", async () => {
        const mock = makeMockBackend();
        const next = sonnetAndGpt5State();
        mock.setSessionConfigOption.mockResolvedValueOnce(next);
        const session = makeSession(mock, { backendId: "claude" });
        await session.setConfigOption("effort", "high");
        expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "acp-1",
          configId: "effort",
          value: "high",
        });
        expect(session.getState()).toBe(next);
      });

      it("notifies onModelChanged subscribers on success", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });
        const onModelChanged = jest.fn();
        subscribeTo(session, { onModelChanged });
        await session.setConfigOption("effort", "low");
        expect(onModelChanged).toHaveBeenCalledTimes(1);
      });

      it("rethrows MethodUnsupportedError without notifying", async () => {
        const mock = makeMockBackend();
        mock.setSessionConfigOption.mockRejectedValueOnce(
          new MethodUnsupportedError("session/set_config_option")
        );
        const session = makeSession(mock, { backendId: "claude" });
        const onModelChanged = jest.fn();
        subscribeTo(session, { onModelChanged });
        await expect(session.setConfigOption("effort", "high")).rejects.toBeInstanceOf(
          MethodUnsupportedError
        );
        expect(onModelChanged).not.toHaveBeenCalled();
      });
    });

    describe("setMode()", () => {
      it("sends the mode to the backend and replaces the cached state with its response", async () => {
        const mock = makeMockBackend();
        const next = sonnetAndGpt5State();
        mock.setSessionMode.mockResolvedValueOnce(next);
        const session = makeSession(mock, { backendId: "claude" });
        await session.setMode("plan");
        expect(mock.setSessionMode).toHaveBeenCalledWith({ sessionId: "acp-1", modeId: "plan" });
        expect(session.getState()).toBe(next);
      });

      it("rethrows MethodUnsupportedError without mutating local state", async () => {
        const mock = makeMockBackend();
        mock.setSessionMode.mockRejectedValueOnce(new MethodUnsupportedError("session/set_mode"));
        const session = makeSession(mock, { backendId: "claude" });
        await expect(session.setMode("plan")).rejects.toBeInstanceOf(MethodUnsupportedError);
        expect(session.getState()).toBeNull();
      });

      it("notifies onModelChanged listeners after successful switch", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });
        const onModelChanged = jest.fn();
        subscribeTo(session, { onModelChanged });
        await session.setMode("plan");
        expect(onModelChanged).toHaveBeenCalledTimes(1);
      });
    });

    function makeDescriptor(opts: {
      descriptorStyleEffort?: boolean;
    }): () => BackendDescriptor | undefined {
      const descriptor = {
        id: "test-backend",
        displayName: "Test",
        wire: {
          encode: () => "",
          decode: () => ({ selection: { baseModelId: "", effort: null }, provider: null }),
          ...(opts.descriptorStyleEffort
            ? {
                effortConfigFor: () => ({
                  id: "reasoning_effort",
                  label: "Effort",
                  values: [],
                }),
              }
            : {}),
        },
      } as unknown as BackendDescriptor;
      return () => descriptor;
    }

    function sessionWith(opts: {
      isModelSwitchSupported: boolean | null;
      isSetSessionConfigOptionSupported: boolean | null;
      isSetModeSupported: boolean | null;
      descriptorStyleEffort?: boolean;
      initialState?: BackendState;
    }): AgentSession {
      const mock = makeMockBackend();
      mock.asBackend.isSetSessionModelSupported = () => opts.isModelSwitchSupported;
      mock.asBackend.isSetSessionConfigOptionSupported = () =>
        opts.isSetSessionConfigOptionSupported;
      mock.asBackend.isSetSessionModeSupported = () => opts.isSetModeSupported;
      return makeSession(mock, {
        backendId: "test-backend",
        initialState: opts.initialState ?? null,
        getDescriptor: makeDescriptor({ descriptorStyleEffort: opts.descriptorStyleEffort }),
      });
    }

    describe("canSwitchModel()", () => {
      it("mirrors the backend's model-switch support (true, false, or unknown)", () => {
        expect(
          sessionWith({
            isModelSwitchSupported: true,
            isSetSessionConfigOptionSupported: false,
            isSetModeSupported: false,
          }).canSwitchModel()
        ).toBe(true);
        expect(
          sessionWith({
            isModelSwitchSupported: false,
            isSetSessionConfigOptionSupported: true,
            isSetModeSupported: true,
          }).canSwitchModel()
        ).toBe(false);
        expect(
          sessionWith({
            isModelSwitchSupported: null,
            isSetSessionConfigOptionSupported: true,
            isSetModeSupported: true,
          }).canSwitchModel()
        ).toBeNull();
      });

      it("all canSwitch methods return false until the new session has started", async () => {
        const mock = makeMockBackend();
        let resolveNew: ((value: { sessionId: string; state: BackendState }) => void) | null = null;
        mock.newSession.mockReturnValueOnce(
          new Promise((resolve) => {
            resolveNew = resolve;
          })
        );
        mock.asBackend.isSetSessionModelSupported = () => true;
        mock.asBackend.isSetSessionConfigOptionSupported = () => true;
        mock.asBackend.isSetSessionModeSupported = () => true;
        const session = startSession(mock, {
          backendId: "test-backend",
          getDescriptor: () => undefined,
        });
        expect(session.getStatus()).toBe("starting");
        expect(session.canSwitchModel()).toBe(false);
        expect(session.canSwitchEffort()).toBe(false);
        expect(session.canSwitchMode()).toBe(false);

        resolveNew!({
          sessionId: "acp-1",
          state: {
            model: null,
            mode: {
              current: "plan",
              options: [{ value: "plan", label: "Plan" }],
              apply: { plan: { kind: "setMode", nativeId: "plan" } },
            },
          },
        });
        await session.ready;
        expect(session.canSwitchModel()).toBe(true);
        expect(session.canSwitchMode()).toBe(true);
      });
    });

    describe("canSwitchEffort()", () => {
      it("follows config-option support for backends that expose a separate effort option", () => {
        expect(
          sessionWith({
            isModelSwitchSupported: false,
            isSetSessionConfigOptionSupported: true,
            isSetModeSupported: false,
            descriptorStyleEffort: true,
          }).canSwitchEffort()
        ).toBe(true);
      });

      it("follows model-switch support for backends that encode effort in the model id", () => {
        expect(
          sessionWith({
            isModelSwitchSupported: true,
            isSetSessionConfigOptionSupported: false,
            isSetModeSupported: false,
            descriptorStyleEffort: false,
          }).canSwitchEffort()
        ).toBe(true);
      });
    });

    describe("canSwitchMode()", () => {
      it("returns null when the backend reports no mode state", () => {
        expect(
          sessionWith({
            isModelSwitchSupported: false,
            isSetSessionConfigOptionSupported: true,
            isSetModeSupported: true,
          }).canSwitchMode()
        ).toBeNull();
      });

      it("follows config-option support when the first mode option applies via setConfigOption", () => {
        const state: BackendState = {
          model: null,
          mode: {
            current: "plan",
            options: [{ value: "plan", label: "Plan" }],
            apply: { plan: { kind: "setConfigOption", configId: "mode", value: "plan" } },
          },
        };
        expect(
          sessionWith({
            isModelSwitchSupported: false,
            isSetSessionConfigOptionSupported: true,
            isSetModeSupported: false,
            initialState: state,
          }).canSwitchMode()
        ).toBe(true);
      });

      it("follows set-mode support when the first mode option applies via setMode", () => {
        const state: BackendState = {
          model: null,
          mode: {
            current: "plan",
            options: [{ value: "plan", label: "Plan" }],
            apply: { plan: { kind: "setMode", nativeId: "plan" } },
          },
        };
        expect(
          sessionWith({
            isModelSwitchSupported: false,
            isSetSessionConfigOptionSupported: false,
            isSetModeSupported: true,
            initialState: state,
          }).canSwitchMode()
        ).toBe(true);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 requires both mode and config switching for Codex's combined picker", () => {
        const state: BackendState = {
          model: null,
          mode: {
            current: "default",
            options: [{ value: "default", label: "Default" }],
            apply: {
              default: {
                kind: "sequence",
                steps: [
                  { kind: "setMode", nativeId: "agent" },
                  { kind: "setConfigOption", configId: "collaboration_mode", value: "default" },
                ],
              },
            },
          },
        };

        expect(
          sessionWith({
            isModelSwitchSupported: false,
            isSetSessionConfigOptionSupported: true,
            isSetModeSupported: false,
            initialState: state,
          }).canSwitchMode()
        ).toBe(false);
        expect(
          sessionWith({
            isModelSwitchSupported: false,
            isSetSessionConfigOptionSupported: true,
            isSetModeSupported: true,
            initialState: state,
          }).canSwitchMode()
        ).toBe(true);
      });
    });

    describe("getState()", () => {
      it("replaces the cached state and notifies onModelChanged when the backend pushes a state_changed update", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });
        const onModelChanged = jest.fn();
        subscribeTo(session, { onModelChanged });
        const newState: BackendState = {
          model: null,
          mode: { current: "plan", options: [{ value: "plan", label: "Plan" }], apply: {} },
        };
        mock.emitUpdate({ sessionUpdate: "state_changed", state: newState });
        expect(session.getState()).toBe(newState);
        expect(onModelChanged).toHaveBeenCalledTimes(1);
      });
    });

    describe("getSessionUsage()", () => {
      it("starts null and stores an incoming usage_update, notifying subscribers", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const onMessagesChanged = jest.fn();
        subscribeTo(session, { onMessagesChanged });
        expect(session.getSessionUsage()).toBeNull();

        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 },
        });

        expect(session.getSessionUsage()).toEqual({
          usedTokens: 5000,
          contextWindow: 200_000,
          updatedAt: 1,
        });
        expect(onMessagesChanged).toHaveBeenCalled();
      });

      it.each([
        ["without a prior reading", undefined],
        ["keeping the held context window", 200_000],
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/635 sets the meter to a completed compaction's post-compaction tokens %s",
        async (_label, contextWindow) => {
          const mock = makeMockBackend();
          const finishPrompt = holdPrompt(mock);
          const session = makeSession(mock);
          if (contextWindow) {
            mock.emitUpdate({
              sessionUpdate: "usage_update",
              usage: { usedTokens: 103_000, contextWindow, updatedAt: 1 },
            });
          }
          const { turn } = session.sendPrompt("/compact");

          mock.emitUpdate({
            sessionUpdate: "compaction",
            id: "c1",
            status: "completed",
            trigger: "manual",
            preTokens: 103_249,
            postTokens: 4_046,
          });

          expect(session.getSessionUsage()).toEqual({
            usedTokens: 4_046,
            contextWindow,
            updatedAt: expect.any(Number),
          });
          finishPrompt();
          await turn;
        }
      );

      it("keeps the last positive usage when a stopped turn reports zero (https://github.com/logancyang/obsidian-copilot/issues/2975)", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock);
        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 },
        });
        const { turn } = session.sendPrompt("stop this turn");
        await session.cancel();

        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 0, contextWindow: 200_000, updatedAt: 2 },
        });

        expect(session.getSessionUsage()).toEqual({
          usedTokens: 5000,
          contextWindow: 200_000,
          updatedAt: 1,
        });

        finishPrompt("cancelled");
        await expect(turn).resolves.toBe("cancelled");

        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 6000, contextWindow: 200_000, updatedAt: 3 },
        });
        expect(session.getSessionUsage()?.usedTokens).toBe(6000);
      });

      it("drops the held context window when the model changes, so the next snapshot applies (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", () => {
        const stateOn = (baseModelId: string): BackendState => ({
          model: {
            current: { baseModelId, effort: null },
            apply: { kind: "setModel" },
            availableModels: [],
          },
          mode: null,
        });
        const mock = makeMockBackend();
        const session = makeSession(mock);
        mock.emitUpdate({
          sessionUpdate: "state_changed",
          state: stateOn("copilot-plus/gemini-3-pro"),
        });
        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 5000, contextWindow: 1_048_576, updatedAt: 1 },
        });

        mock.emitUpdate({ sessionUpdate: "state_changed", state: stateOn("ollama/llama") });

        expect(session.getSessionUsage()).toEqual({ usedTokens: 5000, updatedAt: 1 });

        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 800, updatedAt: 2 },
        });
        expect(session.getSessionUsage()).toEqual({ usedTokens: 800, updatedAt: 2 });
      });
    });

    describe("getPlanUsage()", () => {
      it("starts null and stores an incoming plan_usage_update, notifying subscribers", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const onMessagesChanged = jest.fn();
        subscribeTo(session, { onMessagesChanged });
        expect(session.getPlanUsage()).toBeNull();
        const planUsage = {
          windows: [{ id: "five_hour", label: "5h", percent: 40 }],
          updatedAt: 1,
        };

        mock.emitUpdate({ sessionUpdate: "plan_usage_update", planUsage });

        expect(session.getPlanUsage()).toBe(planUsage);
        expect(onMessagesChanged).toHaveBeenCalled();
      });
    });

    describe("seedSessionUsage()", () => {
      it("seeds usage from persisted history and re-notifies", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const onMessagesChanged = jest.fn();
        subscribeTo(session, { onMessagesChanged });

        session.seedSessionUsage({ usedTokens: 1234, contextWindow: 200_000, updatedAt: 9 });
        expect(session.getSessionUsage()).toEqual({
          usedTokens: 1234,
          contextWindow: 200_000,
          updatedAt: 9,
        });
        expect(onMessagesChanged).toHaveBeenCalled();

        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 2000, contextWindow: 200_000, updatedAt: 10 },
        });
        expect(session.getSessionUsage()?.usedTokens).toBe(2000);
      });
    });

    describe("setLabel()", () => {
      it("trims the label, clears it for blank input, and notifies only when the label changes", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const onLabelChanged = jest.fn();
        subscribeTo(session, { onLabelChanged });

        session.setLabel("  My session  ");
        expect(session.getLabel()).toBe("My session");
        expect(onLabelChanged).toHaveBeenCalledTimes(1);

        session.setLabel("   ");
        expect(session.getLabel()).toBeNull();
        expect(onLabelChanged).toHaveBeenCalledTimes(2);

        session.setLabel(null);
        expect(onLabelChanged).toHaveBeenCalledTimes(2);
      });
    });

    describe("restoreLabel()", () => {
      it("an agent-sourced restored title can still be refreshed by later agent updates", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        session.restoreLabel("Discovered title", "agent");
        expect(session.getLabel()).toBe("Discovered title");

        mock.emitUpdate({ sessionUpdate: "session_info_update", title: "Newer agent title" });
        expect(session.getLabel()).toBe("Newer agent title");
      });

      it("a user-sourced restored title is sticky against later agent updates", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        session.restoreLabel("My rename", "user");

        mock.emitUpdate({ sessionUpdate: "session_info_update", title: "Agent title" });
        expect(session.getLabel()).toBe("My rename");
      });
    });

    describe("getLabel()", () => {
      async function flushMicrotasks(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }

      describe("when the agent pushes a session title", () => {
        it("adopts the title pushed by the agent and notifies listeners", () => {
          const mock = makeMockBackend();
          const session = makeSession(mock);
          const onLabelChanged = jest.fn();
          subscribeTo(session, { onLabelChanged });

          mock.emitUpdate({ sessionUpdate: "session_info_update", title: "Refactor auth" });

          expect(session.getLabel()).toBe("Refactor auth");
          expect(onLabelChanged).toHaveBeenCalledTimes(1);
        });

        it("ignores agent-pushed titles after the user has renamed the session", () => {
          const mock = makeMockBackend();
          const session = makeSession(mock);
          session.setLabel("My label");

          mock.emitUpdate({ sessionUpdate: "session_info_update", title: "Agent-chosen title" });

          expect(session.getLabel()).toBe("My label");
        });

        it("a null/empty agent title clears the label and re-opens it for future agent updates", () => {
          const mock = makeMockBackend();
          const session = makeSession(mock);
          mock.emitUpdate({ sessionUpdate: "session_info_update", title: "First" });
          expect(session.getLabel()).toBe("First");

          mock.emitUpdate({ sessionUpdate: "session_info_update", title: null });
          expect(session.getLabel()).toBeNull();

          mock.emitUpdate({ sessionUpdate: "session_info_update", title: "Second" });
          expect(session.getLabel()).toBe("Second");
        });

        it("keeps the agent title when an update omits the title, such as an opencode compaction marker (https://github.com/Brevilabs/obsidian-copilot-private/issues/632)", () => {
          const mock = makeMockBackend();
          const session = makeSession(mock);
          const onLabelChanged = jest.fn();
          mock.emitUpdate({ sessionUpdate: "session_info_update", title: "Autumn leaves" });
          subscribeTo(session, { onLabelChanged });

          mock.emitUpdate({ sessionUpdate: "session_info_update" });

          expect(session.getLabel()).toBe("Autumn leaves");
          expect(onLabelChanged).not.toHaveBeenCalled();
        });
      });

      describe("when the agent is polled for a title after a turn", () => {
        it("pulls the title via listSessions and applies it after end_turn", async () => {
          const mock = makeMockBackend();
          mock.listSessions.mockResolvedValueOnce({
            sessions: [
              { sessionId: "acp-1", cwd: "/vault", title: "Refactor auth", updatedAt: null },
              {
                sessionId: "acp-other",
                cwd: "/vault",
                title: "Different session",
                updatedAt: null,
              },
            ],
          });
          const session = makeSession(mock, { cwd: "/vault" });
          const { turn } = session.sendPrompt("hi");
          await turn;
          await flushMicrotasks();

          expect(mock.listSessions).toHaveBeenCalledWith({ cwd: "/vault" });
          expect(session.getLabel()).toBe("Refactor auth");
        });

        it("ignores opencode's default 'New session - …' placeholder titles", async () => {
          const mock = makeMockBackend();
          mock.listSessions.mockResolvedValueOnce({
            sessions: [
              {
                sessionId: "acp-1",
                cwd: "/vault",
                title: "New session - 2026-04-26T01:24:54.221Z",
                updatedAt: null,
              },
            ],
          });
          const session = makeSession(mock, { cwd: "/vault" });
          await session.sendPrompt("hi").turn;
          await flushMicrotasks();
          expect(session.getLabel()).toBeNull();
        });

        it("does not poll when the user has already renamed the session", async () => {
          const mock = makeMockBackend();
          const session = makeSession(mock, { cwd: "/vault" });
          session.setLabel("My label");
          await session.sendPrompt("hi").turn;
          await flushMicrotasks();
          expect(mock.listSessions).not.toHaveBeenCalled();
          expect(session.getLabel()).toBe("My label");
        });

        it("does not poll on cancelled turns", async () => {
          const mock = makeMockBackend();
          mock.prompt.mockResolvedValueOnce({ stopReason: "cancelled" });
          const session = makeSession(mock, { cwd: "/vault" });
          await session.sendPrompt("hi").turn;
          await flushMicrotasks();
          expect(mock.listSessions).not.toHaveBeenCalled();
        });

        it("silently no-ops when the agent doesn't support listSessions", async () => {
          const mock = makeMockBackend();
          mock.listSessions.mockRejectedValueOnce(new MethodUnsupportedError("session/list"));
          const session = makeSession(mock, { cwd: "/vault" });
          await session.sendPrompt("hi").turn;
          await flushMicrotasks();
          expect(session.getLabel()).toBeNull();
        });

        it("omits cwd filter when the session has no cwd recorded", async () => {
          const mock = makeMockBackend();
          mock.listSessions.mockResolvedValueOnce({
            sessions: [{ sessionId: "acp-1", cwd: "/vault", title: "Found me", updatedAt: null }],
          });
          const session = makeSession(mock);
          await session.sendPrompt("hi").turn;
          await flushMicrotasks();
          expect(mock.listSessions).toHaveBeenCalledWith({});
          expect(session.getLabel()).toBe("Found me");
        });
      });

      describe("when the backend does not summarize titles", () => {
        function makeTitleSession(backendId: "codex" | "claude" | "opencode", summarizes: boolean) {
          return makeSession(makeMockBackend(), {
            backendId,
            getDescriptor: summarizes ? summarizingDescriptor : nonSummarizingDescriptor,
          });
        }

        it("derives the tab label from the first user message for codex", () => {
          const session = makeTitleSession("codex", false);
          session.sendPrompt("Summarize my meeting notes");
          expect(session.getLabel()).toBe("Summarize my meeting notes");
          expect(session.getLabelSource()).toBe("agent");
        });

        it("strips wikilink brackets when deriving the title", () => {
          const session = makeTitleSession("codex", false);
          session.sendPrompt("Review [[Project Plan]] please");
          expect(session.getLabel()).toBe("Review Project Plan please");
        });

        it("keeps the first message's derived title across later turns", async () => {
          const session = makeTitleSession("codex", false);
          await session.sendPrompt("First prompt").turn;
          expect(session.getLabel()).toBe("First prompt");
          await session.sendPrompt("A different second prompt").turn;
          expect(session.getLabel()).toBe("First prompt");
        });

        it("does not override a user rename with a derived title", () => {
          const session = makeTitleSession("codex", false);
          session.setLabel("My rename");
          session.sendPrompt("Some prompt that would otherwise become the title");
          expect(session.getLabel()).toBe("My rename");
          expect(session.getLabelSource()).toBe("user");
        });

        it("does not derive a label for a summarizing backend (opencode)", () => {
          const session = makeTitleSession("opencode", true);
          session.sendPrompt("This should not become the tab title");
          expect(session.getLabel()).toBeNull();
        });

        it("ignores a backend-pushed session_info_update title for non-summarizing backends", () => {
          const mock = makeMockBackend();
          const session = makeSession(mock, {
            backendId: "codex",
            getDescriptor: nonSummarizingDescriptor,
          });
          session.sendPrompt("Original user prompt");
          mock.emitUpdate({
            sessionUpdate: "session_info_update",
            title: "<copilot-context> leaked title",
          });
          expect(session.getLabel()).toBe("Original user prompt");
        });

        it("does not poll listSessions after a turn for non-summarizing backends", async () => {
          const mock = makeMockBackend();
          const session = makeSession(mock, {
            backendId: "codex",
            cwd: "/vault",
            getDescriptor: nonSummarizingDescriptor,
          });
          await session.sendPrompt("hello").turn;
          await flushMicrotasks();
          expect(mock.listSessions).not.toHaveBeenCalled();
        });
      });
    });

    describe("getNeedsAttention()", () => {
      it("notifies once per real change when marked and cleared, ignoring repeated calls", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        const onNeedsAttentionChanged = jest.fn();
        subscribeTo(session, { onNeedsAttentionChanged });

        expect(session.getNeedsAttention()).toBe(false);

        session.markNeedsAttention();
        expect(session.getNeedsAttention()).toBe(true);
        expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(1);
        expect(onNeedsAttentionChanged).toHaveBeenLastCalledWith(true);

        session.markNeedsAttention();
        expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(1);

        session.clearNeedsAttention();
        expect(session.getNeedsAttention()).toBe(false);
        expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(2);
        expect(onNeedsAttentionChanged).toHaveBeenLastCalledWith(false);

        session.clearNeedsAttention();
        expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(2);
      });
    });

    describe("getStatus()", () => {
      it("reports 'error' after a failed turn and resets to 'running' on the next sendPrompt", async () => {
        const mock = makeMockBackend();
        mock.prompt.mockRejectedValueOnce(new Error("boom"));
        const session = makeSession(mock);

        await expect(session.sendPrompt("hi").turn).rejects.toThrow("boom");
        expect(session.getStatus()).toBe("error");

        const { turn } = session.sendPrompt("retry");
        expect(session.getStatus()).toBe("running");
        await turn;
        expect(session.getStatus()).toBe("idle");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 stays idle while only a background task's permission request waits, so the chat can still send", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });

        void session.handleToolPermission({
          ...writePermissionRequest(),
          requester: { taskId: "task-1" },
        });

        expect(session.getStatus()).toBe("idle");
        expect(session.getPendingToolPermissions()).toHaveLength(1);
        expect(await session.sendPrompt("meanwhile").turn).toBe("end_turn");
      });
    });

    describe("subscribe()", () => {
      it("fires onStatusChanged exactly once per distinct transition through the permission lifecycle", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const statusChanges: string[] = [];
        subscribeTo(session, { onStatusChanged: (status) => statusChanges.push(status) });

        const { turn } = session.sendPrompt("edit a file");
        const decisionPromise = session.handleToolPermission(writePermissionRequest());
        session.resolveToolPermission("tc-write", "allow_once");
        await decisionPromise;
        finishPrompt();
        await turn;

        expect(statusChanges).toEqual(["running", "awaiting_permission", "running", "idle"]);
      });

      describe("streamed-token notifications", () => {
        let rafQueue: FrameRequestCallback[];

        let originalRaf: typeof window.requestAnimationFrame;

        let originalCancelRaf: typeof window.cancelAnimationFrame;

        const flushFrame = () => {
          const pending = rafQueue;
          rafQueue = [];
          for (const cb of pending) cb(performance.now());
        };

        beforeEach(() => {
          rafQueue = [];
          originalRaf = window.requestAnimationFrame;
          originalCancelRaf = window.cancelAnimationFrame;
          window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            rafQueue.push(cb);
            return rafQueue.length;
          };
          window.cancelAnimationFrame = (handle: number): void => {
            const idx = handle - 1;
            if (idx >= 0 && idx < rafQueue.length) rafQueue.splice(idx, 1);
          };
        });

        afterEach(() => {
          window.requestAnimationFrame = originalRaf;
          window.cancelAnimationFrame = originalCancelRaf;
        });

        const streamChunk = (mock: MockBackend, text: string) =>
          mock.emitUpdate({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          });

        it("collapses a burst of streamed chunks into one notification per frame", async () => {
          const mock = makeMockBackend();
          const finishPrompt = holdPrompt(mock);
          const session = makeSession(mock);

          const onMessagesChanged = jest.fn();
          subscribeTo(session, { onMessagesChanged });

          const { turn } = session.sendPrompt("hi");
          expect(onMessagesChanged).toHaveBeenCalledTimes(1);

          onMessagesChanged.mockClear();
          streamChunk(mock, "Hel");
          streamChunk(mock, "lo");
          streamChunk(mock, ", world");
          expect(onMessagesChanged).not.toHaveBeenCalled();
          expect(aiMessage(session)?.message).toBe("Hello, world");

          flushFrame();
          expect(onMessagesChanged).toHaveBeenCalledTimes(1);

          finishPrompt();
          await turn;
          flushFrame();
        });

        it("always delivers the trailing turn-complete notification (no dropped final state)", async () => {
          const mock = makeMockBackend();
          const finishPrompt = holdPrompt(mock);
          const session = makeSession(mock);

          const onMessagesChanged = jest.fn();
          subscribeTo(session, { onMessagesChanged });

          const { turn } = session.sendPrompt("hi");
          onMessagesChanged.mockClear();

          streamChunk(mock, "partial");
          expect(rafQueue).toHaveLength(1);
          expect(onMessagesChanged).not.toHaveBeenCalled();

          finishPrompt();
          await turn;

          expect(onMessagesChanged).toHaveBeenCalled();
          expect(rafQueue).toHaveLength(0);

          const placeholder = aiMessage(session);
          expect(placeholder?.message).toBe("partial");
          expect(placeholder?.turnStopReason).toBe("end_turn");
        });
      });
    });

    describe("getCurrentPlan()", () => {
      it("does not promote completed plan-file writes into proposal cards", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, {
          backendId: "claude",
          initialState: {
            model: null,
            mode: {
              current: "plan",
              options: [{ value: "plan", label: "Plan" }],
              apply: { plan: { kind: "setMode", nativeId: "plan" } },
            },
          },
          getDescriptor: () =>
            ({
              isPlanModePlanFilePath: (absolutePath: string) =>
                absolutePath === "/Users/test/.claude/plans/plan.md",
            }) as unknown as BackendDescriptor,
        });
        const { turn } = session.sendPrompt("plan something");

        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-plan-write",
          title: "Write",
          kind: "edit",
          status: "completed",
          rawInput: {
            file_path: "/Users/test/.claude/plans/plan.md",
            content: "# proposed plan body",
          },
        });

        expect(session.getCurrentPlan()).toBeNull();

        finishPrompt();
        await turn;
      });
    });

    describe("finalizePlanDecision()", () => {
      it("keeps an approved decision visible without resurrecting the plan card after a late tool update (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("plan something");

        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc-plan-1",
          title: "ExitPlanMode",
          kind: "other",
          status: "pending",
          rawInput: { plan: "# proposed plan body" },
          vendorToolName: "ExitPlanMode",
          isPlanProposal: true,
        });
        const initialPlan = session.getCurrentPlan();
        expect(initialPlan).not.toBeNull();
        expect(initialPlan?.decision).toBe("pending");
        expect(initialPlan?.pendingToolCallId).toBe("tc-plan-1");

        expect(session.finalizePlanDecision(initialPlan!.id, "approve")).toBe(true);
        expect(session.getCurrentPlan()).toBeNull();

        mock.emitUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-plan-1",
          status: "completed",
          rawInput: { plan: "# proposed plan body" },
          vendorToolName: "ExitPlanMode",
          isPlanProposal: true,
        });
        expect(session.getCurrentPlan()).toBeNull();
        const decidedPart = session.store
          .getDisplayMessages()
          .flatMap((message) => message.parts ?? [])
          .find((part) => part.kind === "tool_call" && part.id === "tc-plan-1");
        expect(decidedPart?.kind === "tool_call" && decidedPart.userResponse).toBe("Approved plan");

        finishPrompt();
        await turn;
      });
    });

    describe("handleToolPermission()", () => {
      it("marks an active turn as awaiting permission while an inline tool card is pending", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("edit a file");
        expect(session.getStatus()).toBe("running");

        const decisionPromise = session.handleToolPermission(writePermissionRequest());

        expect(session.getStatus()).toBe("awaiting_permission");
        expect(session.getPendingToolPermissions()).toHaveLength(1);

        session.resolveToolPermission("tc-write", "allow_once");
        await expect(decisionPromise).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "allow_once" },
        });
        expect(session.getPendingToolPermissions()).toHaveLength(0);
        expect(session.getStatus()).toBe("running");

        finishPrompt();
        await turn;
      });
    });

    describe("handleAskUserQuestion()", () => {
      it("surfaces a pending AskUserQuestion and resolves it with the submitted answers", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const statusChanges: string[] = [];
        subscribeTo(session, { onStatusChanged: (status) => statusChanges.push(status) });
        const { turn } = session.sendPrompt("ask me something");
        expect(session.getStatus()).toBe("running");

        const answersPromise = session.handleAskUserQuestion({
          sessionId: "acp-1",
          requestId: "tc-ask",
          questions: [
            { question: "Pick a fruit", options: [{ label: "Apple" }, { label: "Pear" }] },
          ],
        });

        expect(session.getStatus()).toBe("awaiting_permission");
        expect(session.getPendingAskUserQuestions()).toHaveLength(1);
        expect(statusChanges).toContain("awaiting_permission");

        session.resolveAskUserQuestion("tc-ask", { "Pick a fruit": "Pear" });
        await expect(answersPromise).resolves.toEqual({ "Pick a fruit": "Pear" });
        expect(session.getPendingAskUserQuestions()).toHaveLength(0);
        expect(session.getStatus()).toBe("running");

        finishPrompt();
        await turn;
      });
    });

    describe("getReportEvidence()", () => {
      it("describes the chat for a bug report by backend, current model, backend session and time", () => {
        const session = makeSession(makeMockBackend(), {
          backendId: "codex",
          initialState: sonnetAndGpt5State(),
        });

        expect(session.getReportEvidence()).toEqual({
          backendId: "codex",
          model: "anthropic/sonnet",
          sessionId: "acp-1",
          raisedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        });
      });
    });

    describe("getFeedbackOffer()", () => {
      it("starts with no feedback card", () => {
        expect(makeSession(makeMockBackend()).getFeedbackOffer()).toBeNull();
      });
    });

    describe("offerFeedback()", () => {
      const DRAFT = {
        title: "Replied in Swedish to an English request",
        whatHappened: "The agent answered 'hej'.",
        userSaid: "Why do you switch to a different language?",
        repro: "1. Ask in English.",
      };

      const sessionWithTranscript = () => {
        const session = makeSession(makeMockBackend(), {
          backendId: "codex",
          initialState: sonnetAndGpt5State(),
        });
        session.loadDisplayMessages([
          { id: "u1", sender: USER_SENDER, message: "hej", isVisible: true, timestamp: null },
          { id: "a1", sender: AI_SENDER, message: "hej", isVisible: true, timestamp: null },
          { id: "u2", sender: USER_SENDER, message: "why?", isVisible: true, timestamp: null },
        ]);
        return session;
      };

      it("opens a card with the draft, session evidence and the latest user message as its anchor", () => {
        const session = sessionWithTranscript();
        const onMessagesChanged = jest.fn();
        subscribeTo(session, { onMessagesChanged });

        expect(session.offerFeedback(DRAFT)).toBe("shown");

        expect(onMessagesChanged).toHaveBeenCalled();
        expect(session.getFeedbackOffer()).toEqual({
          draft: DRAFT,
          evidence: {
            backendId: "codex",
            model: "anthropic/sonnet",
            sessionId: "acp-1",
            raisedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          },
          afterUserMessageId: "u2",
          status: "open",
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 refuses a second card in the same session whether the first is open, dismissed or sent", () => {
        const session = sessionWithTranscript();
        session.offerFeedback(DRAFT);
        const first = session.getFeedbackOffer();

        expect(session.offerFeedback({ ...DRAFT, title: "Another problem" })).toBe(
          "already_offered"
        );
        session.dismissFeedbackOffer();
        expect(session.offerFeedback(DRAFT)).toBe("already_offered");
        expect(session.getFeedbackOffer()?.draft).toBe(first?.draft);
      });

      it("anchors to nothing when the session has no user message yet", () => {
        const session = makeSession(makeMockBackend());
        session.offerFeedback(DRAFT);
        expect(session.getFeedbackOffer()?.afterUserMessageId).toBeNull();
      });
    });

    describe("dismissFeedbackOffer()", () => {
      const DRAFT = { title: "t", whatHappened: "w", userSaid: "", repro: "r" };

      it("marks an open card dismissed and notifies, without any other effect", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        session.offerFeedback(DRAFT);
        const onMessagesChanged = jest.fn();
        subscribeTo(session, { onMessagesChanged });

        session.dismissFeedbackOffer();

        expect(session.getFeedbackOffer()?.status).toBe("dismissed");
        expect(onMessagesChanged).toHaveBeenCalledTimes(1);
        expect(mock.prompt).not.toHaveBeenCalled();
      });

      it("leaves a sent card and a missing card unchanged", () => {
        const session = makeSession(makeMockBackend());
        session.dismissFeedbackOffer();
        expect(session.getFeedbackOffer()).toBeNull();

        session.offerFeedback(DRAFT);
        session.markFeedbackReported({ reportId: "r1", issueUrl: "https://example.com" });
        session.dismissFeedbackOffer();
        expect(session.getFeedbackOffer()?.status).toBe("reported");
      });
    });

    describe("markFeedbackReported()", () => {
      it("records the report ID and issue link on the card", () => {
        const session = makeSession(makeMockBackend());
        session.offerFeedback({ title: "t", whatHappened: "w", userSaid: "", repro: "r" });

        session.markFeedbackReported({ reportId: "r1", issueUrl: "https://example.com" });

        expect(session.getFeedbackOffer()).toMatchObject({
          status: "reported",
          report: { reportId: "r1", issueUrl: "https://example.com" },
        });
      });

      it("ignores a report when no card was offered", () => {
        const session = makeSession(makeMockBackend());
        session.markFeedbackReported({ reportId: "r1", issueUrl: "https://example.com" });
        expect(session.getFeedbackOffer()).toBeNull();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 keeps a dismissed card dismissed when its upload lands afterwards", () => {
        const session = makeSession(makeMockBackend());
        session.offerFeedback({ title: "t", whatHappened: "w", userSaid: "", repro: "r" });
        session.dismissFeedbackOffer();

        session.markFeedbackReported({ reportId: "r1", issueUrl: "https://example.com" });

        expect(session.getFeedbackOffer()).toMatchObject({ status: "dismissed" });
        expect(session.getFeedbackOffer()?.report).toBeUndefined();
      });
    });

    describe("getTasks()", () => {
      function launchTurn(mock: MockBackend, session: AgentSession) {
        let promptId = "";
        mock.asBackend.prompt = async (input) => {
          promptId = input.promptId;
        };
        const { turn } = session.sendPrompt("count the words in a background subagent");
        return {
          turn,
          run: (...updates: SessionEvent["update"][]) => {
            mock.emitUpdate({ sessionUpdate: "message_delivered", promptId });
            mock.emitUpdate({ sessionUpdate: "turn_started", turnId: "launch" });
            for (const update of updates) mock.emitUpdate(update);
          },
        };
      }

      const AGENT_CARD: SessionEvent["update"] = {
        sessionUpdate: "tool_call",
        toolCallId: "tool-agent",
        title: "Agent",
        kind: "other",
        status: "in_progress",
        vendorToolName: "Agent",
      };

      const TASK_STARTED: SessionEvent["update"] = {
        sessionUpdate: "task_started",
        taskId: "task-1",
        toolCallId: "tool-agent",
        kind: "subagent",
        description: "Count words",
        prompt: "Count the words in every note",
      };

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 tracks a task from start to end while its launching card stays running past its turn and then shows the task's report", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });
        const onTasksChanged = jest.fn();
        subscribeTo(session, { onTasksChanged });
        const { turn, run } = launchTurn(mock, session);
        run(AGENT_CARD, TASK_STARTED, replayText("agent_message_chunk", "Launched."));
        mock.emitUpdate({ sessionUpdate: "turn_ended", turnId: "launch", stopReason: "end_turn" });
        await turn;
        await waitFor(() => expect(aiMessage(session)?.turnStopReason).toBe("end_turn"));
        const card = () => aiMessage(session)?.parts?.find((p) => p.kind === "tool_call");
        expect(card()).toMatchObject({ status: "in_progress" });
        expect(session.getTasks()).toEqual([
          expect.objectContaining({ taskId: "task-1", kind: "subagent", status: "running" }),
        ]);

        mock.emitUpdate({
          sessionUpdate: "task_progress",
          taskId: "task-1",
          progress: { toolName: "Bash", toolUses: 1 },
        });
        mock.emitUpdate({
          sessionUpdate: "task_ended",
          taskId: "task-1",
          status: "completed",
          summary: "13 words in total.",
        });

        expect(session.getTasks()).toEqual([
          expect.objectContaining({
            status: "completed",
            summary: "13 words in total.",
            progress: { toolName: "Bash", toolUses: 1 },
          }),
        ]);
        expect(card()).toMatchObject({
          status: "completed",
          progress: { toolName: "Bash", toolUses: 1 },
          output: [{ type: "text", text: "13 words in total." }],
        });
        expect(onTasksChanged).toHaveBeenCalledTimes(3);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 keeps a stopped task's exact status while its card shows it failed", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });
        const { turn, run } = launchTurn(mock, session);
        run(AGENT_CARD, TASK_STARTED);
        mock.emitUpdate({ sessionUpdate: "turn_ended", turnId: "launch", stopReason: "end_turn" });
        await turn;

        mock.emitUpdate({ sessionUpdate: "task_ended", taskId: "task-1", status: "stopped" });

        expect(session.getTasks()[0].status).toBe("stopped");
        expect(aiMessage(session)?.parts?.find((p) => p.kind === "tool_call")).toMatchObject({
          status: "failed",
        });
      });

      it("returns one stable empty list before any task starts", () => {
        const session = makeSession(makeMockBackend());

        expect(session.getTasks()).toBe(session.getTasks());
        expect(session.getTasks()).toEqual([]);
      });
    });

    describe("getTaskMessages()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 keeps a subagent's text and tool calls in its own messages, never in the reply that is running when they arrive", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        mock.emitUpdate({
          sessionUpdate: "task_started",
          taskId: "task-1",
          toolCallId: "tool-agent",
          kind: "subagent",
          description: "Count words",
        });
        const { turn } = session.sendPrompt("unrelated question");
        const fromTask = (update: SessionEvent["update"]) =>
          mock.emit({ sessionId: "acp-1", update, taskToolCallId: "tool-agent" });

        fromTask({
          sessionUpdate: "tool_call",
          toolCallId: "tool-bash",
          title: "wc -w",
          kind: "execute",
          status: "in_progress",
        });
        fromTask({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-bash",
          status: "completed",
        });
        fromTask(replayText("agent_message_chunk", "13 words."));
        mock.emitUpdate(replayText("agent_message_chunk", "The answer."));
        finishPrompt();
        await turn;

        expect(aiMessage(session)?.message).toBe("The answer.");
        expect(aiMessage(session)?.parts?.some((p) => p.kind === "tool_call")).toBe(false);
        expect(session.getTaskMessages("task-1")).toEqual([
          expect.objectContaining({
            sender: AI_SENDER,
            message: "13 words.",
            parts: expect.arrayContaining([
              expect.objectContaining({ kind: "tool_call", id: "tool-bash", status: "completed" }),
            ]),
          }),
        ]);
        expect(session.getTaskMessages("unknown")).toEqual([]);
      });
    });

    describe("getCurrentTodoList()", () => {
      const planUpdate = (entries: { content: string; status: string; priority?: string }[]) => ({
        sessionId: "acp-1",
        update: { sessionUpdate: "plan", entries } as never,
      });

      const makeLiveSession = (mock: MockBackend): AgentSession => {
        const session = makeSession(mock);
        session.loadDisplayMessages([]);
        return session;
      };

      it("starts null, snapshots plan entries, and notifies the dedicated channel", () => {
        const mock = makeMockBackend();
        const session = makeLiveSession(mock);
        expect(session.getCurrentTodoList()).toBeNull();

        let notified = 0;
        subscribeTo(session, { onCurrentTodoListChanged: () => notified++ });
        mock.emit(
          planUpdate([
            { content: "step A", status: "in_progress", priority: "medium" },
            { content: "step B", status: "pending", priority: "medium" },
          ])
        );
        expect(notified).toBe(1);
        expect(session.getCurrentTodoList()).toEqual([
          { content: "step A", status: "in_progress" },
          { content: "step B", status: "pending" },
        ]);
      });
    });
  });
});
