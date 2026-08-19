import { sanitizeAcpStdout } from "@/agentMode/acp/AcpProcessManager";

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
  describe("sanitizeAcpStdout()", () => {
    it("makes a frame prefixed with OSC title sequences parse as JSON", async () => {
      const lines = await readLines(sanitizeAcpStdout(streamOf([`${OSC_TITLES}${ENVELOPE}\n`])));

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1 },
      });
    });

    it("makes a frame parse as JSON when a chunk boundary splits an escape sequence", async () => {
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
