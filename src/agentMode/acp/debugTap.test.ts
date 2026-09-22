import { wrapStreamsForDebug } from "@/agentMode/acp/debugTap";
import { frameSink } from "@/agentMode/session/debugSink";
import { getSettings } from "@/settings/model";
import { logInfo } from "@/logger";

jest.mock("@/logger", () => ({ logInfo: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));
jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { append: jest.fn() },
  formatPayload: (value: unknown) => JSON.stringify(value),
}));

describe("debugTap", () => {
  describe("wrapStreamsForDebug()", () => {
    it.each([false, true])(
      "redacts elicitation response content with full frames %s while preserving wire bytes (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)",
      async (fullFrames) => {
        (getSettings as jest.Mock).mockReturnValue({ agentMode: { debugFullFrames: fullFrames } });
        (logInfo as jest.Mock).mockClear();
        (frameSink.append as jest.Mock).mockClear();
        const encoder = new TextEncoder();
        const written: string[] = [];
        const rawStdin = new WritableStream<Uint8Array>({
          write(chunk) {
            written.push(new TextDecoder().decode(chunk));
          },
        });
        const rawStdout = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "elicitation/create", params: { mode: "form", message: "Token" } })}\n`
              )
            );
            controller.close();
          },
        });
        const streams = wrapStreamsForDebug(rawStdin, rawStdout, "codex");
        await streams.stdout.getReader().read();
        const secret = "private-secret-value";
        const response = `${JSON.stringify({ jsonrpc: "2.0", id: 7, result: { action: "accept", content: { token: secret } } })}\n`;
        const writer = streams.stdin.getWriter();
        await writer.write(encoder.encode(response));
        await writer.close();

        expect(written.join("")).toBe(response);
        expect(JSON.stringify((logInfo as jest.Mock).mock.calls)).not.toContain(secret);
        expect(JSON.stringify((frameSink.append as jest.Mock).mock.calls)).not.toContain(secret);
        if (fullFrames)
          expect(frameSink.append).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "result", payload: "[redacted]" })
          );
      }
    );

    it("redacts a response logged before its request is observed (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
      (getSettings as jest.Mock).mockReturnValue({ agentMode: { debugFullFrames: true } });
      (logInfo as jest.Mock).mockClear();
      (frameSink.append as jest.Mock).mockClear();
      const rawStdin = new WritableStream<Uint8Array>({ write() {} });
      const rawStdout = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
      const streams = wrapStreamsForDebug(rawStdin, rawStdout, "codex");
      const secret = "private-secret-value";
      const response = `${JSON.stringify({ jsonrpc: "2.0", id: 7, result: { action: "accept", content: { token: secret } } })}\n`;
      const writer = streams.stdin.getWriter();
      await writer.write(new TextEncoder().encode(response));
      await writer.close();

      expect(JSON.stringify((logInfo as jest.Mock).mock.calls)).not.toContain(secret);
      expect(JSON.stringify((frameSink.append as jest.Mock).mock.calls)).not.toContain(secret);
      expect(frameSink.append).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "result", method: "(unknown)", payload: "[redacted]" })
      );
    });
  });
});
