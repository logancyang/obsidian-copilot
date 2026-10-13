import { logInfo } from "@/logger";
import { frameSink } from "@/agentMode/session/debugSink";
import { wrapStreamsForDebug } from "./debugTap";

jest.mock("@/logger", () => ({ logInfo: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames: true } }),
}));
jest.mock("@/agentMode/session/debugSink", () => ({
  formatPayload: (value: unknown) => JSON.stringify(value),
  frameSink: { append: jest.fn() },
}));

async function sendThroughTap(frame: unknown): Promise<void> {
  const tapped = wrapStreamsForDebug(
    new WritableStream<Uint8Array>(),
    new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    "codex"
  );
  const writer = tapped.stdin.getWriter();
  await writer.write(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
  await writer.close();
}

describe("debugTap", () => {
  describe("wrapStreamsForDebug()", () => {
    beforeEach(() => jest.clearAllMocks());

    it("logs an outbound request to the Copilot log and the full-frame log", async () => {
      await sendThroughTap({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { a: 1 } });

      expect(logInfo).toHaveBeenCalledWith('[ACP →][codex] session/prompt  #1  {"a":1}');
      expect(frameSink.append).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "request", method: "session/prompt", payload: { a: 1 } })
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 redacts MCP server headers so a session's bearer token never reaches either log", async () => {
      await sendThroughTap({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: {
          cwd: "/vault",
          mcpServers: [
            {
              type: "http",
              name: "obsidian-copilot",
              url: "http://127.0.0.1:4100/mcp",
              headers: [{ name: "Authorization", value: "Bearer secret-token" }],
            },
          ],
        },
      });

      const logged = JSON.stringify([
        jest.mocked(logInfo).mock.calls,
        jest.mocked(frameSink.append).mock.calls,
      ]);
      expect(logged).not.toContain("secret-token");
      expect(frameSink.append).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            cwd: "/vault",
            mcpServers: [
              {
                type: "http",
                name: "obsidian-copilot",
                url: "http://127.0.0.1:4100/mcp",
                headers: [{ name: "Authorization", value: "[redacted]" }],
              },
            ],
          },
        })
      );
    });
  });
});
