import type { AgentChatMessage } from "@/agentMode/session/types";
import { fakeNote } from "@/agentMode/session/host/hostTestHarness";
import type { ServerFrame } from "@/agentMode/protocol/frames";
import type { SessionState } from "@/agentMode/protocol/state";
import {
  toWireMessage,
  toWireOp,
  toWireTranscript,
  withoutInlineImages,
} from "@/agentMode/session/host/wireMessages";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

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
  describe("withoutInlineImages()", () => {
    const photo = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
    const withPhoto: AgentChatMessage = {
      ...plain,
      id: "m3",
      content: [{ type: "text", text: "look" }, photo],
    };

    it(`replaces each inline image of a snapshot's transcript with a small placeholder and keeps the text (${ISSUE})`, () => {
      const frame: ServerFrame = {
        type: "snapshot",
        scope: "session:s1",
        epoch: "e",
        seq: 3,
        state: { transcript: [plain, withPhoto] } as unknown as SessionState,
      };

      const slim = withoutInlineImages(frame);

      const state = (slim as Extract<ServerFrame, { type: "snapshot" }>).state as SessionState;
      const content = state.transcript[1].content as Array<Record<string, unknown>>;
      expect(content[0]).toEqual({ type: "text", text: "look" });
      expect(content[1].type).toBe("image_url");
      const url = (content[1].image_url as { url: string }).url;
      expect(url).toMatch(/^data:image\/svg\+xml,/);
      expect(url).not.toContain("AAAA");
      expect(url.length).toBeLessThan(600);
      expect(state.transcript[0]).toBe(plain);
    });

    it(`replaces the images of an added message and of a replaced transcript in an ops frame (${ISSUE})`, () => {
      const frame: ServerFrame = {
        type: "ops",
        scope: "session:s1",
        epoch: "e",
        from: 1,
        ops: [
          { t: "msg.add", message: withPhoto },
          { t: "transcript.set", messages: [withPhoto] },
          { t: "msg.appendText", id: "m1", text: "x" } as never,
        ],
      };

      const slim = withoutInlineImages(frame);

      expect(JSON.stringify(slim)).not.toContain("AAAA");
      expect((slim as Extract<ServerFrame, { type: "ops" }>).ops[2]).toEqual({
        t: "msg.appendText",
        id: "m1",
        text: "x",
      });
    });

    it("returns a frame that carries no transcript unchanged", () => {
      const hello: ServerFrame = { type: "hello", v: 1, app: "1", hostId: "h", ok: true };
      const missing: ServerFrame = {
        type: "snapshot",
        scope: "session:s1",
        epoch: "",
        seq: 0,
        state: null,
      };

      expect(withoutInlineImages(hello)).toBe(hello);
      expect(withoutInlineImages(missing)).toBe(missing);
    });
  });
});
