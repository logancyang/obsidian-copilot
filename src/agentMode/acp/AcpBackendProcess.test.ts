import { FileSystemAdapter, App } from "obsidian";
import { AcpBackendProcess } from "./AcpBackendProcess";
import type { AcpBackend } from "./types";
import type { VaultClient } from "./VaultClient";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

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
  });

  it("routes session updates to the matching session handler and drops unknown ones", async () => {
    const backend = new AcpBackendProcess(buildApp(), buildStubBackend(), "1.0.0");
    await backend.start();

    const handler = jest.fn();
    backend.registerSessionHandler("session-known", handler);

    const client = getVaultClient(backend);
    const knownUpdate = {
      sessionId: "session-known",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
    } as unknown as Parameters<typeof client.sessionUpdate>[0];
    await client.sessionUpdate(knownUpdate);
    expect(handler).toHaveBeenCalledWith(knownUpdate);

    const strayUpdate = {
      sessionId: "session-unknown",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } },
    } as unknown as Parameters<typeof client.sessionUpdate>[0];
    await expect(client.sessionUpdate(strayUpdate)).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns cancelled outcome when permission is requested but no prompter is registered", async () => {
    const backend = new AcpBackendProcess(buildApp(), buildStubBackend(), "1.0.0");
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

  it("delegates to the registered prompter and forwards the response", async () => {
    const backend = new AcpBackendProcess(buildApp(), buildStubBackend(), "1.0.0");
    await backend.start();

    const prompter = jest
      .fn()
      .mockResolvedValue({ outcome: { outcome: "selected", optionId: "ok" } });
    backend.setPermissionPrompter(prompter);

    const client = getVaultClient(backend);
    const req = {
      sessionId: "s1",
      toolCall: { toolCallId: "tc1", title: "Read" },
      options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }],
    } as unknown as Parameters<typeof client.requestPermission>[0];
    const response = await client.requestPermission(req);
    expect(prompter).toHaveBeenCalledWith(req);
    expect(response).toEqual({ outcome: { outcome: "selected", optionId: "ok" } });
  });

  it("clears connection state on subprocess exit so subsequent ops fail with a clear error", async () => {
    const backend = new AcpBackendProcess(buildApp(), buildStubBackend(), "1.0.0");
    await backend.start();
    const handler = jest.fn();
    backend.registerSessionHandler("s1", handler);

    // Simulate the subprocess dying.
    mockProcessIsRunning = false;
    for (const fn of exitListeners) fn();

    await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toThrow(/has exited/);
    // Stale handlers should be cleared so the demux doesn't fire on a dead
    // backend if a stray notification slipped through.
    expect(backend.isRunning()).toBe(false);
  });

  it("throws if start() was never called", async () => {
    const backend = new AcpBackendProcess(buildApp(), buildStubBackend(), "1.0.0");
    await expect(backend.prompt({ sessionId: "s1", prompt: [] })).rejects.toThrow(/start\(\)/);
  });
});
