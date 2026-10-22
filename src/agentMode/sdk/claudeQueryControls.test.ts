import type {
  query as sdkQuery,
  SDKUserMessage,
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { cancelQueuedMessage } from "./claudeQueryControls";

type ControlPayload = Record<string, unknown>;

interface FakeClaudeCliProcess {
  spawn: (options: SpawnOptions) => SpawnedProcess;
  receivedControlRequests: ControlPayload[];
}

function createFakeClaudeCliProcess(
  responsesBySubtype: Record<string, ControlPayload>
): FakeClaudeCliProcess {
  const receivedControlRequests: ControlPayload[] = [];

  const spawn = (): SpawnedProcess => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const events = new EventEmitter();
    let buffered = "";
    let exitCode: number | null = null;

    const reply = (requestId: string, response: ControlPayload): void => {
      stdout.write(
        `${JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: requestId, response },
        })}\n`
      );
    };

    stdin.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line) as {
          type?: string;
          request_id?: string;
          request?: ControlPayload;
        };
        if (frame.type !== "control_request" || !frame.request || !frame.request_id) continue;
        if (frame.request.subtype === "initialize") {
          reply(frame.request_id, {});
          continue;
        }
        receivedControlRequests.push(frame.request);
        reply(frame.request_id, responsesBySubtype[String(frame.request.subtype)] ?? {});
      }
    });

    const exit = (): void => {
      if (exitCode !== null) return;
      exitCode = 0;
      stdout.end();
      events.emit("exit", 0, null);
    };
    stdin.on("finish", exit);

    return {
      stdin,
      stdout,
      get killed() {
        return exitCode !== null;
      },
      get exitCode() {
        return exitCode;
      },
      kill: () => {
        exit();
        return true;
      },
      on: (event: string, listener: (...args: never[]) => void) => {
        events.on(event, listener);
      },
      once: (event: string, listener: (...args: never[]) => void) => {
        events.once(event, listener);
      },
      off: (event: string, listener: (...args: never[]) => void) => {
        events.off(event, listener);
      },
    };
  };

  return { spawn, receivedControlRequests };
}

const QUEUED_UUID = "8f0f0bd0-179d-48bd-8c96-b82c65762c90";

// Jest maps the SDK to a mock, so load the installed package natively to exercise its real Query.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/747
function loadInstalledSdkQuery(): typeof sdkQuery {
  const { createRequire } = (
    process as unknown as { getBuiltinModule(id: "node:module"): typeof import("node:module") }
  ).getBuiltinModule("node:module");
  const nativeRequire = createRequire(__filename);
  return (nativeRequire("@anthropic-ai/claude-agent-sdk") as { query: typeof sdkQuery }).query;
}

function startRealQuery(responsesBySubtype: Record<string, Record<string, unknown>>) {
  const cli = createFakeClaudeCliProcess(responsesBySubtype);
  let closeInput: () => void = () => {};
  const inputClosed = new Promise<void>((resolve) => (closeInput = resolve));
  async function* input(): AsyncGenerator<SDKUserMessage> {
    await inputClosed;
    yield* [];
  }
  const query = loadInstalledSdkQuery()({
    prompt: input(),
    options: { pathToClaudeCodeExecutable: process.execPath, spawnClaudeCodeProcess: cli.spawn },
  });
  const close = (): void => {
    closeInput();
    query.close();
  };
  return { query, cli, close };
}

describe("claudeQueryControls", () => {
  describe("cancelQueuedMessage()", () => {
    it("sends the installed SDK's cancel_async_message request for the uuid and resolves to whether the CLI withdrew it", async () => {
      const { query, cli, close } = startRealQuery({
        cancel_async_message: { cancelled: true },
      });

      try {
        const withdrawn = await cancelQueuedMessage(query, QUEUED_UUID);

        expect(cli.receivedControlRequests).toEqual([
          { subtype: "cancel_async_message", message_uuid: QUEUED_UUID },
        ]);
        expect(withdrawn).toBe(true);
      } finally {
        close();
      }
    });

    it("resolves to false when the CLI reports the message already left the queue", async () => {
      const { query, close } = startRealQuery({ cancel_async_message: { cancelled: false } });

      try {
        await expect(cancelQueuedMessage(query, QUEUED_UUID)).resolves.toBe(false);
      } finally {
        close();
      }
    });
  });
});
