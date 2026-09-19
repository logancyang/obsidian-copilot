import { resolveEffort } from "@/lib/model-effort";
import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { waitFor } from "@testing-library/react";
import { FileSystemAdapter, type App, type TFile } from "obsidian";
import {
  AgentSession,
  buildPromptBlocks,
  buildUserDisplayContent,
  tryReadExitPlanModeCall,
  withReadOnlyPreamble,
  type AgentSessionListener,
  type AgentSessionStartOptions,
  type AgentSessionStateOptions,
} from "./AgentSession";
import { ensureMultiAgentEntitlement, showMultiAgentUpgradePrompt } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { ContextProcessor } from "@/contextProcessor";
import { GLOBAL_SCOPE } from "./scope";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { AuthRequiredError, MethodUnsupportedError } from "./errors";
import type { FanoutRunInput } from "./fanout/FanoutOrchestrator";
import { FANOUT_READONLY_PREAMBLE, type FanoutTurn } from "./fanout/fanoutTypes";
import type {
  AgentToolCallOutput,
  BackendDescriptor,
  BackendProcess,
  BackendState,
  CopilotMode,
  EnabledModelEntry,
  PermissionOption,
  PermissionPrompt,
  SessionEvent,
  SessionUpdateHandler,
  StopReason,
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
  emitUpdate: (update: SessionEvent["update"]) => void;
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
  const prompt = jest.fn(async () => ({ stopReason: "end_turn" as const }));
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
    prompt: prompt,
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
    emitUpdate: (update) => handler?.({ sessionId: "acp-1", update }),
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

const ALLOW_OR_REJECT_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
];

function writePermissionRequest(): PermissionPrompt {
  return {
    sessionId: "acp-1",
    toolCall: {
      toolCallId: "tc-write",
      kind: "edit",
      status: "pending",
      title: "Write",
      rawInput: { file_path: "note.md", content: "updated" },
    },
    options: ALLOW_OR_REJECT_OPTIONS,
  };
}

