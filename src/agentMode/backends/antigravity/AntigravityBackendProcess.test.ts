import { EventEmitter } from "node:events";
import { promisify } from "node:util";

import type { PromptContent, SessionEvent } from "@/agentMode/session/types";
import { requireNodeModule } from "@/utils/desktopRuntime";

import {
  AntigravityBackendProcess,
  type AntigravityChildProcess,
} from "./AntigravityBackendProcess";

jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: jest.fn(),
}));

class FakeChild extends EventEmitter implements AntigravityChildProcess {
  readonly stdin = { write: jest.fn(), end: jest.fn() };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = jest.fn(() => true);
}

const prompt: PromptContent[] = [{ type: "text", text: "<user>hello</user>" }];

describe("AntigravityBackendProcess", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("closes stdin when discovering models so agy exits after printing the catalog", async () => {
    const execFile = jest.fn(
      (
        _binaryPath: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        let stdinClosed = false;
        const child = {
          stdin: {
            end: jest.fn(() => {
              stdinClosed = true;
              callback(null, "model-a\tModel A\n", "Fetching available models...\n");
            }),
          },
        };
        window.setTimeout(() => {
          if (!stdinClosed) callback(new Error("agy models is still waiting for stdin"), "", "");
        }, 0);
        return child;
      }
    );
    jest.mocked(requireNodeModule).mockImplementation((id: string) => {
      if (id === "child_process") return { execFile };
      if (id === "util") return { promisify };
      throw new Error(`Unexpected Node module: ${id}`);
    });

    const backend = new AntigravityBackendProcess({ binaryPath: "agy" });

    await expect(backend.newSession({ cwd: "C:\\vault" })).resolves.toMatchObject({
      state: {
        model: {
          current: { baseModelId: "model-a" },
        },
      },
    });
    expect(execFile.mock.calls[0][0]).toBe("agy");
    expect(execFile.mock.calls[0][1]).toEqual(["models"]);
    expect(execFile.mock.results[0].value.stdin.end).toHaveBeenCalledTimes(1);
  });

  it("discovers models and streams text through the official CLI flags", async () => {
    const child = new FakeChild();
    const runModels = jest.fn(async () => "gemini-3.7-flash-high  Gemini 3.7 Flash (High)\n");
    const spawnProcess = jest.fn(() => child);
    const backend = new AntigravityBackendProcess({
      binaryPath: "agy",
      env: { AGY_PROFILE: "test" },
      runModels,
      spawnProcess,
    });

    const session = await backend.newSession({ cwd: "C:\\vault" });
    expect(session.state.model?.availableModels[0].baseModelId).toBe("gemini-3.7-flash-high");
    expect(session.state.model?.current.baseModelId).toBe("gemini-3.7-flash-high");

    const events: SessionEvent[] = [];
    backend.registerSessionHandler(session.sessionId, (event) => events.push(event));
    const resultPromise = backend.prompt({ sessionId: session.sessionId, prompt });

    expect(spawnProcess).toHaveBeenCalledWith(
      [
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--model",
        "gemini-3.7-flash-high",
        "--dangerously-skip-permissions",
        "--print-timeout",
        "10m0s",
      ],
      expect.objectContaining({ cwd: "C:\\vault", windowsHide: true })
    );
    expect(child.stdin.write).toHaveBeenCalledWith(
      `${JSON.stringify({ event: "user", message: { content: "<user>hello</user>" } })}\n`
    );
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.stdout.emit("data", `${JSON.stringify({ event: "init", conversation_id: "c1" })}\n`);
    child.stdout.emit(
      "data",
      `${JSON.stringify({ event: "step_update", step_update: { text_delta: "hi" } })}\n`
    );
    child.stdout.emit(
      "data",
      `${JSON.stringify({ event: "result", status: "completed", response: "hi", conversation_id: "c1" })}\n`
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ stopReason: "end_turn" });
    expect(events).toEqual([
      {
        sessionId: session.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
      },
    ]);
    expect(runModels).toHaveBeenCalledTimes(1);
  });

  it("decodes multibyte UTF-8 stream chunks split across data events", async () => {
    const child = new FakeChild();
    const backend = new AntigravityBackendProcess({
      binaryPath: "agy",
      runModels: async () => "model-a  Model A\n",
      spawnProcess: () => child,
    });

    const session = await backend.newSession({ cwd: "C:\\vault" });
    const events: SessionEvent[] = [];
    backend.registerSessionHandler(session.sessionId, (event) => events.push(event));
    const resultPromise = backend.prompt({ sessionId: session.sessionId, prompt });

    const encoder = new TextEncoder();
    const fullJson = `${JSON.stringify({ event: "step_update", step_update: { text_delta: "Hello 世界" } })}\n`;
    const fullBytes = encoder.encode(fullJson);

    // Split 1 byte into the first multibyte character.
    const prefixBytes = encoder.encode(fullJson.slice(0, fullJson.indexOf("世")));
    const byteSplitIndex = prefixBytes.length + 1;
    const chunk1 = fullBytes.subarray(0, byteSplitIndex);
    const chunk2 = fullBytes.subarray(byteSplitIndex);

    child.stdout.emit("data", chunk1);
    child.stdout.emit("data", chunk2);
    child.stdout.emit(
      "data",
      `${JSON.stringify({ event: "result", status: "completed", response: "Hello 世界" })}\n`
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ stopReason: "end_turn" });
    expect(events).toEqual([
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello 世界" },
        },
      },
    ]);
  });

  it("rejects a CLI result error and cancels only the active child", async () => {
    const child = new FakeChild();
    const backend = new AntigravityBackendProcess({
      binaryPath: "agy",
      runModels: async () => "model-a  Model A\n",
      spawnProcess: () => child,
    });
    const session = await backend.newSession({ cwd: "C:\\vault" });
    const resultPromise = backend.prompt({ sessionId: session.sessionId, prompt });

    child.stdout.emit(
      "data",
      `${JSON.stringify({
        event: "result",
        result: { status: "ERROR", response: "", error: "login required" },
      })}\n`
    );
    child.emit("close", 0);
    await expect(resultPromise).rejects.toThrow("login required");

    const cancelChild = new FakeChild();
    const cancelBackend = new AntigravityBackendProcess({
      binaryPath: "agy",
      runModels: async () => "model-a  Model A\n",
      spawnProcess: () => cancelChild,
    });
    const cancelSession = await cancelBackend.newSession({ cwd: "C:\\vault" });
    const pending = cancelBackend.prompt({ sessionId: cancelSession.sessionId, prompt });
    await cancelBackend.cancel({ sessionId: cancelSession.sessionId });
    expect(cancelChild.kill).toHaveBeenCalledTimes(1);
    cancelChild.emit("close", null);
    await expect(pending).resolves.toEqual({ stopReason: "cancelled" });
  });

  it("cleans active children and exit listeners on shutdown", async () => {
    const child = new FakeChild();
    const onExit = jest.fn();
    const backend = new AntigravityBackendProcess({
      binaryPath: "agy",
      runModels: async () => "model-a  Model A\n",
      spawnProcess: () => child,
    });
    backend.onExit(onExit);
    const session = await backend.newSession({ cwd: "C:\\vault" });
    void backend.prompt({ sessionId: session.sessionId, prompt });

    await backend.shutdown();

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(backend.isRunning()).toBe(false);
  });
});
