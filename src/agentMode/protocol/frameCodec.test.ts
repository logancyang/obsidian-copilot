import { parseClientFrame, parseServerFrame } from "@/agentMode/protocol/frameCodec";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

describe("frameCodec", () => {
  describe("parseClientFrame()", () => {
    it.each([
      [{ type: "hello", v: 1, app: "1.2.3" }],
      [{ type: "subscribe", scope: "host" }],
      [{ type: "subscribe", scope: "session:s1", fromSeq: 4, epoch: "log-a" }],
      [{ type: "unsubscribe", scope: "session:s1" }],
      [{ type: "focus", sessionId: "s1" }],
      [{ type: "focus", sessionId: null }],
      [{ type: "command", id: "7", command: { name: "cancel", sessionId: "s1" } }],
    ])("accepts the well-formed frame %j unchanged", (frame) => {
      expect(parseClientFrame(JSON.stringify(frame))).toEqual(frame);
    });

    it.each([
      ["text that is not JSON", "not json"],
      ["a JSON array", "[1]"],
      ["a frame with an unknown type", JSON.stringify({ type: "mystery" })],
      ["a hello without a numeric version", JSON.stringify({ type: "hello", v: "1", app: "x" })],
      ["a subscribe to an unknown scope", JSON.stringify({ type: "subscribe", scope: "other" })],
      [
        "a resume without the log it resumes",
        JSON.stringify({ type: "subscribe", scope: "host", fromSeq: 3 }),
      ],
      [
        "a resume from a negative position",
        JSON.stringify({ type: "subscribe", scope: "host", fromSeq: -1, epoch: "e" }),
      ],
      ["a focus with a numeric session id", JSON.stringify({ type: "focus", sessionId: 5 })],
      [
        "a command without a name",
        JSON.stringify({ type: "command", id: "1", command: { sessionId: "s" } }),
      ],
      ["a command without an id", JSON.stringify({ type: "command", command: { name: "cancel" } })],
    ])(`rejects %s (${ISSUE})`, (_label, text) => {
      expect(parseClientFrame(text)).toBeNull();
    });

    it(`rejects a text field longer than the bound (${ISSUE})`, () => {
      const long = "x".repeat(600);
      expect(parseClientFrame(JSON.stringify({ type: "hello", v: 1, app: long }))).toBeNull();
    });
  });

  describe("parseServerFrame()", () => {
    it.each([
      [{ type: "hello", v: 1, app: "1.0", hostId: "h", ok: true }],
      [{ type: "snapshot", scope: "host", epoch: "e", seq: 0, state: null }],
      [{ type: "ops", scope: "session:s1", epoch: "e", from: 3, ops: [] }],
      [{ type: "result", id: "1", result: { ok: true, value: undefined } }],
    ])("accepts the well-formed frame %j", (frame) => {
      expect(parseServerFrame(JSON.stringify(frame))).toEqual(JSON.parse(JSON.stringify(frame)));
    });

    it.each([
      ["non-JSON text", "{"],
      ["an unknown type", JSON.stringify({ type: "denied" })],
      ["ops without an epoch", JSON.stringify({ type: "ops", scope: "host", from: 1, ops: [] })],
      [
        "a snapshot without a state field",
        JSON.stringify({ type: "snapshot", scope: "host", epoch: "e", seq: 0 }),
      ],
      ["a result without a result object", JSON.stringify({ type: "result", id: "1" })],
    ])("rejects %s", (_label, text) => {
      expect(parseServerFrame(text)).toBeNull();
    });
  });
});
