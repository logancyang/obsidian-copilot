import type {
  BackendProcess,
  CopilotMode,
  BackendState,
  OpenSessionInput,
  PromptInput,
  SessionEvent,
  SessionId,
  SessionUpdateHandler,
  TurnEnd,
} from "@/agentMode/session/types";

export interface FakeAgentBackend {
  backend: BackendProcess;
  newSession: jest.Mock<Promise<{ sessionId: SessionId; state: BackendState }>, [OpenSessionInput]>;
  cancel: jest.Mock;
  closeSession: jest.Mock;
  setSessionMode: jest.Mock;
  prompts: PromptInput[];
  promptsTo(sessionId: SessionId): string[];
  untilPrompt(sessionId: SessionId, count?: number): Promise<string>;
  emit(sessionId: SessionId, update: SessionEvent["update"], taskToolCallId?: string): void;
  say(sessionId: SessionId, text: string): void;
  endTurn(sessionId: SessionId, end?: Partial<Omit<TurnEnd, "turnId">>): void;
}

export function createFakeAgentBackend(state: BackendState = { model: null, mode: null }) {
  const handlers = new Map<SessionId, SessionUpdateHandler>();
  const openTurns = new Map<SessionId, string>();
  const prompts: PromptInput[] = [];
  const promptWaiters = new Set<() => void>();
  let nextSession = 1;
  const promptsTo = (sessionId: SessionId) =>
    prompts
      .filter((input) => input.sessionId === sessionId)
      .map((input) => input.prompt.map((part) => (part.type === "text" ? part.text : "")).join(""));
  const emit = (sessionId: SessionId, update: SessionEvent["update"], taskToolCallId?: string) =>
    handlers.get(sessionId)?.({
      sessionId,
      update,
      ...(taskToolCallId ? { taskToolCallId } : {}),
    });
  const newSession = jest.fn(async (_input: OpenSessionInput) => ({
    sessionId: `session-${nextSession++}`,
    state,
  }));
  const cancel = jest.fn(async ({ sessionId }: { sessionId: SessionId }) => {
    const turnId = openTurns.get(sessionId);
    if (!turnId) return;
    openTurns.delete(sessionId);
    emit(sessionId, { sessionUpdate: "turn_ended", turnId, stopReason: "cancelled" });
  });
  const closeSession = jest.fn(async (_params: { sessionId: SessionId }) => undefined);
  const setSessionMode = jest.fn(
    async ({ modeId }: { sessionId: SessionId; modeId: string }): Promise<BackendState> =>
      state.mode ? { ...state, mode: { ...state.mode, current: modeId as CopilotMode } } : state
  );
  const backend: BackendProcess = {
    isRunning: () => true,
    onExit: () => () => {},
    setPermissionPrompter: () => {},
    registerSessionHandler: (sessionId, handler) => {
      handlers.set(sessionId, handler);
      return () => {
        if (handlers.get(sessionId) === handler) handlers.delete(sessionId);
      };
    },
    newSession,
    prompt: async (input) => {
      prompts.push(input);
      promptWaiters.forEach((wake) => wake());
      openTurns.set(input.sessionId, input.promptId);
      emit(input.sessionId, { sessionUpdate: "message_delivered", promptId: input.promptId });
      emit(input.sessionId, { sessionUpdate: "turn_started", turnId: input.promptId });
    },
    cancel,
    closeSession,
    setSessionModel: async () => state,
    isSetSessionModelSupported: () => true,
    setSessionMode,
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: async () => state,
    isSetSessionConfigOptionSupported: () => true,
    listSessions: async () => ({ sessions: [] }),
    resumeSession: () => Promise.reject(new Error("resume")),
    loadSession: () => Promise.reject(new Error("load")),
    shutdown: async () => {},
  };
  const fake: FakeAgentBackend = {
    backend,
    newSession,
    cancel,
    closeSession,
    setSessionMode,
    prompts,
    promptsTo,
    untilPrompt: (sessionId, count = 1) =>
      new Promise((resolve) => {
        const wake = () => {
          const sent = promptsTo(sessionId);
          if (sent.length < count) return;
          promptWaiters.delete(wake);
          resolve(sent[count - 1]);
        };
        promptWaiters.add(wake);
        wake();
      }),
    emit,
    say: (sessionId, text) =>
      emit(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } }),
    endTurn: (sessionId, end = {}) => {
      const turnId = openTurns.get(sessionId);
      if (!turnId) throw new Error(`No turn is open in ${sessionId}`);
      openTurns.delete(sessionId);
      emit(sessionId, { sessionUpdate: "turn_ended", turnId, stopReason: "end_turn", ...end });
    },
  };
  return fake;
}
