import { FileSystemAdapter, App } from "obsidian";
import type { BackendDescriptor, PermissionOption } from "@/agentMode/session/types";
import { AcpBackendProcess } from "./AcpBackendProcess";
import { AcpProcessManager } from "./AcpProcessManager";
import type { AcpBackend } from "./types";
import type { VaultClient } from "./VaultClient";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { RequestError, type SessionConfigOption } from "@agentclientprotocol/sdk";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

let mockInitializeResult: unknown = { protocolVersion: 1 };
const mockNewSession = jest.fn(async (..._args: unknown[]) => ({ sessionId: "test-session" }));
const mockResumeSession = jest.fn(async (..._args: unknown[]) => ({}));
const mockCloseSession = jest.fn(async (..._args: unknown[]) => ({}));
const mockSetSessionConfigOption = jest.fn(async (params: { value: string }) => ({
  configOptions: modelOptions(params.value),
}));
const mockLoadSession = jest.fn(async (..._args: unknown[]) => ({}));
const mockListSessions = jest.fn(async (..._args: unknown[]) => ({ sessions: [] }));
const mockInitializeRequest = jest.fn();

jest.mock("@agentclientprotocol/sdk", () => {
  class RequestError extends Error {
    code: number;
    constructor(code: number, message?: string) {
      super(message);
      this.code = code;
      this.name = "RequestError";
    }
  }
  let inbound: ReadableStreamDefaultController<unknown> | null = null;
  function ndJsonStream() {
    return {
      readable: new ReadableStream<unknown>({
        start(controller) {
          inbound = controller;
        },
      }),
      writable: new WritableStream<unknown>(),
    };
  }
  function client() {
    const handlers: Record<
      string,
      (context: { params: unknown; requestId?: string; signal?: AbortSignal }) => unknown
    > = {};
    const builder = {
      onRequest(method: string, handler: (context: { params: unknown }) => unknown) {
        handlers[method] = handler;
        return builder;
      },
      onNotification(method: string, handler: (context: { params: unknown }) => unknown) {
        handlers[method] = handler;
        return builder;
      },
      connect(stream: { readable: ReadableStream<unknown> }) {
        const source = inbound!;
        const reader = stream.readable.getReader();
        const prompt = jest.fn(async () => ({ stopReason: "end_turn" }));
        const requests: Record<string, (params: unknown) => unknown> = {
          initialize: async (params: unknown) => {
            mockInitializeRequest(params);
            return mockInitializeResult;
          },
          "session/new": mockNewSession,
          "session/resume": mockResumeSession,
          "session/close": mockCloseSession,
          "session/load": mockLoadSession,
          "session/list": mockListSessions,
          "session/prompt": prompt,
          "session/set_config_option": (params) =>
            mockSetSessionConfigOption(params as { value: string }),
        };
        return {
          prompt,
          _client: {
            sessionUpdate: async (params: unknown) => {
              source.enqueue({ jsonrpc: "2.0", method: "session/update", params });
              source.enqueue({ jsonrpc: "2.0", id: "after-update", result: null });
              await reader.read();
            },
            requestPermission: (params: unknown) =>
              handlers["session/request_permission"]({ params }),
            createElicitation: (params: unknown, requestId: string, signal: AbortSignal) =>
              handlers["elicitation/create"]({ params, requestId, signal }),
          },
          agent: {
            request: async (method: string, params: unknown) => {
              const result = await requests[method](params);
              source.enqueue({ jsonrpc: "2.0", id: method, result });
              await reader.read();
              return result;
            },
            notify: jest.fn(async () => undefined),
          },
        };
      },
    };
    return builder;
  }
  return {
    RequestError,
    client,
    ndJsonStream,
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

const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0));

function serviceFailure(): RequestError {
  return new RequestError(-32603, "Internal error: Internal service failure");
}

function buildApp(basePath = "/vault"): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(basePath);
  return {
    vault: { adapter, getName: () => basePath.split(/[/\\]/).filter(Boolean).at(-1) ?? "" },
  } as unknown as App;
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

function getVaultClient(backend: AcpBackendProcess): VaultClient {
  const connection = (backend as unknown as { connection: { _client: VaultClient } }).connection;
  return connection._client;
}

function modelOptions(currentValue: string): SessionConfigOption[] {
  return [
    {
      id: "active-model",
      type: "select",
      category: "model",
      name: "Model",
      currentValue,
      options: ["model-a", "model-b", currentValue].map((value) => ({ value, name: value })),
    },
  ];
}

function modelDescriptor(): BackendDescriptor {
  return buildStubDescriptor({
    wire: {
      encode: (selection) => selection.baseModelId,
      decode: (wireId) => ({ selection: { baseModelId: wireId, effort: null }, provider: null }),
    },
  });
}

describe("AcpBackendProcess", () => {
  describe("AcpBackendProcess", () => {
    beforeEach(() => {
      exitListeners.clear();
      mockProcessIsRunning = true;
      mockInitializeResult = { protocolVersion: 1 };
      mockInitializeRequest.mockClear();
      mockNewSession.mockClear();
      mockNewSession.mockResolvedValue({ sessionId: "test-session" });
      mockResumeSession.mockClear();
      mockResumeSession.mockResolvedValue({});
      mockCloseSession.mockReset();
      mockCloseSession.mockResolvedValue({});
      mockListSessions.mockReset();
      mockListSessions.mockResolvedValue({ sessions: [] });
      mockSetSessionConfigOption.mockReset();
      mockSetSessionConfigOption.mockImplementation(async ({ value }) => ({
        configOptions: modelOptions(value),
      }));
      mockLoadSession.mockClear();
      mockLoadSession.mockResolvedValue({});
    });

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

    describe("setSessionModel()", () => {
      async function openModelSession() {
        mockNewSession.mockResolvedValue({
          sessionId: "s1",
          configOptions: modelOptions("model-a"),
        } as { sessionId: string });
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          modelDescriptor()
        );
        await backend.start();
        await backend.newSession({ cwd: "/vault" });
        return backend;
      }

      it("switches through the advertised model config id and returns the agent's refreshed catalog https://github.com/Brevilabs/obsidian-copilot-private/issues/550", async () => {
        const backend = await openModelSession();
        const state = await backend.setSessionModel({ sessionId: "s1", modelId: "model-b" });
        expect(mockSetSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "s1",
          configId: "active-model",
          value: "model-b",
        });
        expect(state.model?.current.baseModelId).toBe("model-b");
        expect(state.model?.apply).toEqual({ kind: "setConfigOption", configId: "active-model" });
        expect(backend.isSetSessionModelSupported()).toBe(true);
      });

      it("preserves the active model when the agent rejects a switch https://github.com/Brevilabs/obsidian-copilot-private/issues/550", async () => {
        const backend = await openModelSession();
        mockSetSessionConfigOption.mockRejectedValueOnce(new Error("Model unavailable"));
        await expect(
          backend.setSessionModel({ sessionId: "s1", modelId: "model-b" })
        ).rejects.toThrow("Model unavailable");
        const state = (
          backend as unknown as {
            computeState(id: string): import("@/agentMode/session/types").BackendState;
          }
        ).computeState("s1");
        expect(state.model?.current.baseModelId).toBe("model-a");
      });

      it("reports unsupported switching when the session advertises no model option https://github.com/Brevilabs/obsidian-copilot-private/issues/550", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          modelDescriptor()
        );
        await backend.start();
        await backend.newSession({ cwd: "/vault" });
        await expect(
          backend.setSessionModel({ sessionId: "test-session", modelId: "model-b" })
        ).rejects.toBeInstanceOf(MethodUnsupportedError);
        expect(mockSetSessionConfigOption).not.toHaveBeenCalled();
      });
    });

    describe("closeSession()", () => {
      it("releases only the requested session and keeps the shared backend running https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        mockInitializeResult = {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { close: {} } },
        };
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        const sibling = jest.fn();
        backend.registerSessionHandler("sibling", sibling);
        await backend.closeSession({ sessionId: "closed" });
        expect(mockCloseSession).toHaveBeenCalledWith({ sessionId: "closed" });
        expect(backend.isRunning()).toBe(true);
        await getVaultClient(backend).sessionUpdate({
          sessionId: "sibling",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "still here" },
          },
        });
        expect(sibling).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sibling" }));
      });

      it("rejects unsupported close without sending a request https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        await expect(backend.closeSession({ sessionId: "open" })).rejects.toThrow(
          "Agent does not implement session/close"
        );
        expect(mockCloseSession).not.toHaveBeenCalled();
        expect(backend.isRunning()).toBe(true);
      });
    });

    describe("start()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/555 forwards the backend's process directory to subprocess creation", async () => {
        const agentBackend = buildStubBackend({
          buildSpawnDescriptor: jest.fn().mockResolvedValue({
            command: "/bin/agent",
            args: ["acp"],
            cwd: "/Volumes/Notes/Main Vault",
            env: {},
          }),
        });
        const backend = new AcpBackendProcess(
          buildApp(),
          agentBackend,
          "1.0.0",
          buildStubDescriptor()
        );

        await backend.start();

        expect(AcpProcessManager).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: "/Volumes/Notes/Main Vault" })
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 passes the active vault identity to the shared process used by global and Project sessions", async () => {
        const agentBackend = buildStubBackend();
        const backend = new AcpBackendProcess(
          buildApp("/Volumes/Notes/Main Vault"),
          agentBackend,
          "1.0.0",
          buildStubDescriptor()
        );

        await backend.start();

        expect(agentBackend.buildSpawnDescriptor).toHaveBeenCalledWith({
          vaultBasePath: "/Volumes/Notes/Main Vault",
          vaultName: "Main Vault",
        });
      });

      it("advertises plan updates so an agent sends proposed plans outside the chat text (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );

        await backend.start();

        expect(mockInitializeRequest).toHaveBeenCalledWith(
          expect.objectContaining({ clientCapabilities: expect.objectContaining({ plan: {} }) })
        );
      });

      it("sends the backend's client capability metadata so it can opt into agent extensions https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend({ clientCapabilitiesMeta: { vendor: { feature: true } } }),
          "1.0.0",
          buildStubDescriptor()
        );

        await backend.start();

        expect(mockInitializeRequest.mock.calls[0][0].clientCapabilities._meta).toEqual({
          vendor: { feature: true },
        });
      });

      it("sends no capability metadata for a backend that declares none", async () => {
        await startBackend();

        expect(mockInitializeRequest.mock.calls[0][0].clientCapabilities).not.toHaveProperty(
          "_meta"
        );
      });
    });

    describe("registerSessionHandler()", () => {
      it("delivers a session update to the handler registered for that session and ignores updates for unknown sessions", async () => {
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

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 replays a catalog update that arrived before the handler as the session's refreshed state", async () => {
        mockNewSession.mockResolvedValue({
          sessionId: "s-late",
          configOptions: modelOptions("model-a"),
        } as { sessionId: string });
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          modelDescriptor()
        );
        await backend.start();
        await backend.newSession({ cwd: "/vault" });
        const client = getVaultClient(backend);
        await client.sessionUpdate({
          sessionId: "s-late",
          update: {
            sessionUpdate: "config_option_update",
            configOptions: modelOptions("model-late"),
          },
        } as unknown as Parameters<typeof client.sessionUpdate>[0]);

        const handler = jest.fn();
        backend.registerSessionHandler("s-late", handler);

        const replayed = handler.mock.calls
          .map(([event]) => event.update)
          .filter((update) => update.sessionUpdate !== "plan_usage_update");
        expect(replayed).toHaveLength(1);
        expect(replayed[0].sessionUpdate).toBe("state_changed");
        expect(replayed[0].state.model.current.baseModelId).toBe("model-late");
        expect(
          replayed[0].state.model.availableModels.map(
            (entry: { baseModelId: string }) => entry.baseModelId
          )
        ).toContain("model-late");
      });

      it("tracks todowrite tool ids per session so an id registered in one session does not synthesize a plan in another", async () => {
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

      it("keeps a session's todo tracking when its handler is re-registered and the stale unsubscribe then runs", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        const client = getVaultClient(backend);

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
        backend.registerSessionHandler("sess-X", fresh);
        stale();

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

      it("drops todo tracking when the subprocess exits so a restarted process starts clean", async () => {
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

      describe("plan usage snapshots", () => {
        const PLAN_USAGE = {
          windows: [{ id: "weekly", label: "Weekly", percent: 13 }],
          updatedAt: 1_000,
        };
        const USAGE_READING = { kind: "usage", planUsage: PLAN_USAGE };

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
          const backend = await makeBackend(jest.fn().mockResolvedValue(USAGE_READING));
          const handler = jest.fn();

          backend.registerSessionHandler("s1", handler);
          await settle();

          expect(planEvents(handler)).toEqual([
            {
              sessionId: "s1",
              update: { sessionUpdate: "plan_usage_update", planUsage: PLAN_USAGE },
            },
          ]);
        });

        it("republishes the caps a turn moved, to every attached session", async () => {
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
            {
              sessionId: "s2",
              update: { sessionUpdate: "plan_usage_update", planUsage: PLAN_USAGE },
            },
          ]);
          expect(readPlanUsage).toHaveBeenCalledTimes(1);
        });

        it("drops an expired window instead of replaying it (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
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

          expect(planEvents(handler)).toHaveLength(1);
          const later = jest.fn();
          backend.registerSessionHandler("s2", later);
          expect(planEvents(later)).toHaveLength(1);
        });

        it("clears the meters when a read says this login has no caps", async () => {
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
            {
              sessionId: "s2",
              update: { sessionUpdate: "plan_usage_update", planUsage: reauthed },
            },
          ]);
        });

        it("shares one read among chats that attach while it is in flight", async () => {
          let release!: (reading: unknown) => void;
          const readPlanUsage = jest
            .fn()
            .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
            .mockResolvedValue({ kind: "unavailable" });
          const backend = await makeBackend(readPlanUsage);
          const first = jest.fn();
          const second = jest.fn();
          backend.registerSessionHandler("s1", first);
          backend.registerSessionHandler("s2", second);

          release({ kind: "usage", planUsage: PLAN_USAGE });
          await settle();

          expect(planEvents(first)).toHaveLength(1);
          expect(planEvents(second)).toHaveLength(1);
          expect(readPlanUsage.mock.calls.length).toBeLessThanOrEqual(2);
        });

        it("ignores an older read that resolves after a newer one", async () => {
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
          backend.registerSessionHandler("s1", handler);

          await backend.prompt({ sessionId: "s1", prompt: [] });
          await settle();
          releaseStaleRead({ kind: "usage", planUsage: PLAN_USAGE });
          await settle();

          const events = planEvents(handler) as { update: { planUsage: unknown } }[];
          expect(events[events.length - 1]?.update.planUsage).toEqual(fresh);
          const later = jest.fn();
          backend.registerSessionHandler("s2", later);
          const replayed = planEvents(later) as { update: { planUsage: unknown } }[];
          expect(replayed[0]?.update.planUsage).toEqual(fresh);
        });

        it("drops a read that resolves after the backend shut down", async () => {
          let releaseFirstRead!: (reading: unknown) => void;
          const readPlanUsage = jest
            .fn()
            .mockReturnValueOnce(new Promise((resolve) => (releaseFirstRead = resolve)))
            .mockResolvedValue({ kind: "unavailable" });
          const backend = await makeBackend(readPlanUsage);
          backend.registerSessionHandler("s1", jest.fn());

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

      describe("per-model plan usage applicability", () => {
        const PLAN_USAGE = {
          windows: [{ id: "weekly", label: "Weekly", percent: 13 }],
          updatedAt: 1_000,
        };

        function lastPlanEvent(handler: jest.Mock): { update: { planUsage: unknown } } | undefined {
          const events = handler.mock.calls
            .map(([e]) => e)
            .filter((e) => e.update.sessionUpdate === "plan_usage_update");
          return events[events.length - 1];
        }

        async function makeGatedSessions(): Promise<{
          backend: AcpBackendProcess;
          readPlanUsage: jest.Mock;
          metered: jest.Mock;
          unmetered: jest.Mock;
        }> {
          const readPlanUsage = jest
            .fn()
            .mockResolvedValue({ kind: "usage", planUsage: PLAN_USAGE });
          const backend = new AcpBackendProcess(
            buildApp(),
            {
              ...buildStubBackend(),
              readPlanUsage,
              planUsageAppliesTo: (wireModelId: string | null | undefined) =>
                typeof wireModelId === "string" && wireModelId.startsWith("metered/"),
            },
            "1.0.0",
            modelDescriptor()
          );
          await backend.start();
          mockNewSession.mockResolvedValueOnce({
            sessionId: "s-metered",
            configOptions: modelOptions("metered/gemini-3-pro"),
          } as unknown as { sessionId: string });
          await backend.newSession({ cwd: "/vault" });
          mockNewSession.mockResolvedValueOnce({
            sessionId: "s-byok",
            configOptions: modelOptions("google/gemini-3-pro"),
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
    });

    describe("setPermissionPrompter()", () => {
      it("presents each option through the backend's presentation hook with its opaque metadata before handing the request to the prompter", async () => {
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

      it("answers a permission request with a cancelled outcome when no prompter is registered", async () => {
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
    });

    describe("setAskUserQuestionPrompter()", () => {
      const form = {
        mode: "form",
        sessionId: "s1",
        message: "Choose an approach",
        requestedSchema: {
          type: "object",
          required: ["approach"],
          properties: {
            approach: {
              type: "string",
              title: "Approach",
              _meta: { codex: { isOther: false } },
              oneOf: [
                { const: "simple", title: "Simple" },
                { const: "complex", title: "Complex" },
              ],
            },
          },
        },
      };

      async function openElicitationBackend() {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        const client = getVaultClient(backend) as VaultClient & {
          createElicitation: (
            params: unknown,
            requestId: string,
            signal: AbortSignal
          ) => Promise<unknown>;
        };
        return { backend, client };
      }

      it("advertises forms and returns field-id content from the owning session (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
        const { backend, client } = await openElicitationBackend();
        expect(mockInitializeRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            clientCapabilities: expect.objectContaining({ elicitation: { form: {} } }),
          })
        );
        const prompter = jest.fn().mockResolvedValue({ approach: "Simple" });
        backend.setAskUserQuestionPrompter(prompter);
        const signal = new AbortController().signal;
        const result = await client.createElicitation(form, "rpc-1", signal);
        expect(prompter).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: "s1",
            requestId: "rpc-1",
            questions: [expect.objectContaining({ answerKey: "approach" })],
            signal,
          })
        );
        expect(result).toEqual({ action: "accept", content: { approach: "simple" } });
      });

      it("returns cancel when the user dismisses the card (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
        const { backend, client } = await openElicitationBackend();
        backend.setAskUserQuestionPrompter(jest.fn().mockResolvedValue({}));
        await expect(
          client.createElicitation(form, "rpc-2", new AbortController().signal)
        ).resolves.toEqual({ action: "cancel" });
      });

      it("declines unsupported forms without displaying a card (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
        const { backend, client } = await openElicitationBackend();
        const prompter = jest.fn();
        backend.setAskUserQuestionPrompter(prompter);
        await expect(
          client.createElicitation(
            {
              ...form,
              requestedSchema: { type: "object", properties: { count: { type: "number" } } },
            },
            "rpc-3",
            new AbortController().signal
          )
        ).resolves.toEqual({ action: "decline" });
        expect(prompter).not.toHaveBeenCalled();
      });
    });

    describe("supportsAdditionalDirectories()", () => {
      it("reports no additional-directories support when the agent does not advertise the capability", async () => {
        mockInitializeResult = {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { list: {}, close: {} } },
        };
        const backend = await startBackend();
        expect(backend.supportsAdditionalDirectories()).toBe(false);
      });

      it("reports additional-directories support when the agent advertises the capability", async () => {
        mockInitializeResult = {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } },
        };
        const backend = await startBackend();
        expect(backend.supportsAdditionalDirectories()).toBe(true);
      });
    });

    describe("newSession()", () => {
      async function makeListingBackend(): Promise<AcpBackendProcess> {
        mockInitializeResult = {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { list: {} } },
        };
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        return backend;
      }

      it("forwards additionalDirectories to session/new when the agent advertises the capability", async () => {
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

      it("drops additionalDirectories from session/new when the agent lacks the capability", async () => {
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

      it("omits additionalDirectories from session/new when none are supplied", async () => {
        mockInitializeResult = {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } },
        };
        const backend = await startBackend();
        await backend.newSession({ cwd: "/vault" });
        const req = mockNewSession.mock.calls[0][0] as { additionalDirectories?: string[] };
        expect(req).not.toHaveProperty("additionalDirectories");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 requests recovery and explains the failure when a new chat finds the internal service stopped", async () => {
        const backend = await makeListingBackend();
        await backend.newSession({ cwd: "/vault" });
        const recover = jest.fn();
        backend.setUnhealthyHandler(recover);
        mockNewSession.mockRejectedValueOnce(serviceFailure());
        mockListSessions.mockRejectedValueOnce(serviceFailure());

        await expect(backend.newSession({ cwd: "/vault" })).rejects.toThrow(
          "opencode's internal service stopped. Please try again."
        );
        expect(recover).toHaveBeenCalledTimes(1);
      });

      it("https://github.com/anomalyco/opencode/issues/51716 rethrows the original error without recovery when the service still answers a session list", async () => {
        const backend = await makeListingBackend();
        await backend.newSession({ cwd: "/vault" });
        const recover = jest.fn();
        backend.setUnhealthyHandler(recover);
        const failure = serviceFailure();
        mockNewSession.mockRejectedValueOnce(failure);

        await expect(backend.newSession({ cwd: "/missing" })).rejects.toBe(failure);
        expect(recover).not.toHaveBeenCalled();
      });

      it("https://github.com/anomalyco/opencode/issues/51716 rethrows internal errors without probing when the agent cannot list sessions", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        await backend.newSession({ cwd: "/vault" });
        const recover = jest.fn();
        backend.setUnhealthyHandler(recover);
        const failure = serviceFailure();
        mockNewSession.mockRejectedValueOnce(failure);

        await expect(backend.newSession({ cwd: "/vault" })).rejects.toBe(failure);
        expect(mockListSessions).not.toHaveBeenCalled();
        expect(recover).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 reports a start failure without requesting recovery when the service fails before serving any session", async () => {
        const backend = await makeListingBackend();
        const recover = jest.fn();
        backend.setUnhealthyHandler(recover);
        mockNewSession.mockRejectedValueOnce(serviceFailure());
        mockListSessions.mockRejectedValueOnce(serviceFailure());

        await expect(backend.newSession({ cwd: "/vault" })).rejects.toThrow(
          "opencode's internal service failed to start. Check the Copilot log for its error."
        );
        expect(recover).not.toHaveBeenCalled();
      });
    });

    describe("resumeSession()", () => {
      it("forwards additionalDirectories to session/resume when the agent advertises the capability", async () => {
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

      it("drops additionalDirectories from session/resume when the agent lacks the capability", async () => {
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
    });

    describe("loadSession()", () => {
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

      it("forwards additionalDirectories to session/load when the agent advertises the capability", async () => {
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

      it("returns the session id and the state the agent reports", async () => {
        const backend = await startLoadCapableBackend();
        mockLoadSession.mockResolvedValueOnce({});

        const result = await backend.loadSession({ sessionId: "ses_load", cwd: "/vault" });

        expect(result.sessionId).toBe("ses_load");
        expect(result).not.toHaveProperty("transcript");
      });

      it("resolves only after the frames the agent replays ahead of its response reach the session's handler (https://github.com/Brevilabs/obsidian-copilot-private/issues/602)", async () => {
        const backend = await startLoadCapableBackend();
        const handler = jest.fn();
        backend.registerSessionHandler("ses_load", handler);
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

        await backend.loadSession({ sessionId: "ses_load", cwd: "/vault" });

        expect(handler.mock.calls.map((c) => c[0].update.sessionUpdate)).toEqual([
          "user_message_chunk",
          "agent_message_chunk",
        ]);
      });
    });

    describe("prompt()", () => {
      function promptMock(backend: AcpBackendProcess): jest.Mock {
        return (backend as unknown as { connection: { prompt: jest.Mock } }).connection.prompt;
      }

      async function makeBackend(): Promise<AcpBackendProcess> {
        mockInitializeResult = {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { list: {} } },
        };
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        return backend;
      }

      it("returns the turn diff its backend reads from the prompt result's metadata https://github.com/Brevilabs/obsidian-copilot-private/issues/347", async () => {
        const readTurnDiff = jest.fn(() => ({
          root: "/repo",
          unifiedDiff: "diff --git a/x b/x\n",
        }));
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend({ readTurnDiff }),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        promptMock(backend).mockResolvedValueOnce({
          stopReason: "end_turn",
          _meta: { vendor: { diff: "raw" } },
        });

        const result = await backend.prompt({ sessionId: "s1", prompt: [] });

        expect(readTurnDiff).toHaveBeenCalledWith({ vendor: { diff: "raw" } });
        expect(result).toEqual({
          stopReason: "end_turn",
          turnDiff: { root: "/repo", unifiedDiff: "diff --git a/x b/x\n" },
        });
      });

      it("returns only the stop reason for a backend that reads no turn diff", async () => {
        const backend = await makeBackend();
        promptMock(backend).mockResolvedValueOnce({
          stopReason: "end_turn",
          _meta: { vendor: { diff: "raw" } },
        });

        await expect(backend.prompt({ sessionId: "s1", prompt: [] })).resolves.toEqual({
          stopReason: "end_turn",
        });
      });

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
        expect(usageEvents[0].update.usage.contextWindow).toBeUndefined();
      });

      it("suppresses the prompt-result fallback once a live usage_update has been seen", async () => {
        const backend = await makeBackend();
        const handler = jest.fn();
        backend.registerSessionHandler("s1", handler);
        const client = getVaultClient(backend);

        await client.sessionUpdate({
          sessionId: "s1",
          update: { sessionUpdate: "usage_update", used: 5000, size: 200_000 },
        } as unknown as Parameters<typeof client.sessionUpdate>[0]);

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

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 requests recovery and explains the failure when the internal service stops", async () => {
        const backend = await makeBackend();
        await backend.newSession({ cwd: "/vault" });
        const recover = jest.fn();
        backend.setUnhealthyHandler(recover);
        promptMock(backend).mockRejectedValue(serviceFailure());
        mockListSessions.mockRejectedValueOnce(serviceFailure());

        await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toThrow(
          "opencode's internal service stopped. Please try again."
        );
        expect(recover).toHaveBeenCalledTimes(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 rethrows internal errors without requesting recovery while the service still answers a session list", async () => {
        const backend = await makeBackend();
        const recover = jest.fn();
        backend.setUnhealthyHandler(recover);
        const failure = new RequestError(-32603, "Internal error: Provider offline");
        promptMock(backend).mockRejectedValue(failure);

        await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toBe(failure);
        expect(recover).not.toHaveBeenCalled();
      });

      it("rejects with a has-exited error and reports not running after the subprocess exits", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await backend.start();
        const handler = jest.fn();
        backend.registerSessionHandler("s1", handler);

        mockProcessIsRunning = false;
        for (const fn of exitListeners) fn();

        await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toThrow(/has exited/);
        expect(backend.isRunning()).toBe(false);
      });

      it("rejects with a start() hint when the backend was never started", async () => {
        const backend = new AcpBackendProcess(
          buildApp(),
          buildStubBackend(),
          "1.0.0",
          buildStubDescriptor()
        );
        await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toThrow(/start\(\)/);
      });
    });

    describe("readContextWindow()", () => {
      function usageEvents(handler: jest.Mock): { update: { usage: Record<string, unknown> } }[] {
        return handler.mock.calls
          .map(([e]) => e)
          .filter((e) => e.update.sessionUpdate === "usage_update");
      }

      async function makeBackend(
        readContextWindow: jest.Mock
      ): Promise<{ backend: AcpBackendProcess; handler: jest.Mock }> {
        mockNewSession.mockResolvedValue({
          sessionId: "s1",
          configOptions: modelOptions("copilot-plus/gemini-3-pro"),
        } as unknown as { sessionId: string });
        const backend = new AcpBackendProcess(
          buildApp(),
          { ...buildStubBackend(), readContextWindow },
          "1.0.0",
          modelDescriptor()
        );
        await backend.start();
        await backend.newSession({ cwd: "/vault" });
        const handler = jest.fn();
        backend.registerSessionHandler("s1", handler);
        return { backend, handler };
      }

      function sendUsage(backend: AcpBackendProcess, used: number, size?: number): Promise<void> {
        const client = getVaultClient(backend);
        return client.sessionUpdate({
          sessionId: "s1",
          update: { sessionUpdate: "usage_update", used, ...(size ? { size } : {}) },
        } as unknown as Parameters<typeof client.sessionUpdate>[0]);
      }

      it("returns the backend-read window from one read per model and null for an unknown model", async () => {
        const readContextWindow = jest.fn().mockResolvedValue(1_048_576);
        const { backend } = await makeBackend(readContextWindow);

        await expect(backend.readContextWindow("copilot-plus/gemini-3-pro")).resolves.toBe(
          1_048_576
        );
        await expect(backend.readContextWindow("copilot-plus/gemini-3-pro")).resolves.toBe(
          1_048_576
        );
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
        let release!: (window: number) => void;
        const readContextWindow = jest.fn(() => new Promise((resolve) => (release = resolve)));
        const { backend, handler } = await makeBackend(readContextWindow);

        await sendUsage(backend, 5_000);
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
        const readContextWindow = jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(1_048_576);
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
        mockNewSession.mockResolvedValue({ sessionId: "s1" });
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
});
