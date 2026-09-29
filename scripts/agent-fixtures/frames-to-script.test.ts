import { convert } from "./frames-to-script";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

interface TestFrame {
  dir: string;
  tag: string;
  kind: string;
  method: string;
  id: string | null;
  payload: Record<string, unknown>;
}

const prompt = (id: string, text: string): TestFrame => ({
  dir: "→",
  tag: "codex",
  kind: "request",
  method: "session/prompt",
  id,
  payload: { sessionId: "acp-1", prompt: [{ type: "text", text }] },
});

const update = (payloadUpdate: Record<string, unknown>): TestFrame => ({
  dir: "←",
  tag: "codex",
  kind: "notif",
  method: "session/update",
  id: null,
  payload: { sessionId: "acp-1", update: payloadUpdate },
});

const finish = (id: string, kind: "result" | "error", payload: Record<string, unknown>) => ({
  dir: "→",
  tag: "codex",
  kind,
  method: "session/prompt",
  id,
  payload,
});

interface ConvertedScript {
  steps: {
    step: string;
    text?: string;
    stopReason?: string;
    update?: {
      sessionUpdate: string;
      kind?: string;
      status?: string;
      content?: { type: string; text: string };
    };
  }[];
}

const parseScript = (raw: string): ConvertedScript => JSON.parse(raw) as ConvertedScript;

const toLog = (frames: TestFrame[]): string => frames.map((f) => JSON.stringify(f)).join("\n");

describe("frames-to-script", () => {
  describe("convert()", () => {
    it("keeps enum-shaped structural values and replaces every text string with same-length pseudo-text", async () => {
      const log = toLog([
        prompt("1", "Draft the Acme memo"),
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Acme renewal closed" },
        }),
        finish("1", "result", { stopReason: "end_turn" }),
      ]);

      const script = parseScript(await convert(log, "codex", { name: "demo" }));

      expect(script.steps[0].step).toBe("send");
      expect(script.steps[0].text).toMatch(/^[a-z ]{19}$/);
      expect(script.steps[1].update?.sessionUpdate).toBe("agent_message_chunk");
      expect(script.steps[1].update?.content?.type).toBe("text");
      expect(script.steps[1].update?.content?.text).toMatch(/^[a-z ]{19}$/);
      expect(script.steps.at(-1)).toEqual({ step: "end", stopReason: "end_turn" });
    });

    it("pseudonymizes values under structural key names inside tool input, where the text is the user's", async () => {
      const log = toLog([
        prompt("1", "go"),
        update({
          sessionUpdate: "tool_call",
          toolCallId: "call-7",
          title: "Write",
          kind: "edit",
          status: "pending",
          rawInput: {
            type: "Confidential client name",
            status: "Acme",
            file_path: "/Users/a/b.md",
          },
        }),
        finish("1", "result", { stopReason: "end_turn" }),
      ]);

      const raw = await convert(log, "codex", { name: "demo" });

      expect(raw).not.toMatch(/Confidential|Acme|Users/);
      expect(parseScript(raw).steps[1].update).toMatchObject({ kind: "edit", status: "pending" });
    });

    it("refuses to record a prompt that ended with an error frame as a successful turn", async () => {
      const log = toLog([prompt("1", "go"), finish("1", "error", { message: "boom" })]);
      await expect(convert(log, "codex", { name: "demo" })).rejects.toThrow(/error frame/);
    });

    it("refuses a frame log in which a second prompt starts before the first ends", async () => {
      const log = toLog([prompt("1", "one"), prompt("2", "two")]);
      await expect(convert(log, "codex", { name: "demo" })).rejects.toThrow(/Overlapping prompts/);
    });
  });
});
