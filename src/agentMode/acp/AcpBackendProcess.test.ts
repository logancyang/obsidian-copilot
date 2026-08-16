import { FileSystemAdapter, App } from "obsidian";
import type { BackendDescriptor, PermissionOption } from "@/agentMode/session/types";
import { AcpBackendProcess } from "./AcpBackendProcess";
import type { AcpBackend } from "./types";
import type { VaultClient } from "./VaultClient";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Controllable ACP SDK mock (richer than the shared `__mocks__` stub): lets a
// test set the `initialize` response (to advertise capabilities) and capture
// the `newSession` request. `mock`-prefixed names satisfy ts-jest's jest.mock
// hoisting rules.
let mockInitializeResult: unknown = { protocolVersion: 1 };
const mockNewSession = jest.fn(async (..._args: unknown[]) => ({ sessionId: "test-session" }));
const mockResumeSession = jest.fn(async (..._args: unknown[]) => ({}));
const mockLoadSession = jest.fn(async (..._args: unknown[]) => ({}));

jest.mock("@agentclientprotocol/sdk", () => {
  class RequestError extends Error {
    code: number;
    constructor(code: number, message?: string) {
      super(message);
      this.code = code;
      this.name = "RequestError";
    }
  }
  class ClientSideConnection {
    _client: unknown;
    constructor(toClient: (c: unknown) => unknown) {
      this._client = toClient(this);
    }
    initialize = jest.fn(async () => mockInitializeResult);
    newSession = (...args: unknown[]) => mockNewSession(...args);
    resumeSession = (...args: unknown[]) => mockResumeSession(...args);
    loadSession = (...args: unknown[]) => mockLoadSession(...args);
    prompt = jest.fn(async () => ({ stopReason: "end_turn" }));
    cancel = jest.fn(async () => undefined);
    unstable_setSessionModel = jest.fn(async () => ({}));
  }
  return {
    RequestError,
    ClientSideConnection,
    ndJsonStream: jest.fn(() => ({})),
    PROTOCOL_VERSION: 1,
  };
});

const exitListeners = new Set<() => void>();
let mockProcessIsRunning = true;

