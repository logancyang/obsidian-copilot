import { wrapStreamsForDebug } from "@/agentMode/acp/debugTap";
import { frameSink, type FrameRecord } from "@/agentMode/session/debugSink";

jest.mock("@/logger", () => ({ logInfo: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames: true } }),
}));
jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { append: jest.fn() },
  formatPayload: () => "",
}));

describe("debugTap", () => {
  describe("wrapStreamsForDebug()", () => {
    it("associates empty successful model/mode results with their requested state, but never a rejection (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
      const records: FrameRecord[] = [];
      let finished!: () => void;
      const logged = new Promise<void>((resolve) => {
        finished = resolve;
      });
      (frameSink.append as jest.Mock).mockImplementation((record: FrameRecord) => {
        records.push(record);
        if (record.kind === "error") finished();
      });
      let output!: ReadableStreamDefaultController<Uint8Array>;
      const streams = wrapStreamsForDebug(
        new WritableStream<Uint8Array>({ write() {} }),
        new ReadableStream<Uint8Array>({
          start(controller) {
            output = controller;
          },
        }),
        "test"
      );
      const writer = streams.stdin.getWriter();
      const mode = { sessionId: "chat", modeId: "plan" };
      const model = { sessionId: "chat", modelId: "model-b" };
      for (const [id, method, params] of [
        [1, "session/set_mode", mode],
        [2, "session/set_model", model],
        [3, "session/set_mode", { sessionId: "chat", modeId: "auto" }],
      ]) {
        await writer.write(
          new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
        );
      }
      await writer.close();
      output.enqueue(
        new TextEncoder().encode(
          [
            { jsonrpc: "2.0", id: 1, result: {} },
            { jsonrpc: "2.0", id: 2, result: {} },
            { jsonrpc: "2.0", id: 3, error: { code: -32602, message: "unsupported mode" } },
          ]
            .map((record) => JSON.stringify(record))
            .join("\n") + "\n"
        )
      );
      output.close();
      const reader = streams.stdout.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("unsupported mode");
      expect((await reader.read()).done).toBe(true);
      await logged;
      expect(
        records
          .filter((record) => record.kind === "result")
          .map((record) => ({
            payload: record.payload,
            confirmedState: record.confirmedState,
            sessionId: record.sessionId,
          }))
      ).toEqual([
        { payload: {}, confirmedState: mode, sessionId: "chat" },
        { payload: {}, confirmedState: model, sessionId: "chat" },
      ]);
      expect(records.find((record) => record.kind === "error")?.confirmedState).toBeUndefined();
      expect(
        records
          .filter((record) => record.kind === "request")
          .every((record) => record.confirmedState === undefined)
      ).toBe(true);
    });
  });
});
