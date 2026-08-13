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

function buildStubBackend(): AcpBackend {
  return {
    id: "opencode",
    displayName: "opencode",
    buildSpawnDescriptor: jest.fn().mockResolvedValue({
      command: "/bin/true",
      args: [],
      env: {},
    }),
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
});