jest.mock("./AcpProcessManager", () => ({
  AcpProcessManager: jest.fn().mockImplementation(() => ({
    start: () => ({
      stdin: new WritableStream<Uint8Array>(),
      stdout: new ReadableStream<Uint8Array>(),
    }),
    onExit: (fn: () => void) => {
      exitListeners.add(fn);
      return () => exitListeners.delete(fn);
    },
    isRunning: () => mockProcessIsRunning,
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

function buildApp(basePath = "/vault"): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(basePath);
  return { vault: { adapter } } as unknown as App;
}

function buildStubBackend(overrides: Partial<AcpBackend> = {}): AcpBackend {
  return {
    id: "opencode",
    displayName: "opencode",
    buildSpawnDescriptor: jest.fn().mockResolvedValue({
      command: "/bin/true",
      args: [],
      env: {},
    }),
    ...overrides,
  };
}

function buildStubDescriptor(overrides: Partial<BackendDescriptor> = {}): BackendDescriptor {
  return {
    id: "opencode",
    displayName: "opencode",
    ...overrides,
  } as unknown as BackendDescriptor;
}

/**
 * Pull the VaultClient that AcpBackendProcess wires into the mock
 * ClientSideConnection. The mock stores the `toClient(this)` result on
 * `_client`, which lets tests trigger routing/permission paths the same way
 * the agent backend would.
 */
function getVaultClient(backend: AcpBackendProcess): VaultClient {
  const connection = (backend as unknown as { connection: { _client: VaultClient } }).connection;
  return connection._client;
}

describe("AcpBackendProcess", () => {
  beforeEach(() => {
    exitListeners.clear();
    mockProcessIsRunning = true;
    mockInitializeResult = { protocolVersion: 1 };
    mockNewSession.mockClear();
    mockNewSession.mockResolvedValue({ sessionId: "test-session" });
    mockResumeSession.mockClear();
    mockResumeSession.mockResolvedValue({});
    mockLoadSession.mockClear();
    mockLoadSession.mockResolvedValue({});
  });

  describe("routeSessionUpdate()", () => {
    it("routes session updates to the matching session handler and drops unknown ones", async () => {
      const backend = new AcpBackendProcess(
        buildApp(),
        buildStubBackend(),
        "1.0.0",
        buildStubDescriptor()
      );
      await backend.start();

      const handler = jest.fn();
      backend.registerSessionHandler("session-known", handler);

      const client = getVaultClient(backend);
      const knownUpdate = {
        sessionId: "session-known",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
      } as unknown as Parameters<typeof client.sessionUpdate>[0];
      await client.sessionUpdate(knownUpdate);
      // Handler is called with a SessionEvent (translated from the wire shape).
      expect(handler).toHaveBeenCalledTimes(1);
      const got = handler.mock.calls[0][0];
      expect(got.sessionId).toBe("session-known");
      expect(got.update.sessionUpdate).toBe("agent_message_chunk");

      const strayUpdate = {
        sessionId: "session-unknown",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } },
      } as unknown as Parameters<typeof client.sessionUpdate>[0];
      await expect(client.sessionUpdate(strayUpdate)).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("calls the backend predicate only for agent-message text and drops rejected text for https://github.com/logancyang/obsidian-copilot-preview/issues/315", async () => {
      const shouldRouteAgentMessageText = jest.fn(() => false);
      const backend = new AcpBackendProcess(
        buildApp(),
        buildStubBackend({ shouldRouteAgentMessageText }),
        "1.0.0",
        buildStubDescriptor()
      );
      await backend.start();

      const handler = jest.fn();
      backend.registerSessionHandler("session-known", handler);
      const client = getVaultClient(backend);
      const rejectedUpdate = {
        sessionId: "session-known",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hidden" },
        },
      } as unknown as Parameters<typeof client.sessionUpdate>[0];

      await client.sessionUpdate(rejectedUpdate);

      const thoughtUpdate = {
        sessionId: "session-known",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "visible thought" },
        },
      } as unknown as Parameters<typeof client.sessionUpdate>[0];
      const imageUpdate = {
        sessionId: "session-known",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "image", mimeType: "image/png", data: "aGk=" },
        },
      } as unknown as Parameters<typeof client.sessionUpdate>[0];
      await client.sessionUpdate(thoughtUpdate);
      await client.sessionUpdate(imageUpdate);

      expect(shouldRouteAgentMessageText).toHaveBeenCalledTimes(1);
      expect(shouldRouteAgentMessageText).toHaveBeenCalledWith("hidden");
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  it("scopes todowrite id tracking per session — a registered id does not bleed across sessions", async () => {
    const backend = new AcpBackendProcess(
      buildApp(),
      buildStubBackend(),
      "1.0.0",
      buildStubDescriptor()
    );
    await backend.start();

    const handlerA = jest.fn();
    const handlerB = jest.fn();
    backend.registerSessionHandler("sess-A", handlerA);
    backend.registerSessionHandler("sess-B", handlerB);
    const client = getVaultClient(backend);

    // Session A registers "shared-id" as a todowrite call (synthesizes a plan).
    await client.sessionUpdate({
      sessionId: "sess-A",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "shared-id",
        title: "todowrite",
        rawInput: { todos: [{ content: "a", status: "pending", priority: "high" }] },
      },
    } as unknown as Parameters<typeof client.sessionUpdate>[0]);
    expect(handlerA.mock.calls.some(([e]) => e.update.sessionUpdate === "plan")).toBe(true);

    // Session B sends a titleless update reusing the SAME id with a todos
    // payload. With a process-wide Set this would masquerade as a plan; scoped
    // per session, B's tracker is empty so no plan is synthesized.
    handlerB.mockClear();
    await client.sessionUpdate({
      sessionId: "sess-B",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "shared-id",
        rawInput: { todos: [{ content: "leaked", status: "pending", priority: "low" }] },
      },
    } as unknown as Parameters<typeof client.sessionUpdate>[0]);
    expect(handlerB.mock.calls.some(([e]) => e.update.sessionUpdate === "plan")).toBe(false);
  });

  it("keeps a session's todo tracker when re-registering the same sessionId (stale unsubscribe is a no-op)", async () => {
    const backend = new AcpBackendProcess(
      buildApp(),
      buildStubBackend(),
      "1.0.0",
      buildStubDescriptor()
    );
    await backend.start();
    const client = getVaultClient(backend);

    // First handler registers "todo-1" as a todowrite call, then unsubscribes —
    // but a SECOND handler for the same session is already registered, so the
    // stale unsubscribe must not delete the live tracker.
    const stale = backend.registerSessionHandler("sess-X", jest.fn());
    await client.sessionUpdate({
      sessionId: "sess-X",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "todo-1",
        title: "todowrite",
        rawInput: { todos: [{ content: "a", status: "pending", priority: "high" }] },
      },
    } as unknown as Parameters<typeof client.sessionUpdate>[0]);

    const fresh = jest.fn();
    backend.registerSessionHandler("sess-X", fresh); // replaces the handler
    stale(); // stale unsubscribe — must NOT drop sess-X's tracker

    // A titleless follow-up for the registered id must still synthesize a plan,
    // proving the tracker survived the stale unsubscribe.
    await client.sessionUpdate({
      sessionId: "sess-X",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "todo-1",
        rawInput: { todos: [{ content: "a", status: "in_progress", priority: "high" }] },
      },
    } as unknown as Parameters<typeof client.sessionUpdate>[0]);
    expect(fresh.mock.calls.some(([e]) => e.update.sessionUpdate === "plan")).toBe(true);
  });

  it("drops todo trackers on subprocess exit so a restarted process starts clean", async () => {
    const backend = new AcpBackendProcess(
      buildApp(),
      buildStubBackend(),
      "1.0.0",
      buildStubDescriptor()
    );
    await backend.start();
    const client = getVaultClient(backend);

    backend.registerSessionHandler("sess-E", jest.fn());
    await client.sessionUpdate({
      sessionId: "sess-E",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "todo-e",
        title: "todowrite",
        rawInput: { todos: [{ content: "a", status: "pending", priority: "high" }] },
      },
    } as unknown as Parameters<typeof client.sessionUpdate>[0]);

    // Subprocess exits, then the process is restarted and the same sessionId +
    // todo id reappear. With the onExit cleanup the tracker is gone, so a
    // titleless update is NOT mistaken for the old todowrite call.
    for (const fn of exitListeners) fn();
    await backend.start();
    const client2 = getVaultClient(backend);
    const handler = jest.fn();
    backend.registerSessionHandler("sess-E", handler);
    await client2.sessionUpdate({
      sessionId: "sess-E",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "todo-e",
        rawInput: { todos: [{ content: "stale", status: "pending", priority: "low" }] },
      },
    } as unknown as Parameters<typeof client2.sessionUpdate>[0]);
    expect(handler.mock.calls.some(([e]) => e.update.sessionUpdate === "plan")).toBe(false);
  });

  it("returns cancelled outcome when permission is requested but no prompter is registered", async () => {
    const backend = new AcpBackendProcess(
      buildApp(),
      buildStubBackend(),
      "1.0.0",
      buildStubDescriptor()
    );
    await backend.start();

    const client = getVaultClient(backend);
    const response = await client.requestPermission({
      sessionId: "s1",
      toolCall: {
        toolCallId: "tc1",
        title: "Run dangerous thing",
      },
      options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }],
    } as unknown as Parameters<typeof client.requestPermission>[0]);
    expect(response).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("forwards opaque option metadata unchanged to the presentation hook before delegating", async () => {
    const policyMetadata = {
      codex: { decision: "acceptWithExecpolicyAmendment" },
    };
    const presentPermissionOption = jest.fn(
      (option: PermissionOption, metadata: unknown): PermissionOption => {
        if (metadata !== policyMetadata) return option;
        return {
          ...option,
          name: "Allow Always",
          description: option.name,
        };
      }
    );
    const backend = new AcpBackendProcess(
      buildApp(),
      buildStubBackend(),
      "1.0.0",
      buildStubDescriptor({ presentPermissionOption })
    );
    await backend.start();

    const prompter = jest.fn().mockResolvedValue({
      outcome: { outcome: "selected", optionId: "backend-policy-rule" },
    });
    backend.setPermissionPrompter(prompter);

    const client = getVaultClient(backend);
    const policyRule = "Allow commands matching `/usr/local/bin/search --vault notes`";
    const req = {
      sessionId: "s1",
      toolCall: { toolCallId: "tc1", title: "Read" },
      options: [
        { optionId: "allow_once", name: "Allow Once", kind: "allow_once" },
        {
          optionId: "backend-policy-rule",
          name: policyRule,
          kind: "allow_always",
          _meta: policyMetadata,
        },
      ],
    } as unknown as Parameters<typeof client.requestPermission>[0];
    const response = await client.requestPermission(req);
    expect(presentPermissionOption).toHaveBeenCalledTimes(2);
    expect(presentPermissionOption.mock.calls[1][1]).toBe(policyMetadata);
    expect(prompter).toHaveBeenCalledTimes(1);
    // Prompter receives a session-domain `PermissionPrompt`.
    const prompt = prompter.mock.calls[0][0];
    expect(prompt.sessionId).toBe("s1");
    expect(prompt.toolCall.toolCallId).toBe("tc1");
    expect(prompt.options).toEqual([
      {
        optionId: "allow_once",
        name: "Allow Once",
        kind: "allow_once",
      },
      {
        optionId: "backend-policy-rule",
        name: "Allow Always",
        description: policyRule,
        kind: "allow_always",
      },
    ]);
    expect(response).toEqual({
      outcome: { outcome: "selected", optionId: "backend-policy-rule" },
    });
  });

  it("clears connection state on subprocess exit so subsequent ops fail with a clear error", async () => {
    const backend = new AcpBackendProcess(
      buildApp(),
      buildStubBackend(),
      "1.0.0",
      buildStubDescriptor()
    );
    await backend.start();
    const handler = jest.fn();
    backend.registerSessionHandler("s1", handler);

    // Simulate the subprocess dying.
    mockProcessIsRunning = false;
    for (const fn of exitListeners) fn();

    await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toThrow(/has exited/);
    expect(backend.isRunning()).toBe(false);
  });

  it("throws if start() was never called", async () => {
    const backend = new AcpBackendProcess(
      buildApp(),
      buildStubBackend(),
      "1.0.0",
      buildStubDescriptor()
    );
    await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toThrow(/start\(\)/);
  });

  describe("additionalDirectories (capability-gated)", () => {
    async function startBackend(): Promise<AcpBackendProcess> {
      const backend = new AcpBackendProcess(
        buildApp(),
        buildStubBackend(),
        "1.0.0",
        buildStubDescriptor()
      );
      await backend.start();
      return backend;
    }

    it("reflects the probed capability — false when the agent does not advertise it", async () => {
      // codex 0.135 / opencode 1.2.27 shape: no additionalDirectories advertised.
      mockInitializeResult = {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { list: {}, close: {} } },
      };
      const backend = await startBackend();
      expect(backend.supportsAdditionalDirectories()).toBe(false);
    });

    it("reflects the probed capability — true when the agent advertises it", async () => {
      mockInitializeResult = {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } },
      };
      const backend = await startBackend();
      expect(backend.supportsAdditionalDirectories()).toBe(true);
    });

    it("does NOT forward additionalDirectories at session/new when uncapable", async () => {
      mockInitializeResult = { protocolVersion: 1 };
      const backend = await startBackend();
      await backend.newSession({
        cwd: "/vault",
        additionalDirectories: ["/abs/context"],
      });
      const req = mockNewSession.mock.calls[0][0] as {
        additionalDirectories?: string[];
        mcpServers: unknown[];
      };
      expect(req.mcpServers).toEqual([]);
      expect(req).not.toHaveProperty("additionalDirectories");
    });

    it("forwards additionalDirectories at session/new only when capable", async () => {
      mockInitializeResult = {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } },
      };
      const backend = await startBackend();
      await backend.newSession({
        cwd: "/vault",
        additionalDirectories: ["/abs/context-a", "/abs/context-b"],
      });
      const req = mockNewSession.mock.calls[0][0] as { additionalDirectories?: string[] };
      expect(req.additionalDirectories).toEqual(["/abs/context-a", "/abs/context-b"]);
    });

    it("omits the field for a capable agent when no extra roots are supplied", async () => {
      mockInitializeResult = {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } },
      };
      const backend = await startBackend();
      await backend.newSession({ cwd: "/vault" });
      const req = mockNewSession.mock.calls[0][0] as { additionalDirectories?: string[] };
      expect(req).not.toHaveProperty("additionalDirectories");
    });

    // Resume/load re-establish the roots the same way session/new does, so a
    // restored project chat must re-send them — symmetry the wire adapter owns.
    it("forwards additionalDirectories at session/resume when capable", async () => {
      mockInitializeResult = {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { resume: {}, additionalDirectories: {} } },
      };
      const backend = await startBackend();
      await backend.resumeSession({
        sessionId: "s1",
        cwd: "/vault",
        additionalDirectories: ["/abs/context-a", "/abs/context-b"],
      });
      const req = mockResumeSession.mock.calls[0][0] as {
        additionalDirectories?: string[];
        mcpServers: unknown[];
      };
      expect(req.mcpServers).toEqual([]);
      expect(req.additionalDirectories).toEqual(["/abs/context-a", "/abs/context-b"]);
    });

    it("does NOT forward additionalDirectories at session/resume when uncapable", async () => {
      // resume advertised, additionalDirectories NOT — the gate must still hold.
      mockInitializeResult = {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { resume: {} } },
      };
      const backend = await startBackend();
      await backend.resumeSession({
        sessionId: "s1",
        cwd: "/vault",
        additionalDirectories: ["/abs/context"],
      });
      const req = mockResumeSession.mock.calls[0][0] as { additionalDirectories?: string[] };
      expect(req).not.toHaveProperty("additionalDirectories");
    });

    it("forwards additionalDirectories at session/load when capable", async () => {
      mockInitializeResult = {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { additionalDirectories: {} },
        },
      };
      const backend = await startBackend();
      await backend.loadSession({
        sessionId: "s1",
        cwd: "/vault",
        additionalDirectories: ["/abs/context-a", "/abs/context-b"],
      });
      const req = mockLoadSession.mock.calls[0][0] as {
        additionalDirectories?: string[];
        mcpServers: unknown[];
      };
      expect(req.mcpServers).toEqual([]);
      expect(req.additionalDirectories).toEqual(["/abs/context-a", "/abs/context-b"]);
    });
  });

  describe("loadSession()", () => {
    /** Reach the VaultClient the backend wired in, to push replayed frames. */
    function replayer(backend: AcpBackendProcess): (update: unknown) => void {
      const client = getVaultClient(backend) as unknown as {
        sessionUpdate: (n: unknown) => void;
      };
      return (update: unknown) => client.sessionUpdate({ sessionId: "ses_load", update });
    }

    async function startLoadCapableBackend(): Promise<AcpBackendProcess> {
      mockInitializeResult = { protocolVersion: 1, agentCapabilities: { loadSession: true } };
      const backend = new AcpBackendProcess(
        buildApp(),
        buildStubBackend(),
        "1.0.0",
        buildStubDescriptor()
      );
      await backend.start();
      return backend;
    }

    it("returns the conversation the agent replays during the call", async () => {
      const backend = await startLoadCapableBackend();
      mockLoadSession.mockImplementationOnce(async () => {
        const push = replayer(backend);
        push({
          sessionUpdate: "user_message_chunk",
          messageId: "m1",
          content: { type: "text", text: "hi" },
        });
        push({
          sessionUpdate: "agent_message_chunk",
          messageId: "m2",
          content: { type: "text", text: "hello" },
        });
        return {};
      });

      const result = await backend.loadSession({ sessionId: "ses_load", cwd: "/vault" });

      expect(result.transcript?.map((m) => m.message)).toEqual(["hi", "hello"]);
    });

    it("collects a replay longer than the pending-update buffer allows", async () => {
      const backend = await startLoadCapableBackend();
      mockLoadSession.mockImplementationOnce(async () => {
        const push = replayer(backend);
        // Well past PENDING_UPDATE_LIMIT: the accumulator must not share that cap.
        for (let i = 0; i < 40; i++) {
          push({
            sessionUpdate: "user_message_chunk",
            messageId: `u${i}`,
            content: { type: "text", text: `ask ${i}` },
          });
          push({
            sessionUpdate: "agent_message_chunk",
            messageId: `a${i}`,
            content: { type: "text", text: `answer ${i}` },
          });
        }
        return {};
      });

      const result = await backend.loadSession({ sessionId: "ses_load", cwd: "/vault" });

      expect(result.transcript).toHaveLength(80);
      expect(result.transcript?.[79].message).toBe("answer 39");
    });

    it("keeps routing session-level updates to the handler while replaying", async () => {
      const backend = await startLoadCapableBackend();
      const handler = jest.fn();
      backend.registerSessionHandler("ses_load", handler);
      mockLoadSession.mockImplementationOnce(async () => {
        replayer(backend)({ sessionUpdate: "usage_update", used: 19_545, size: 200_000 });
        return {};
      });

      await backend.loadSession({ sessionId: "ses_load", cwd: "/vault" });

      expect(handler.mock.calls.map((c) => c[0].update.sessionUpdate)).toContain("usage_update");
    });

    it("omits the transcript when the agent replays nothing", async () => {
      const backend = await startLoadCapableBackend();
      mockLoadSession.mockResolvedValueOnce({});

      const result = await backend.loadSession({ sessionId: "ses_load", cwd: "/vault" });

      expect(result.transcript).toBeUndefined();
    });

    it("stops accumulating once the call fails", async () => {
      const backend = await startLoadCapableBackend();
      mockLoadSession.mockRejectedValueOnce(new Error("load blew up"));
      await expect(backend.loadSession({ sessionId: "ses_load", cwd: "/vault" })).rejects.toThrow(
        "load blew up"
      );

      // A frame arriving after the failed call belongs to nobody, so it must
      // reach normal routing rather than a retired accumulator.
      const handler = jest.fn();
      backend.registerSessionHandler("ses_load", handler);
      replayer(backend)({
        sessionUpdate: "agent_message_chunk",
        messageId: "late",
        content: { type: "text", text: "stray" },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("prompt-result usage fallback", () => {
    // Reach the mock connection's `prompt` jest.fn so a test can stub the
    // turn-level `usage` the backend reads after `prompt()` resolves.
    function promptMock(backend: AcpBackendProcess): jest.Mock {
      return (backend as unknown as { connection: { prompt: jest.Mock } }).connection.prompt;
    }

    async function makeBackend(): Promise<AcpBackendProcess> {
      const backend = new AcpBackendProcess(
        buildApp(),
        buildStubBackend(),
        "1.0.0",
        buildStubDescriptor()
      );
      await backend.start();
      return backend;
    }

    it("emits a used-only usage_update from the prompt result when no live update was seen", async () => {
      const backend = await makeBackend();
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler);
      promptMock(backend).mockResolvedValueOnce({
        stopReason: "end_turn",
        usage: { totalTokens: 4200, inputTokens: 100, outputTokens: 20 },
      });

      await backend.prompt({ sessionId: "s1", prompt: [] });

      const usageEvents = handler.mock.calls
        .map(([e]) => e)
        .filter((e) => e.update.sessionUpdate === "usage_update");
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0].update.usage).toMatchObject({
        usedTokens: 4200,
        inputTokens: 100,
        outputTokens: 20,
      });
      // Fallback carries no window — AgentSession keeps any prior one.
      expect(usageEvents[0].update.usage.contextWindow).toBeUndefined();
    });

    it("suppresses the prompt-result fallback once a live usage_update has been seen", async () => {
      const backend = await makeBackend();
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler);
      const client = getVaultClient(backend);

      // A live usage_update reports current context occupancy (used/size).
      await client.sessionUpdate({
        sessionId: "s1",
        update: { sessionUpdate: "usage_update", used: 5000, size: 200_000 },
      } as unknown as Parameters<typeof client.sessionUpdate>[0]);

      // The prompt result carries a cumulative total; it must not overwrite the
      // live occupancy figure, so no second usage_update should be emitted.
      promptMock(backend).mockResolvedValueOnce({
        stopReason: "end_turn",
        usage: { totalTokens: 999_999, inputTokens: 1, outputTokens: 1 },
      });
      await backend.prompt({ sessionId: "s1", prompt: [] });

      const usageEvents = handler.mock.calls
        .map(([e]) => e)
        .filter((e) => e.update.sessionUpdate === "usage_update");
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0].update.usage).toMatchObject({
        usedTokens: 5000,
        contextWindow: 200_000,
      });
    });
  });

  describe("plan caps", () => {
    const PLAN_USAGE = {
      windows: [{ id: "weekly", label: "Weekly", percent: 13 }],
      updatedAt: 1_000,
    };
    const USAGE_READING = { kind: "usage", planUsage: PLAN_USAGE };

    /** The read is fired without being awaited, so let its microtasks drain. */
    const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0));

    function planEvents(handler: jest.Mock): unknown[] {
      return handler.mock.calls
        .map(([e]) => e as { update: { sessionUpdate: string } })
        .filter((e) => e.update.sessionUpdate === "plan_usage_update");
    }

    async function makeBackend(
      readPlanUsage?: AcpBackend["readPlanUsage"]
    ): Promise<AcpBackendProcess> {
      const backend = new AcpBackendProcess(
        buildApp(),
        { ...buildStubBackend(), readPlanUsage },
        "1.0.0",
        buildStubDescriptor()
      );
      await backend.start();
      return backend;
    }

    it("publishes the caps as soon as a chat opens, without waiting for a turn", async () => {
      // The caps outlive the process, so the first chat of a run has somewhere to read
      // them from and should not make the user send a message to see them.
      const backend = await makeBackend(jest.fn().mockResolvedValue(USAGE_READING));
      const handler = jest.fn();

      backend.registerSessionHandler("s1", handler);
      await settle();

      expect(planEvents(handler)).toEqual([
        { sessionId: "s1", update: { sessionUpdate: "plan_usage_update", planUsage: PLAN_USAGE } },
      ]);
    });

    it("republishes the caps a turn moved, to every attached session", async () => {
      // The number describes the account, so it is equally true of every open chat.
      // Routing it to one would leave the others stale until they each ran a turn.
      const spent = {
        windows: [{ id: "weekly", label: "Weekly", percent: 27 }],
        updatedAt: 2_000,
      };
      const backend = await makeBackend(
        jest
          .fn()
          .mockResolvedValueOnce(USAGE_READING)
          .mockResolvedValue({ kind: "usage", planUsage: spent })
      );
      const first = jest.fn();
      const second = jest.fn();
      backend.registerSessionHandler("s1", first);
      backend.registerSessionHandler("s2", second);
      await settle();
      first.mockClear();
      second.mockClear();

      await backend.prompt({ sessionId: "s1", prompt: [] });
      await settle();

      for (const handler of [first, second]) {
        expect(planEvents(handler)).toEqual([
          expect.objectContaining({
            update: { sessionUpdate: "plan_usage_update", planUsage: spent },
          }),
        ]);
      }
    });

    it("replays the last caps to a session that attaches later, without re-reading", async () => {
      const readPlanUsage = jest.fn().mockResolvedValue(USAGE_READING);
      const backend = await makeBackend(readPlanUsage);
      backend.registerSessionHandler("s1", jest.fn());
      await settle();

      const later = jest.fn();
      backend.registerSessionHandler("s2", later);

      expect(planEvents(later)).toEqual([
        { sessionId: "s2", update: { sessionUpdate: "plan_usage_update", planUsage: PLAN_USAGE } },
      ]);
      expect(readPlanUsage).toHaveBeenCalledTimes(1);
    });

    it("drops an expired window instead of replaying it (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
      // The process outlives many chats; a snapshot taken before a reset describes a
      // period that has ended and must not be shown as the current one.
      const expiring = {
        windows: [{ id: "five_hour", label: "5h", percent: 55, resetsAt: Date.now() - 1 }],
        updatedAt: 1_000,
      };
      const readPlanUsage = jest
        .fn()
        .mockResolvedValueOnce({ kind: "usage", planUsage: expiring })
        .mockResolvedValue({ kind: "unavailable" });
      const backend = await makeBackend(readPlanUsage);
      backend.registerSessionHandler("s1", jest.fn());
      await settle();

      const later = jest.fn();
      backend.registerSessionHandler("s2", later);

      expect(planEvents(later)).toHaveLength(0);
    });

    it("keeps the last good snapshot when a later read is unusable or throws", async () => {
      const readPlanUsage = jest
        .fn()
        .mockResolvedValueOnce(USAGE_READING)
        .mockResolvedValueOnce({ kind: "unavailable" })
        .mockRejectedValueOnce(new Error("endpoint gone"));
      const backend = await makeBackend(readPlanUsage);
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler);
      await settle();

      for (let turn = 0; turn < 2; turn++) {
        await backend.prompt({ sessionId: "s1", prompt: [] });
        await settle();
      }

      // One published event, and the snapshot still replays — a failed read is "no
      // news", never a reason to blank a meter the user is reading.
      expect(planEvents(handler)).toHaveLength(1);
      const later = jest.fn();
      backend.registerSessionHandler("s2", later);
      expect(planEvents(later)).toHaveLength(1);
    });

    it("clears the meters when a read says this login has no caps", async () => {
      // "None" is an explicit provider statement — an unmetered login — not a failed
      // read, so caps still on screen describe an account the user is no longer on.
      const readPlanUsage = jest
        .fn()
        .mockResolvedValueOnce(USAGE_READING)
        .mockResolvedValue({ kind: "none" });
      const backend = await makeBackend(readPlanUsage);
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler);
      await settle();
      handler.mockClear();

      await backend.prompt({ sessionId: "s1", prompt: [] });
      await settle();

      expect(planEvents(handler)).toEqual([
        { sessionId: "s1", update: { sessionUpdate: "plan_usage_update", planUsage: null } },
      ]);
    });

    it("re-reads rather than reusing a snapshot from before the backend restarted", async () => {
      // A backend that starts again may be pointed at different credentials, so the
      // snapshot cannot outlive it — otherwise the first chat back shows the previous
      // account's caps.
      const reauthed = {
        windows: [{ id: "weekly", label: "Weekly", percent: 3 }],
        updatedAt: 3_000,
      };
      const readPlanUsage = jest
        .fn()
        .mockResolvedValueOnce(USAGE_READING)
        .mockResolvedValue({ kind: "usage", planUsage: reauthed });
      const backend = await makeBackend(readPlanUsage);
      backend.registerSessionHandler("s1", jest.fn());
      await settle();

      await backend.shutdown();
      await backend.start();
      const afterRestart = jest.fn();
      backend.registerSessionHandler("s2", afterRestart);
      await settle();

      expect(planEvents(afterRestart)).toEqual([
        { sessionId: "s2", update: { sessionUpdate: "plan_usage_update", planUsage: reauthed } },
      ]);
    });

    it("shares one read among chats that attach while it is in flight", async () => {
      // Several chats restoring at startup must not fire one account read each, and an
      // early success must not be discarded because a later duplicate failed.
      let release!: (reading: unknown) => void;
      const readPlanUsage = jest
        .fn()
        .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
        .mockResolvedValue({ kind: "unavailable" });
      const backend = await makeBackend(readPlanUsage);
      const first = jest.fn();
      const second = jest.fn();
      backend.registerSessionHandler("s1", first);
      backend.registerSessionHandler("s2", second); // joins s1's in-flight read

      release({ kind: "usage", planUsage: PLAN_USAGE });
      await settle();

      expect(planEvents(first)).toHaveLength(1);
      expect(planEvents(second)).toHaveLength(1);
      // The joined trigger queues at most one follow-up read; no read per attach.
      expect(readPlanUsage.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it("ignores an older read that resolves after a newer one", async () => {
      // An attach-time read and a turn-end read can be in flight together, and nothing
      // promises they resolve in start order. The older answer arriving last must not
      // roll the meters backward.
      const fresh = {
        windows: [{ id: "weekly", label: "Weekly", percent: 40 }],
        updatedAt: 2_000,
      };
      let releaseStaleRead!: (reading: unknown) => void;
      const readPlanUsage = jest
        .fn()
        .mockReturnValueOnce(new Promise((resolve) => (releaseStaleRead = resolve)))
        .mockResolvedValue({ kind: "usage", planUsage: fresh });
      const backend = await makeBackend(readPlanUsage);
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler); // starts the read that will stall

      await backend.prompt({ sessionId: "s1", prompt: [] }); // starts the newer read
      await settle();
      releaseStaleRead({ kind: "usage", planUsage: PLAN_USAGE }); // the 13% snapshot
      await settle();

      const events = planEvents(handler) as { update: { planUsage: unknown } }[];
      expect(events[events.length - 1]?.update.planUsage).toEqual(fresh);
      // And the stale answer must not have replaced the cached snapshot either.
      const later = jest.fn();
      backend.registerSessionHandler("s2", later);
      const replayed = planEvents(later) as { update: { planUsage: unknown } }[];
      expect(replayed[0]?.update.planUsage).toEqual(fresh);
    });

    it("drops a read that resolves after the backend shut down", async () => {
      // Without this, a slow read races shutdown(): its answer lands after the reset,
      // survives into the next start(), and the first chat back replays caps from an
      // account the backend may no longer be authenticated as.
      let releaseFirstRead!: (reading: unknown) => void;
      const readPlanUsage = jest
        .fn()
        .mockReturnValueOnce(new Promise((resolve) => (releaseFirstRead = resolve)))
        .mockResolvedValue({ kind: "unavailable" });
      const backend = await makeBackend(readPlanUsage);
      backend.registerSessionHandler("s1", jest.fn()); // triggers the slow read

      await backend.shutdown();
      releaseFirstRead(USAGE_READING);
      await settle();

      await backend.start();
      const afterRestart = jest.fn();
      backend.registerSessionHandler("s2", afterRestart);
      await settle();

      expect(planEvents(afterRestart)).toHaveLength(0);
    });

    it("stays quiet for a backend that has no plan caps to report", async () => {
      const backend = await makeBackend();
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler);

      await backend.prompt({ sessionId: "s1", prompt: [] });
      await settle();

      expect(planEvents(handler)).toHaveLength(0);
    });
  });

  describe("per-model cap applicability", () => {
    const PLAN_USAGE = {
      windows: [{ id: "weekly", label: "Weekly", percent: 13 }],
      updatedAt: 1_000,
    };
    const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0));

    function lastPlanEvent(handler: jest.Mock): { update: { planUsage: unknown } } | undefined {
      const events = handler.mock.calls
        .map(([e]) => e)
        .filter((e) => e.update.sessionUpdate === "plan_usage_update");
      return events[events.length - 1];
    }

    /**
     * Backend gated the way OpencodeBackend is: the account caps meter only sessions on
     * a `metered/` model. Two sessions are opened on different models so one broadcast
     * exercises both sides of the gate.
     */
    async function makeGatedSessions(): Promise<{
      backend: AcpBackendProcess;
      readPlanUsage: jest.Mock;
      metered: jest.Mock;
      unmetered: jest.Mock;
    }> {
      const readPlanUsage = jest.fn().mockResolvedValue({ kind: "usage", planUsage: PLAN_USAGE });
      const backend = new AcpBackendProcess(
        buildApp(),
        {
          ...buildStubBackend(),
          readPlanUsage,
          planUsageAppliesTo: (wireModelId: string | null | undefined) =>
            typeof wireModelId === "string" && wireModelId.startsWith("metered/"),
        },
        "1.0.0",
        buildStubDescriptor({
          wire: {
            encode: (selection: { baseModelId: string }) => selection.baseModelId,
            decode: (wireId: string) => ({
              selection: { baseModelId: wireId },
              provider: null,
            }),
          },
        } as unknown as Partial<BackendDescriptor>)
      );
      await backend.start();
      mockNewSession.mockResolvedValueOnce({
        sessionId: "s-metered",
        models: { availableModels: [], currentModelId: "metered/gemini-3-pro" },
      } as unknown as { sessionId: string });
      await backend.newSession({ cwd: "/vault" });
      mockNewSession.mockResolvedValueOnce({
        sessionId: "s-byok",
        models: { availableModels: [], currentModelId: "google/gemini-3-pro" },
      } as unknown as { sessionId: string });
      await backend.newSession({ cwd: "/vault" });
      const metered = jest.fn();
      const unmetered = jest.fn();
      backend.registerSessionHandler("s-metered", metered);
      backend.registerSessionHandler("s-byok", unmetered);
      await settle();
      return { backend, readPlanUsage, metered, unmetered };
    }

    it("shows the caps only to sessions whose model bills the metered account", async () => {
      // Selection is the whole test: a session on the user's own key shares the process
      // but not the billing, and must see no cap meters.
      const { metered, unmetered } = await makeGatedSessions();

      expect(lastPlanEvent(metered)?.update.planUsage).toEqual(PLAN_USAGE);
      expect(lastPlanEvent(unmetered)?.update.planUsage).toBeNull();
    });

    it("clears a session's meters the moment it switches off a metered model, without a new read", async () => {
      const { backend, readPlanUsage, metered } = await makeGatedSessions();
      const readsBefore = readPlanUsage.mock.calls.length;

      await backend.setSessionModel({ sessionId: "s-metered", modelId: "google/gemini-3-pro" });

      expect(lastPlanEvent(metered)?.update.planUsage).toBeNull();
      expect(readPlanUsage.mock.calls.length).toBe(readsBefore);
    });

    it("shows the cached snapshot the moment a session switches onto a metered model", async () => {
      const { backend, unmetered } = await makeGatedSessions();

      await backend.setSessionModel({ sessionId: "s-byok", modelId: "metered/kimi-k2" });

      expect(lastPlanEvent(unmetered)?.update.planUsage).toEqual(PLAN_USAGE);
    });
  });

  describe("backend-supplied context window", () => {
    const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0));

    function usageEvents(handler: jest.Mock): { update: { usage: Record<string, unknown> } }[] {
      return handler.mock.calls
        .map(([e]) => e)
        .filter((e) => e.update.sessionUpdate === "usage_update");
    }

    /**
     * Backend whose agent advertises a current model on `session/new`, wired the way
     * OpencodeBackend is: the process asks `readContextWindow` with the wire model id.
     */
    async function makeBackend(
      readContextWindow: jest.Mock
    ): Promise<{ backend: AcpBackendProcess; handler: jest.Mock }> {
      mockNewSession.mockResolvedValue({
        sessionId: "s1",
        models: { availableModels: [], currentModelId: "copilot-plus/gemini-3-pro" },
      } as unknown as { sessionId: string });
      const backend = new AcpBackendProcess(
        buildApp(),
        { ...buildStubBackend(), readContextWindow },
        "1.0.0",
        buildStubDescriptor(modelCapableDescriptor())
      );
      await backend.start();
      await backend.newSession({ cwd: "/vault" });
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler);
      return { backend, handler };
    }

    /** Enough descriptor for `computeState` to translate a `models` wire state. */
    function modelCapableDescriptor(): Partial<BackendDescriptor> {
      return {
        wire: {
          encode: (selection: { baseModelId: string }) => selection.baseModelId,
          decode: (wireId: string) => ({
            selection: { baseModelId: wireId },
            provider: null,
          }),
        },
      } as unknown as Partial<BackendDescriptor>;
    }

    function sendUsage(backend: AcpBackendProcess, used: number, size?: number): Promise<void> {
      const client = getVaultClient(backend);
      return client.sessionUpdate({
        sessionId: "s1",
        update: { sessionUpdate: "usage_update", used, ...(size ? { size } : {}) },
      } as unknown as Parameters<typeof client.sessionUpdate>[0]);
    }

    it("answers readContextWindow from one backend read, cached per model", async () => {
      // The public seam a session uses to size a reopened chat's ring at seed time.
      const readContextWindow = jest.fn().mockResolvedValue(1_048_576);
      const { backend } = await makeBackend(readContextWindow);

      await expect(backend.readContextWindow("copilot-plus/gemini-3-pro")).resolves.toBe(1_048_576);
      await expect(backend.readContextWindow("copilot-plus/gemini-3-pro")).resolves.toBe(1_048_576);
      expect(readContextWindow).toHaveBeenCalledTimes(1);
      await expect(backend.readContextWindow(null)).resolves.toBeNull();
    });

    it("republishes a windowless usage snapshot once the backend has supplied the window", async () => {
      const readContextWindow = jest.fn().mockResolvedValue(1_048_576);
      const { backend, handler } = await makeBackend(readContextWindow);

      await sendUsage(backend, 5_000);
      await settle();

      expect(readContextWindow).toHaveBeenCalledWith("copilot-plus/gemini-3-pro");
      const events = usageEvents(handler);
      expect(events[events.length - 1].update.usage).toMatchObject({
        usedTokens: 5_000,
        contextWindow: 1_048_576,
      });
    });

    it("enriches later snapshots inline, not a beat behind", async () => {
      // AgentSession ignores a windowless snapshot once it holds a windowed one, so an
      // async-only fill would fight every later live update and stall the meter.
      const readContextWindow = jest.fn().mockResolvedValue(1_048_576);
      const { backend, handler } = await makeBackend(readContextWindow);
      await sendUsage(backend, 5_000);
      await settle();
      handler.mockClear();

      await sendUsage(backend, 6_000);

      expect(usageEvents(handler)).toEqual([
        expect.objectContaining({
          update: expect.objectContaining({
            usage: expect.objectContaining({ usedTokens: 6_000, contextWindow: 1_048_576 }),
          }),
        }),
      ]);
      expect(readContextWindow).toHaveBeenCalledTimes(1);
    });

    it("discards a window answer that arrives after the session switched models", async () => {
      // Republishing the old model's snapshot would hand AgentSession a windowed
      // reading it treats as authoritative, re-freezing the ring its model-change
      // handling just cleared.
      let release!: (window: number) => void;
      const readContextWindow = jest.fn(() => new Promise((resolve) => (release = resolve)));
      const { backend, handler } = await makeBackend(readContextWindow);

      await sendUsage(backend, 5_000); // windowless: starts the catalog read
      await backend.setSessionModel({ sessionId: "s1", modelId: "ollama/llama" });
      handler.mockClear();
      release(1_048_576);
      await settle();

      expect(usageEvents(handler)).toHaveLength(0);
    });

    it("leaves a window the wire itself reported alone", async () => {
      const readContextWindow = jest.fn().mockResolvedValue(1_048_576);
      const { backend, handler } = await makeBackend(readContextWindow);

      await sendUsage(backend, 5_000, 200_000);

      expect(readContextWindow).not.toHaveBeenCalled();
      expect(usageEvents(handler)[0].update.usage).toMatchObject({ contextWindow: 200_000 });
    });

    it("asks again after an unanswered read instead of caching the failure", async () => {
      // The backend answers null both for a model it does not know and for a catalog it
      // could not reach, so remembering null would turn one transient failure into a
      // bare token count for the rest of the session.
      const readContextWindow = jest.fn().mockResolvedValueOnce(null).mockResolvedValue(1_048_576);
      const { backend, handler } = await makeBackend(readContextWindow);

      await sendUsage(backend, 5_000);
      await settle();
      await sendUsage(backend, 6_000);
      await settle();

      expect(readContextWindow).toHaveBeenCalledTimes(2);
      const events = usageEvents(handler);
      expect(events[events.length - 1].update.usage).toMatchObject({ contextWindow: 1_048_576 });
    });

    it("passes the snapshot through untouched when the session's model is unknown", async () => {
      const readContextWindow = jest.fn().mockResolvedValue(1_048_576);
      mockNewSession.mockResolvedValue({ sessionId: "s1" }); // no models state at all
      const backend = new AcpBackendProcess(
        buildApp(),
        { ...buildStubBackend(), readContextWindow },
        "1.0.0",
        buildStubDescriptor()
      );
      await backend.start();
      await backend.newSession({ cwd: "/vault" });
      const handler = jest.fn();
      backend.registerSessionHandler("s1", handler);

      await sendUsage(backend, 5_000);
      await settle();

      expect(readContextWindow).not.toHaveBeenCalled();
      expect(usageEvents(handler)).toHaveLength(1);
      expect(usageEvents(handler)[0].update.usage.contextWindow).toBeUndefined();
    });
  });
});
