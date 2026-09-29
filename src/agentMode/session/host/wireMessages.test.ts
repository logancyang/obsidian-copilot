import type { AgentChatMessage } from "@/agentMode/session/types";
import { fakeNote } from "@/agentMode/session/host/hostTestHarness";
import { toWireMessage, toWireOp, toWireTranscript } from "@/agentMode/session/host/wireMessages";

const plain: AgentChatMessage = {
  id: "m1",
  sender: "user",
  timestamp: null,
  isVisible: true,
  message: "hi",
};
const withNotes: AgentChatMessage = {
  ...plain,
  id: "m2",
  context: { notes: [fakeNote("Projects/plan.md")], urls: ["https://example.com"] },
};

describe("wireMessages", () => {
  describe("toWireMessage()", () => {
    it("returns a message without context unchanged", () => {
      expect(toWireMessage(plain)).toBe(plain);
    });

    it("replaces note files with path and basename and keeps other context fields", () => {
      expect(toWireMessage(withNotes).context).toEqual({
        notes: [{ path: "Projects/plan.md", basename: "plan" }],
        urls: ["https://example.com"],
      });
    });

    it("returns the same wire object for the same message so snapshots and ops agree", () => {
      expect(toWireMessage(withNotes)).toBe(toWireMessage(withNotes));
    });

    it("produces JSON that survives a round trip", () => {
      const wire = toWireMessage(withNotes);
      expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
    });
  });

  describe("toWireTranscript()", () => {
    it("returns the input array when no message carries context", () => {
      const messages = [plain];
      expect(toWireTranscript(messages)).toBe(messages);
    });

    it("maps every message when any carries context", () => {
      const wire = toWireTranscript([plain, withNotes]);
      expect(wire[0]).toBe(plain);
      expect(wire[1]).toBe(toWireMessage(withNotes));
    });
  });

  describe("toWireOp()", () => {
    it("converts the message of msg.add and the messages of transcript.set", () => {
      expect(toWireOp({ t: "msg.add", message: withNotes })).toEqual({
        t: "msg.add",
        message: toWireMessage(withNotes),
      });
      expect(toWireOp({ t: "transcript.set", messages: [withNotes] })).toEqual({
        t: "transcript.set",
        messages: [toWireMessage(withNotes)],
      });
    });

    it("passes every other op through by reference", () => {
      const op = { t: "msg.appendText", id: "m", text: "x", atMs: 1 } as const;
      expect(toWireOp(op)).toBe(op);
    });
  });
});