function planPermissionRequest(
  toolCallId: string,
  rawInput: Record<string, unknown>
): PermissionPrompt {
  return {
    sessionId: "acp-1",
    toolCall: {
      toolCallId,
      kind: "switch_mode",
      status: "pending",
      title: "ExitPlanMode",
      rawInput,
      vendorToolName: "ExitPlanMode",
      isPlanProposal: true,
    },
    options: ALLOW_OR_REJECT_OPTIONS,
  };
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

      it("creates the backend session in the global scope with no extra roots when started with defaults", async () => {
        const mock = makeMockBackend();
        const session = startSession(mock);
        await session.ready;
        expect(mock.newSession).toHaveBeenCalledWith({
          cwd: "/vault",
          projectId: GLOBAL_SCOPE,
          additionalDirectories: [],
        });
      });

      it("passes the session's projectId into the newSession payload", async () => {
        const mock = makeMockBackend();
        const session = startSession(mock, { cwd: "/vault/Projects/p", projectId: "proj-7" });
        await session.ready;
        expect(mock.newSession).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: "/vault/Projects/p", projectId: "proj-7" })
        );
      });

      it("does not call newSession until contextReady resolves (non-blocking visibility)", async () => {
        const mock = makeMockBackend();
        let release!: (result: { additionalDirectories: string[] }) => void;
        const contextReady = new Promise<{ additionalDirectories: string[] }>((resolve) => {
          release = resolve;
        });
        const session = startSession(mock, {
          cwd: "/vault/Projects/p",
          projectId: "proj-7",
          contextReady,
        });
        await Promise.resolve();
        expect(mock.newSession).not.toHaveBeenCalled();
        expect(session.getStatus()).toBe("starting");
        release({ additionalDirectories: ["/vault/SharedResearch"] });
        await session.ready;
        expect(mock.newSession).toHaveBeenCalledWith(
          expect.objectContaining({ additionalDirectories: ["/vault/SharedResearch"] })
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

      it("renders a visible error (not an empty bubble) when the backend reports auth required", async () => {
        const mock = makeMockBackend();
        mock.prompt.mockRejectedValueOnce(new AuthRequiredError("You're not signed in to Claude."));
        const session = makeSession(mock, { backendId: "claude" });

        await expect(session.sendPrompt("hi").turn).rejects.toBeInstanceOf(AuthRequiredError);

        const placeholder = aiMessage(session);
        expect(placeholder?.isErrorMessage).toBe(true);
        expect(placeholder?.message).toContain("not signed in to Claude");
        expect(session.getStatus()).toBe("error");
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

      it("injects the <project_context> block into the first user prompt only", async () => {
        const mock = makeMockBackend();
        const session = startSession(mock, {
          cwd: "/vault/Projects/p",
          projectId: "proj-7",
          contextReady: Promise.resolve({
            additionalDirectories: [],
            projectContextBlock:
              "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>",
          }),
        });
        await session.ready;

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
      });

      it("re-injects the <project_context> block on retry when the first prompt fails", async () => {
        const mock = makeMockBackend();
        mock.prompt.mockRejectedValueOnce(new Error("transport down"));
        const session = startSession(mock, {
          cwd: "/vault/Projects/p",
          projectId: "proj-7",
          contextReady: Promise.resolve({
            additionalDirectories: [],
            projectContextBlock:
              "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>",
          }),
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
          (session as unknown as { projectContextBlock: string | null }).projectContextBlock =
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
    });

    describe("cancel()", () => {
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

      it("settles locally and drops retry output when backend cancellation fails", async () => {
        const mock = makeMockBackend();
        let resolveBackingPrompt: ((value: { stopReason: "cancelled" }) => void) | null = null;
        let resolveSecondPrompt: ((value: { stopReason: "end_turn" }) => void) | null = null;
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

        jest.useFakeTimers();
        try {
          resolveBackingPrompt!({ stopReason: "cancelled" });
          await jest.advanceTimersByTimeAsync(500);
          emitChunk("agent_message_chunk", " delayed stale retry", "msg-retry");
          await jest.advanceTimersByTimeAsync(500);
          expect(mock.prompt).toHaveBeenCalledTimes(1);

          await jest.advanceTimersByTimeAsync(1_000);
          expect(mock.prompt).toHaveBeenCalledTimes(2);
          emitChunk("agent_message_chunk", " stale trailing chunk", "msg-retry");
          emitChunk("agent_message_chunk", "recovered", "msg-second");
          resolveSecondPrompt!({ stopReason: "end_turn" });
          await expect(next.turn).resolves.toBe("end_turn");
          expect(session.store.getDisplayMessages().at(-1)?.message).toBe("recovered");
        } finally {
          jest.useRealTimers();
        }
      });

      it("routes a prior turn's tool update after the current turn is cancelled", async () => {
        jest.useFakeTimers();
        try {
          const mock = makeMockBackend();
          const resolvePrompts: Array<(value: { stopReason: "end_turn" | "cancelled" }) => void> =
            [];
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
          await jest.advanceTimersByTimeAsync(500);
        } finally {
          jest.useRealTimers();
        }
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

      it("lets a fuller snapshot's contextWindow replace an earlier one", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 },
        });
        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 6000, contextWindow: 1_000_000, updatedAt: 2 },
        });
        expect(session.getSessionUsage()?.contextWindow).toBe(1_000_000);
      });

      it("ignores a used-only fallback once an occupancy snapshot exists", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 },
        });
        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 6000, updatedAt: 2 },
        });
        expect(session.getSessionUsage()).toEqual({
          usedTokens: 5000,
          contextWindow: 200_000,
          updatedAt: 1,
        });
      });

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

      it("fills a seeded snapshot's missing window from the backend catalog (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
        const mock = makeMockBackend();
        const readContextWindow = jest.fn(async () => 1_048_576);
        (mock.asBackend as { readContextWindow?: unknown }).readContextWindow = readContextWindow;
        const session = makeSession(mock);
        mock.emitUpdate({
          sessionUpdate: "state_changed",
          state: {
            model: {
              current: { baseModelId: "copilot-plus/gemini-3-pro", effort: null },
              apply: { kind: "setModel" },
              availableModels: [],
            },
            mode: null,
          },
        });

        session.seedSessionUsage({ usedTokens: 27_514, updatedAt: 1 });
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(readContextWindow).toHaveBeenCalledWith("copilot-plus/gemini-3-pro");
        expect(session.getSessionUsage()).toEqual({
          usedTokens: 27_514,
          updatedAt: 1,
          contextWindow: 1_048_576,
        });
      });

      it("fills the window for a chat seeded into a still-starting session (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
        const mock = makeMockBackend();
        const readContextWindow = jest.fn(async () => 1_048_576);
        (mock.asBackend as { readContextWindow?: unknown }).readContextWindow = readContextWindow;
        mock.newSession.mockResolvedValueOnce({
          sessionId: "acp-1",
          state: {
            model: {
              current: { baseModelId: "copilot-plus/gemini-3-pro", effort: null },
              apply: { kind: "setModel" },
              availableModels: [],
            },
            mode: null,
          },
        });
        const session = startSession(mock);

        session.seedSessionUsage({ usedTokens: 27_514, updatedAt: 1 });
        await session.ready;
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(session.getSessionUsage()).toEqual({
          usedTokens: 27_514,
          updatedAt: 1,
          contextWindow: 1_048_576,
        });
      });

      it("leaves a live snapshot alone when the seed's window answer arrives late", async () => {
        let release!: (window: number) => void;
        const mock = makeMockBackend();
        (mock.asBackend as { readContextWindow?: unknown }).readContextWindow = jest.fn(
          () => new Promise((resolve) => (release = resolve))
        );
        const session = makeSession(mock);
        mock.emitUpdate({
          sessionUpdate: "state_changed",
          state: {
            model: {
              current: { baseModelId: "copilot-plus/gemini-3-pro", effort: null },
              apply: { kind: "setModel" },
              availableModels: [],
            },
            mode: null,
          },
        });
        session.seedSessionUsage({ usedTokens: 27_514, updatedAt: 1 });
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        mock.emitUpdate({
          sessionUpdate: "usage_update",
          usage: { usedTokens: 31_000, contextWindow: 200_000, updatedAt: 2 },
        });
        release(1_048_576);
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(session.getSessionUsage()).toEqual({
          usedTokens: 31_000,
          contextWindow: 200_000,
          updatedAt: 2,
        });
      });

      it("leaves usage untouched when the seed is undefined", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        session.seedSessionUsage(undefined);
        expect(session.getSessionUsage()).toBeNull();
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
      it("keeps the plan revision but tracks the new pending tool call when an identical plan body is proposed again", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("plan something");

        const planBody = "# proposed plan body";
        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc-plan-A",
          title: "ExitPlanMode",
          kind: "other",
          status: "pending",
          rawInput: { plan: planBody },
          vendorToolName: "ExitPlanMode",
          isPlanProposal: true,
        });
        const first = session.getCurrentPlan();
        expect(first?.pendingToolCallId).toBe("tc-plan-A");
        expect(first?.permissionGated).toBe(true);
        expect(first?.revision).toBe(1);

        mock.emitUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "tc-plan-B",
          title: "ExitPlanMode",
          kind: "other",
          status: "pending",
          rawInput: { plan: planBody },
          vendorToolName: "ExitPlanMode",
          isPlanProposal: true,
        });
        const second = session.getCurrentPlan();
        expect(second?.pendingToolCallId).toBe("tc-plan-B");
        expect(second?.permissionGated).toBe(true);
        expect(second?.revision).toBe(1);

        finishPrompt();
        await turn;
      });

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

    describe("handlePlanProposalPermission()", () => {
      it("publishes a gated plan from an ExitPlanMode permission request", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });

        const decisionPromise = session.handlePlanProposalPermission(
          planPermissionRequest("tc-plan-from-permission", {
            plan: "# permission plan body",
            planFilePath: "/Users/test/.claude/plans/plan.md",
          })
        );

        const plan = session.getCurrentPlan();
        expect(plan?.body).toBe("# permission plan body");
        expect(plan?.permissionGated).toBe(true);
        expect(plan?.pendingToolCallId).toBe("tc-plan-from-permission");
        expect(plan?.sourceFilePath).toBe("/Users/test/.claude/plans/plan.md");

        session.resolvePlanProposalPermission("tc-plan-from-permission", false);
        await decisionPromise;
      });
    });

    describe("resolvePlanProposalPermission()", () => {
      it("resolves with a reject option and the deny message when the plan is denied with feedback", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("plan something");

        const decisionPromise = session.handlePlanProposalPermission(
          planPermissionRequest("tc-plan-deny-msg", { plan: "# x" })
        );

        session.resolvePlanProposalPermission("tc-plan-deny-msg", false, "please drop step 2");
        const decision = await decisionPromise;

        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
        expect(decision.denyMessage).toBe("please drop step 2");

        finishPrompt();
        await turn;
      });

      it("resolves with the allow option and no deny message when the plan is approved", async () => {
        const mock = makeMockBackend();
        const finishPrompt = holdPrompt(mock);
        const session = makeSession(mock, { backendId: "claude" });
        const { turn } = session.sendPrompt("plan something");

        const decisionPromise = session.handlePlanProposalPermission(
          planPermissionRequest("tc-plan-allow", { plan: "# x" })
        );

        session.resolvePlanProposalPermission("tc-plan-allow", true, "should be ignored");
        const decision = await decisionPromise;

        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
        expect(decision.denyMessage).toBeUndefined();

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

      it("withdraws an ACP question when its request signal aborts (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "codex" });
        const controller = new AbortController();
        const answers = session.handleAskUserQuestion({
          sessionId: "acp-1",
          requestId: "rpc-1",
          questions: [
            { question: "Approach", answerKey: "approach", options: [{ label: "Simple" }] },
          ],
          signal: controller.signal,
        });
        expect(session.getPendingAskUserQuestions()).toHaveLength(1);
        controller.abort();
        await expect(answers).resolves.toEqual({});
        expect(session.getPendingAskUserQuestions()).toHaveLength(0);
        session.resolveAskUserQuestion("rpc-1", { approach: "Simple" });
        expect(session.getPendingAskUserQuestions()).toHaveLength(0);
      });
    });

    describe("getPendingAskUserQuestions()", () => {
      it("returns the shared empty array when no AskUserQuestion is pending", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock, { backendId: "claude" });
        expect(session.getPendingAskUserQuestions()).toHaveLength(0);
        expect(session.getPendingAskUserQuestions()).toBe(session.getPendingAskUserQuestions());
      });
    });

    describe("getCurrentTodoList()", () => {
      const planUpdate = (entries: { content: string; status: string; priority?: string }[]) => ({
        sessionId: "acp-1",
        update: { sessionUpdate: "plan", entries } as never,
      });

      it("starts null, snapshots plan entries, and notifies the dedicated channel", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
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

      it("dedupes identical lists (synthesized + real plan channel) by content signature", () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        let notified = 0;
        subscribeTo(session, { onCurrentTodoListChanged: () => notified++ });
        const entries = [{ content: "same", status: "pending", priority: "high" }];
        mock.emit(planUpdate(entries));
        const snapshot = session.getCurrentTodoList();
        mock.emit(planUpdate([{ content: "same", status: "pending", priority: "low" }]));
        expect(notified).toBe(1);
        expect(session.getCurrentTodoList()).toBe(snapshot);
      });

      it("clears to null on an empty plan and on dispose", async () => {
        const mock = makeMockBackend();
        const session = makeSession(mock);
        mock.emit(planUpdate([{ content: "only", status: "pending" }]));
        expect(session.getCurrentTodoList()).not.toBeNull();

        mock.emit(planUpdate([]));
        expect(session.getCurrentTodoList()).toBeNull();

        mock.emit(planUpdate([{ content: "again", status: "pending" }]));
        await session.dispose();
        expect(session.getCurrentTodoList()).toBeNull();
      });
    });
  });

  describe("buildPromptBlocks()", () => {
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
    const makeFile = (path: string) => ({ path }) as unknown as TFile;

    it("returns the message as plain text when no context, or only empty context, is attached", () => {
      expect(buildPromptBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
      expect(buildPromptBlocks("hello", { notes: [], urls: [] })).toEqual([
        { type: "text", text: "hello" },
      ]);
    });

    it("wraps the message with note paths when contextNotes are attached", () => {
      const blocks = buildPromptBlocks("summarize them", {
        notes: [makeFile("daily/2026-04-28.md"), makeFile("projects/copilot.md")],
        urls: [],
      });
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("text");
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<copilot-context>");
      expect(text).toContain("- daily/2026-04-28.md");
      expect(text).toContain("- projects/copilot.md");
      expect(text).toContain("</copilot-context>");
      expect(text).toContain("<user-message>\nsummarize them\n</user-message>");
    });

    it("inlines selected text excerpts with path and line range", () => {
      const blocks = buildPromptBlocks("explain", {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "s1",
            sourceType: "note",
            notePath: "projects/copilot.md",
            noteTitle: "copilot",
            startLine: 12,
            endLine: 18,
            content: "line one\nline two",
          },
        ],
      });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Selected excerpts");
      expect(text).toContain("- projects/copilot.md (lines 12-18):");
      expect(text).toContain("  line one");
      expect(text).toContain("  line two");
    });

    it("inlines a Reading view excerpt without claiming source lines (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
      const blocks = buildPromptBlocks("explain", {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "reading-excerpt",
            sourceType: "note",
            notePath: "projects/copilot.md",
            noteTitle: "copilot",
            content: "Rendered note passage",
            startLine: 0,
            endLine: 0,
          },
        ],
      });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("- projects/copilot.md:\n  Rendered note passage");
      expect(text).not.toContain("(lines");
    });

    it("appends image content blocks after the text envelope", () => {
      const blocks = buildPromptBlocks("here", undefined, [
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ]);
      expect(blocks).toEqual([
        { type: "text", text: "here" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ]);
    });

    it("combines envelope, text, and content blocks in order", () => {
      const blocks = buildPromptBlocks(
        "look at this",
        {
          notes: [makeFile("a.md")],
          urls: [],
        },
        [
          { type: "text", text: "<attached-pdf path='b.pdf'>parsed body</attached-pdf>" },
          { type: "image", mimeType: "image/jpeg", data: "ZmFrZQ==" },
        ]
      );
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe("text");
      const head = (blocks[0] as { type: "text"; text: string }).text;
      expect(head).toContain("<copilot-context>");
      expect(head).toContain("- a.md");
      expect(head).toContain("<user-message>\nlook at this\n</user-message>");
      expect(blocks[1]).toEqual({
        type: "text",
        text: "<attached-pdf path='b.pdf'>parsed body</attached-pdf>",
      });
      expect(blocks[2]).toEqual({ type: "image", mimeType: "image/jpeg", data: "ZmFrZQ==" });
    });

    it("serializes web-source selected text excerpts as <web_selected_text>", () => {
      const blocks = buildPromptBlocks("explain", {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "w1",
            sourceType: "web",
            title: "Example",
            url: "https://example.com",
            content: "web snippet",
          },
        ],
      });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<web_selected_text>");
      expect(text).toContain("<title>Example</title>");
      expect(text).toContain("<url>https://example.com</url>");
      expect(text).toContain("web snippet");
      expect(text).toContain("<user-message>\nexplain\n</user-message>");
    });

    it("emits plain text when the web-tab block is empty/whitespace", () => {
      const blocks = buildPromptBlocks("hi", undefined, undefined, "   ");
      expect(blocks).toEqual([{ type: "text", text: "hi" }]);
    });

    it("orders the envelope, web selections, and web-tab block before the message", () => {
      const webTabBlock = "<web_tab_context>\n<url>https://x.dev</url>\n</web_tab_context>";
      const blocks = buildPromptBlocks(
        "look",
        {
          notes: [makeFile("a.md")],
          urls: [],
          selectedTextContexts: [
            { id: "w1", sourceType: "web", title: "W", url: "https://w.dev", content: "snip" },
          ],
        },
        undefined,
        webTabBlock
      );
      const text = (blocks[0] as { type: "text"; text: string }).text;
      const envelopePos = text.indexOf("<copilot-context>");
      const selectionPos = text.indexOf("<web_selected_text>");
      const webTabPos = text.indexOf("<web_tab_context>");
      const messagePos = text.indexOf("<user-message>");
      expect(envelopePos).toBeGreaterThanOrEqual(0);
      expect(envelopePos).toBeLessThan(selectionPos);
      expect(selectionPos).toBeLessThan(webTabPos);
      expect(webTabPos).toBeLessThan(messagePos);
    });

    it("prepends the project-context block ahead of the attached context and message", () => {
      const projectContextBlock =
        "<project_context>\n## Included folders\n- `/vault/Papers`\n</project_context>";
      const blocks = buildPromptBlocks(
        "go",
        { notes: [makeFile("a.md")], urls: [] },
        undefined,
        undefined,
        projectContextBlock
      );
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<project_context>");
      expect(text).toContain("`/vault/Papers`");
      expect(text.indexOf("<project_context>")).toBeLessThan(text.indexOf("<copilot-context>"));
      expect(text.indexOf("<copilot-context>")).toBeLessThan(text.indexOf("<user-message>"));
    });

    it("injects the project-context-updates note after the manifest, before the message", () => {
      const updatesBlock =
        "<project_context_updates>\nsources may have changed\n</project_context_updates>";
      const blocks = buildPromptBlocks(
        "go",
        { notes: [makeFile("a.md")], urls: [] },
        undefined,
        undefined,
        "<project_context>\nmanifest\n</project_context>",
        undefined,
        updatesBlock
      );
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).toContain("<project_context_updates>");
      expect(text.indexOf("<project_context>")).toBeLessThan(
        text.indexOf("<project_context_updates>")
      );
      expect(text.indexOf("<project_context_updates>")).toBeLessThan(
        text.indexOf("<user-message>")
      );
    });

    it("omits the project-context and updates blocks when none are provided (later turns)", () => {
      const blocks = buildPromptBlocks("go", { notes: [makeFile("a.md")], urls: [] });
      const text = (blocks[0] as { type: "text"; text: string }).text;
      expect(text).not.toContain("<project_context>");
      expect(text).not.toContain("<project_context_updates>");
    });
  });

  describe("buildUserDisplayContent()", () => {
    it("returns undefined when there are no images", () => {
      expect(buildUserDisplayContent("hi")).toBeUndefined();
      expect(buildUserDisplayContent("hi", [])).toBeUndefined();
      expect(buildUserDisplayContent("hi", [{ type: "text", text: "x" }])).toBeUndefined();
    });

    it("puts the prompt text first, then an image_url entry per image", () => {
      expect(
        buildUserDisplayContent("describe these", [
          { type: "image", mimeType: "image/png", data: "AAA=" },
          { type: "image", mimeType: "image/jpeg", data: "BBB=" },
        ])
      ).toEqual([
        { type: "text", text: "describe these" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB=" } },
      ]);
    });

    it("omits the text entry for an image-only message", () => {
      expect(
        buildUserDisplayContent("   ", [{ type: "image", mimeType: "image/png", data: "AAA=" }])
      ).toEqual([{ type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } }]);
    });
  });

  describe("withReadOnlyPreamble()", () => {
    it("leads the first text block with the read-only instruction", () => {
      const out = withReadOnlyPreamble([{ type: "text", text: "the question" }]);
      expect(out).toEqual([{ type: "text", text: `${FANOUT_READONLY_PREAMBLE}\n\nthe question` }]);
    });

    it("inserts a leading text block when the prompt has none (image-only)", () => {
      const out = withReadOnlyPreamble([{ type: "image", mimeType: "image/png", data: "x" }]);
      expect(out[0]).toEqual({ type: "text", text: FANOUT_READONLY_PREAMBLE });
      expect(out).toHaveLength(2);
    });
  });

  describe("tryReadExitPlanModeCall()", () => {
    it("returns the plan body when isPlanProposal is true", () => {
      const out = tryReadExitPlanModeCall({
        kind: "other",
        rawInput: { plan: "# do the thing" },
        isPlanProposal: true,
      });
      expect(out).toEqual({ plan: "# do the thing", planFilePath: undefined });
    });

    it("falls back to ACP kind=switch_mode when isPlanProposal is unset", () => {
      const out = tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { plan: "## plan body", planFilePath: "/abs/plan.md" },
      });
      expect(out).toEqual({ plan: "## plan body", planFilePath: "/abs/plan.md" });
    });

    it("returns null when rawInput.plan is missing — content gate is load-bearing", () => {
      expect(
        tryReadExitPlanModeCall({
          kind: "switch_mode",
          rawInput: { planFilePath: "/abs/plan.md" },
          isPlanProposal: true,
        })
      ).toBeNull();
    });

    it("returns null when rawInput.plan is not a string", () => {
      expect(
        tryReadExitPlanModeCall({
          kind: "switch_mode",
          rawInput: { plan: 42 },
        })
      ).toBeNull();
    });

    it("returns null when neither isPlanProposal nor switch_mode kind matches", () => {
      expect(
        tryReadExitPlanModeCall({
          kind: "edit",
          rawInput: { plan: "looks like a plan but isn't tagged as one" },
        })
      ).toBeNull();
    });

    it("ignores planFilePath when it isn't a string", () => {
      const out = tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { plan: "body", planFilePath: 12 },
      });
      expect(out).toEqual({ plan: "body", planFilePath: undefined });
    });

    it("handles null/undefined rawInput without throwing", () => {
      expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: null })).toBeNull();
      expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: undefined })).toBeNull();
    });
  });
});

