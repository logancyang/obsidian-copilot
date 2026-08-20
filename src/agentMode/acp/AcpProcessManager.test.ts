import { requireNodeModule } from "@/utils/desktopRuntime";
import { AcpProcessManager, sanitizeAcpStdout } from "@/agentMode/acp/AcpProcessManager";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: jest.fn(),
}));

/** The exact prefix reported in the opencode hang (two OSC title writes). */
const OSC_TITLES = "\x1b]0;opencode: ready\x07\x1b]0;second-brain: ready\x07";
const ENVELOPE = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readLines(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text.split("\n").filter((line) => line.length > 0);
}

describe("AcpProcessManager", () => {
  describe("AcpProcessManager", () => {
    describe("start()", () => {
      it("returns a stdout stream with the child's terminal escape sequences already stripped (https://github.com/logancyang/obsidian-copilot/issues/2876)", async () => {
        const identity = <T>(value: T): T => value;
        const child = {
          stdin: {},
          // `toWeb` is the identity below, so the manager receives this as-is.
          stdout: streamOf([`${OSC_TITLES}${ENVELOPE}\n`]),
          stderr: { setEncoding: jest.fn(), on: jest.fn() },
          on: jest.fn(),
        };
        (requireNodeModule as jest.Mock).mockImplementation((id: string) =>
          id === "child_process"
            ? { spawn: () => child }
            : { Readable: { toWeb: identity }, Writable: { toWeb: identity } }
        );
        const manager = new AcpProcessManager({ command: "/bin/agent", args: ["acp"], env: {} });

        const { stdout } = manager.start();

        expect(await readLines(stdout)).toEqual([ENVELOPE]);
      });
    });
  });

  describe("sanitizeAcpStdout()", () => {
    it("makes a frame prefixed with OSC title sequences parse as JSON (https://github.com/logancyang/obsidian-copilot/issues/2876)", async () => {
      const lines = await readLines(sanitizeAcpStdout(streamOf([`${OSC_TITLES}${ENVELOPE}\n`])));

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1 },
      });
    });

    it("makes a frame prefixed with CSI sequences that use the full parameter-byte range parse as JSON (https://github.com/logancyang/obsidian-copilot/issues/2876)", async () => {
      // Truecolor uses `:` separators; `<`, `=` and `>` appear in private forms.
      const prefix = "\x1b[38:2:255:0:0m\x1b[<0;1;2M\x1b[=5h\x1b[>4;2m";

      const lines = await readLines(sanitizeAcpStdout(streamOf([`${prefix}${ENVELOPE}\n`])));

      expect(lines).toEqual([ENVELOPE]);
    });

    it("makes a frame parse as JSON when a chunk boundary splits an escape sequence (https://github.com/logancyang/obsidian-copilot/issues/2876)", async () => {
      const payload = `\x1b[32m${OSC_TITLES}${ENVELOPE}\n`;
      // Cuts land inside the CSI colour code and inside the first OSC title.
      const chunks = [payload.slice(0, 3), payload.slice(3, 12), payload.slice(12)];

      const lines = await readLines(sanitizeAcpStdout(streamOf(chunks)));

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1 },
      });
    });

    it("preserves escape-free frames and their order", async () => {
      const lines = await readLines(
        sanitizeAcpStdout(streamOf(['{"a":1}\n{"b":2}\n', '{"c":3}\n']))
      );

      expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    });

    it("emits a final frame that the child left without a trailing newline", async () => {
      const lines = await readLines(sanitizeAcpStdout(streamOf([`${OSC_TITLES}${ENVELOPE}`])));

      expect(lines).toEqual([ENVELOPE]);
    });
  });
});
