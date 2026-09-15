import { mergeToolCallUpdate, toolCallToPart } from "./toolCallParts";
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/467";
describe("toolCallParts", () => {
  describe("toolCallToPart()", () => {
    it(`keeps prompt, child identity, lifecycle and display content together (${ISSUE})`, () => {
      expect(
        toolCallToPart({
          toolCallId: "child",
          title: "Reader",
          parentToolCallId: "parent",
          subagent: "running",
          rawInput: { prompt: "Read note" },
          content: [
            { type: "content", content: { type: "text", text: "Answer" } },
            { type: "diff", path: "note.md", newText: "New" },
          ],
        })
      ).toMatchObject({
        kind: "tool_call",
        id: "child",
        parentToolCallId: "parent",
        subagent: "running",
        input: { prompt: "Read note" },
        status: "pending",
        output: [
          { type: "text", text: "Answer" },
          { type: "diff", path: "note.md", newText: "New" },
        ],
      });
    });
    it(`bounds oversized displayed tool output without claiming the agent lost it (${ISSUE})`, () => {
      const part = toolCallToPart({
        toolCallId: "read",
        title: "Read",
        content: [{ type: "content", content: { type: "text", text: "x".repeat(256_100) } }],
      });
      expect(part.kind === "tool_call" && part.output?.[0]).toMatchObject({
        text: expect.stringContaining("Display trimmed: 100 more characters"),
      });
    });
  });
  describe("mergeToolCallUpdate()", () => {
    it(`retains the launch prompt while replacing its report and final state (${ISSUE})`, () => {
      const part = toolCallToPart({
        toolCallId: "child",
        title: "Reader",
        subagent: "running",
        rawInput: { prompt: "Read note" },
      });
      expect(
        mergeToolCallUpdate(part, {
          toolCallId: "child",
          subagent: "cancelled",
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: "Partial report" } }],
        })
      ).toMatchObject({
        title: "Reader",
        input: { prompt: "Read note" },
        subagent: "cancelled",
        status: "failed",
        output: [{ type: "text", text: "Partial report" }],
      });
    });
    it(`keeps a titleless update visible when its initial tool frame was unavailable (${ISSUE})`, () => {
      expect(
        mergeToolCallUpdate(undefined, { toolCallId: "read", status: "completed" })
      ).toMatchObject({ id: "read", title: "Tool call", status: "completed" });
    });
  });
});
