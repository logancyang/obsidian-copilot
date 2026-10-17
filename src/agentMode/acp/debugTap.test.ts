import { wrapStreamsForDebug } from "./debugTap";
import { frameSink } from "@/agentMode/session/debugSink";

let fullFrames = true;
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames: fullFrames } }),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn() }));
jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { append: jest.fn() },
  formatPayload: (value: unknown) => JSON.stringify(value),
}));

const append = frameSink.append as jest.Mock;
function stream(lines: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(lines.map((line) => JSON.stringify(line) + "\n").join(""))
      );
      controller.close();
    },
  });
}

describe("debugTap", () => {
  describe("wrapStreamsForDebug()", () => {
    it("correlates session and prompt frames without marking replies or inbound requests eligible (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
      append.mockClear();
      let complete!: () => void;
      const completed = new Promise<void>((resolve) => {
        complete = resolve;
      });
      append.mockImplementation((record) => {
        if (record.method === "session/update") complete();
      });
      const wrapped = wrapStreamsForDebug(
        new WritableStream<Uint8Array>({ write() {} }),
        stream([
          { jsonrpc: "2.0", id: 1, result: { sessionId: "chat" } },
          { jsonrpc: "2.0", id: 2, result: {} },
          { jsonrpc: "2.0", id: 3, error: { code: -1, message: "failed" } },
          { jsonrpc: "2.0", id: 8, method: "session/prompt", params: { sessionId: "chat" } },
          { jsonrpc: "2.0", id: 8, result: {} },
          { jsonrpc: "2.0", method: "session/update", params: { sessionId: "chat" } },
        ]),
        "codex"
      );
      const writer = wrapped.stdin.getWriter();
      const outbound = [
        { jsonrpc: "2.0", id: 1, method: "session/new", params: {} },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "session/set_model",
          params: { sessionId: "chat", modelId: "m" },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "session/prompt",
          params: { sessionId: "chat", prompt: [] },
        },
        { jsonrpc: "2.0", id: 8, result: {} },
      ];
      await writer.write(
        new TextEncoder().encode(outbound.map((line) => JSON.stringify(line) + "\n").join(""))
      );
      await writer.close();
      const reader = wrapped.stdout.getReader();
      for (;;) {
        if ((await reader.read()).done) break;
      }
      await completed;
      const records = append.mock.calls.map(([record]) => record);
      expect(records.find((r) => r.method === "session/new" && r.kind === "result")).toMatchObject({
        sessionId: "chat",
        payload: { sessionId: "chat" },
      });
      expect(records.find((r) => r.method === "session/prompt" && r.dir === "→")).toMatchObject({
        sessionId: "chat",
        startsConversation: true,
      });
      expect(records.find((r) => r.kind === "error")).toMatchObject({
        payload: { code: -1, message: "failed" },
      });
      expect(
        records.find((r) => r.method === "session/set_model" && r.kind === "result").payload
      ).toEqual({});
      expect(records.filter((r) => r.startsConversation)).toHaveLength(1);
      expect(
        records.find((r) => r.method === "session/prompt" && r.dir === "←")
      ).not.toHaveProperty("startsConversation");
    });

    it("keeps full-frame capture disabled when the setting is off", async () => {
      append.mockClear();
      fullFrames = false;
      const wrapped = wrapStreamsForDebug(
        new WritableStream<Uint8Array>({ write() {} }),
        stream([]),
        "codex"
      );
      const writer = wrapped.stdin.getWriter();
      await writer.write(
        new TextEncoder().encode(
          '{"jsonrpc":"2.0","method":"session/prompt","params":{"sessionId":"chat"}}\n'
        )
      );
      await writer.close();
      const reader = wrapped.stdout.getReader();
      for (;;) {
        if ((await reader.read()).done) break;
      }
      expect(append).not.toHaveBeenCalled();
      fullFrames = true;
    });
  });
});