describe("AgentSession file-change capture", () => {
  function makeVault(initial: Record<string, string>) {
    const files = new Map(Object.entries(initial));
    const adapter = new FileSystemAdapter();
    adapter.read = jest.fn((p: string) => {
      const content = files.get(p);
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${p}`))
        : Promise.resolve(content);
    });
    let watchers: Array<(file: { path: string }) => void> = [];
    const vault = {
      adapter,
      on: (name: string, cb: (file: { path: string }) => void) => {
        if (name === "create") watchers.push(cb);
        return { name, cb };
      },
      offref: (ref: { cb: (file: { path: string }) => void }) => {
        watchers = watchers.filter((w) => w !== ref.cb);
      },
    };
    const app = { vault } as unknown as App;
    const createFile = (path: string, content: string) => {
      files.set(path, content);
      for (const watcher of watchers) watcher({ path });
    };
    return { files, adapter, app, createFile, watcherCount: () => watchers.length };
  }

  function makeSession(mock: ReturnType<typeof makeMockBackend>, app: App) {
    return new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
      getApp: () => app,
    });
  }

  const editCall = (toolCallId: string, filePath: string) => ({
    sessionId: "acp-1",
    update: {
      sessionUpdate: "tool_call" as const,
      toolCallId,
      title: "Edit",
      kind: "edit" as const,
      status: "in_progress" as const,
      rawInput: { file_path: filePath },
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

  it("reports one change per file however many times the turn edits it", async () => {
    const vault = makeVault({ "notes/a.md": "one\ntwo\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/vault/notes/a.md"));
      mock.emit(editCall("t2", "/vault/notes/a.md"));
      mock.emit(editCall("t3", "/vault/notes/a.md"));
      await Promise.resolve();
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

  it("reports nothing for a file the turn edited and then restored", async () => {
    const vault = makeVault({ "notes/a.md": "original\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/vault/notes/a.md"));
      await Promise.resolve();
      vault.files.set("notes/a.md", "changed\n");
      vault.files.set("notes/a.md", "original\n");
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit and undo").turn;

    expect(fileChangesOf(session)).toBeUndefined();
  });

  it("reports a file the turn wrote for the first time as created", async () => {
    const vault = makeVault({});
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/vault/notes/new.md"));
      await Promise.resolve();
      vault.files.set("notes/new.md", "fresh\n");
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("write a new note").turn;

    expect(fileChangesOf(session)).toEqual([
      {
        path: "notes/new.md",
        status: "created",
        before: null,
        after: "fresh\n",
        additions: 1,
        deletions: 0,
      },
    ]);
  });

  it("snapshots the file before the agent's write, not after it", async () => {
    const vault = makeVault({ "notes/a.md": "before\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/vault/notes/a.md"));
      vault.files.set("notes/a.md", "after\n");
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit it").turn;

    expect(fileChangesOf(session)).toMatchObject([{ before: "before\n", after: "after\n" }]);
  });

  it("prefers the pre-edit content a Claude tool result reports over its own snapshot", async () => {
    const vault = makeVault({ "notes/a.md": "already written by the agent\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/vault/notes/a.md"));
      await Promise.resolve();
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
          rawOutput: { originalFile: "the true original\n" },
        } as never,
      });
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { before: "the true original\n", after: "already written by the agent\n" },
    ]);
  });

  it("trusts a whole-file diff over a snapshot the agent's write already overtook", async () => {
    const vault = makeVault({ "notes/a.md": "rewritten\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Editing files",
          kind: "edit",
          status: "in_progress",
          content: [
            {
              type: "diff",
              path: "/vault/notes/a.md",
              oldText: "original\n",
              newText: "rewritten\n",
            },
          ],
        },
      });
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("patch it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/a.md", status: "modified", before: "original\n", after: "rewritten\n" },
    ]);
  });

  it("treats a whole-file diff with no old side as a file the turn created", async () => {
    const vault = makeVault({ "notes/new.md": "fresh\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Editing files",
          kind: "edit",
          status: "in_progress",
          content: [
            { type: "diff", path: "/vault/notes/new.md", oldText: null, newText: "fresh\n" },
          ],
        },
      });
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("create it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/new.md", status: "created", before: null },
    ]);
  });

  it("keeps its own snapshot when the reported edit cannot be undone", async () => {
    // A failed or rejected call reports edits that never landed, so only the snapshot counts.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/347
    const vault = makeVault({ "notes/a.md": "one\ntwo\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Edit",
          kind: "edit",
          status: "in_progress",
          rawInput: {
            file_path: "/vault/notes/a.md",
            old_string: "two",
            new_string: "never written",
          },
        },
      });
      await Promise.resolve();
      vault.files.set("notes/a.md", "one\ntwo\nthree\n");
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit part of it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { before: "one\ntwo\n", after: "one\ntwo\nthree\n" },
    ]);
  });

  it("snapshots an edit whose kind only the tool call it updates declared", async () => {
    const vault = makeVault({ "notes/a.md": "one\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Editing files",
          kind: "edit",
          status: "in_progress",
        },
      });
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
          content: [
            { type: "diff", path: "/vault/notes/a.md", oldText: "one\n", newText: "one\ntwo\n" },
          ],
        },
      });
      await Promise.resolve();
      vault.files.set("notes/a.md", "one\ntwo\n");
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/a.md", before: "one\n", after: "one\ntwo\n" },
    ]);
  });

  it("ignores paths outside the vault and inside hidden folders", async () => {
    const vault = makeVault({});
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/tmp/scratch.md"));
      mock.emit(editCall("t2", "/vault/.config/plugins/copilot/data.json"));
      await Promise.resolve();
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
    let cancelTurn: (() => void) | null = null;
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/vault/notes/a.md"));
      await Promise.resolve();
      vault.files.set("notes/a.md", "one\ntwo\n");
      cancelTurn?.();
      return new Promise<never>(() => {});
    });
    const session = makeSession(mock, vault.app);
    cancelTurn = () => void session.cancel();

    await session.sendPrompt("edit it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/a.md", status: "modified", additions: 1, deletions: 0 },
    ]);
  });

  it("starts each turn from a clean slate so an earlier turn's files are not re-reported", async () => {
    const vault = makeVault({ "notes/a.md": "one\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementationOnce(async () => {
      mock.emit(editCall("t1", "/vault/notes/a.md"));
      await Promise.resolve();
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

  it("captures nothing when the session has no app to read the vault through", async () => {
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "notes/a.md"));
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude",
    });

    await session.sendPrompt("edit it").turn;

    expect(fileChangesOf(session)).toBeUndefined();
  });

  it("recovers the pre-turn content from the substitution an edit tool reports", async () => {
    const vault = makeVault({ "notes/a.md": "# Beta\n\n- cerulean\n- amber\n" });
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
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/vault/notes/a.md" }],
          rawInput: {
            filePath: "/vault/notes/a.md",
            oldString: "- one\n- two",
            newString: "- cerulean\n- amber",
          },
        },
      });
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      {
        path: "notes/a.md",
        status: "modified",
        before: "# Beta\n\n- one\n- two\n",
        after: "# Beta\n\n- cerulean\n- amber\n",
      },
    ]);
  });

  it("undoes every reported edit when the turn rewrote one file several times", async () => {
    const vault = makeVault({ "notes/a.md": "one THREE\n" });
    const mock = makeMockBackend();
    const editUpdate = (toolCallId: string, oldString: string, newString: string) => ({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update" as const,
        toolCallId,
        kind: "edit" as const,
        status: "in_progress" as const,
        locations: [{ path: "/vault/notes/a.md" }],
        rawInput: { filePath: "/vault/notes/a.md", oldString, newString },
      },
    });
    mock.prompt.mockImplementation(async () => {
      mock.emit(editUpdate("t1", "two", "TWO"));
      mock.emit(editUpdate("t2", "TWO", "THREE"));
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit it twice").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/a.md", before: "one two\n", after: "one THREE\n" },
    ]);
  });

  it("falls back to the content the file had when the turn first read it", async () => {
    const vault = makeVault({ "notes/a.md": "before the turn\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          kind: "read",
          status: "in_progress",
          locations: [{ path: "/vault/notes/a.md" }],
        },
      });
      await Promise.resolve();
      vault.files.set("notes/a.md", "written by the agent\n");
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t2",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/vault/notes/a.md" }],
          rawInput: { filePath: "/vault/notes/a.md", content: "written by the agent\n" },
        },
      });
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("rewrite it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/a.md", before: "before the turn\n", after: "written by the agent\n" },
    ]);
  });

  it("leaves a file the turn only read out of the reported changes", async () => {
    const vault = makeVault({ "notes/a.md": "unchanged\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Read",
          kind: "read",
          status: "in_progress",
          locations: [{ path: "/vault/notes/a.md" }],
        },
      });
      await Promise.resolve();
      vault.files.set("notes/a.md", "changed by someone else\n");
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("read it").turn;

    expect(fileChangesOf(session)).toBeUndefined();
  });

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
      await Promise.resolve();
      vault.files.set("notes/a.md", "written by the agent\n");
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "write",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/vault/notes/a.md" }],
        },
      });
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("write it").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/a.md", before: "before the turn\n", after: "written by the agent\n" },
    ]);
  });

  it("keeps the pre-turn original when a later edit to the same file reports its own", async () => {
    const vault = makeVault({ "notes/a.md": "third\n" });
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      mock.emit(editCall("t1", "/vault/notes/a.md"));
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
          rawOutput: { originalFile: "first\n" },
        } as never,
      });
      mock.emit(editCall("t2", "/vault/notes/a.md"));
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t2",
          status: "completed",
          rawOutput: { originalFile: "second\n" },
        } as never,
      });
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("edit it twice").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/a.md", before: "first\n", after: "third\n" },
    ]);
  });

  it("reports a file Obsidian saw appear during the turn as created", async () => {
    // The vault watcher is the only evidence a file is new when the backend writes before announcing.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/347
    const vault = makeVault({});
    const mock = makeMockBackend();
    mock.prompt.mockImplementation(async () => {
      vault.createFile("notes/new.md", "fresh\n");
      mock.emit({
        sessionId: "acp-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/vault/notes/new.md" }],
          rawInput: { filePath: "/vault/notes/new.md", content: "fresh\n" },
        },
      });
      await Promise.resolve();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("write a new note").turn;

    expect(fileChangesOf(session)).toMatchObject([
      { path: "notes/new.md", status: "created", before: null, after: "fresh\n" },
    ]);
  });

  it("watches the vault only while the turn runs", async () => {
    const vault = makeVault({ "notes/a.md": "one\n" });
    const mock = makeMockBackend();
    let watchersDuringTurn = 0;
    mock.prompt.mockImplementation(async () => {
      watchersDuringTurn = vault.watcherCount();
      return { stopReason: "end_turn" as const };
    });
    const session = makeSession(mock, vault.app);

    await session.sendPrompt("do nothing").turn;

    expect(watchersDuringTurn).toBe(1);
    expect(vault.watcherCount()).toBe(0);
  });
});
