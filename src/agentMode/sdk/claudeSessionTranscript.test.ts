import { AI_SENDER, USER_SENDER } from "@/constants";
import { parseClaudeTranscript } from "./claudeSessionTranscript";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const TS = "2026-06-07T04:12:23.160Z";

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

describe("parseClaudeTranscript", () => {
  it("keeps user prompts and assistant prose in order, skipping CLI noise", () => {
    const jsonl = [
      line({ type: "queue-operation" }),
      line({ type: "user", timestamp: TS, message: { role: "user", content: "first prompt" } }),
      line({ type: "attachment", message: { role: null, content: null } }),
      line({ type: "ai-title" }),
      line({
        type: "assistant",
        timestamp: TS,
        message: { role: "assistant", content: [{ type: "text", text: "here is the answer" }] },
      }),
      // pure tool-use assistant turn — no prose, skipped
      line({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t1" }] },
      }),
      // tool_result comes back as a user record with array content — not user input
      line({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
      }),
      line({ type: "user", timestamp: TS, message: { role: "user", content: "second prompt" } }),
    ].join("\n");

    const messages = parseClaudeTranscript(jsonl);
    expect(messages.map((m) => [m.sender, m.message])).toEqual([
      [USER_SENDER, "first prompt"],
      [AI_SENDER, "here is the answer"],
      [USER_SENDER, "second prompt"],
    ]);
    expect(messages[0].timestamp?.epoch).toBe(Date.parse(TS));
    expect(messages.map((m) => m.id)).toEqual([
      "claude-loaded-0",
      "claude-loaded-1",
      "claude-loaded-2",
    ]);
  });

  it("unwraps the <user-message> envelope, dropping the context block", () => {
    const wrapped =
      "<copilot-context>\nNotes:\n- a.md\n</copilot-context>\n\n<user-message>\nsummarize a.md\n</user-message>";
    const jsonl = line({ type: "user", message: { role: "user", content: wrapped } });
    expect(parseClaudeTranscript(jsonl)[0].message).toBe("summarize a.md");
  });

  it("concatenates multiple assistant text blocks and ignores tool_use between them", () => {
    const jsonl = line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "part one" },
          { type: "tool_use", id: "t1" },
          { type: "text", text: "part two" },
        ],
      },
    });
    expect(parseClaudeTranscript(jsonl)[0].message).toBe("part one\n\npart two");
  });

  it("skips meta, sidechain, summary records and unparseable lines", () => {
    const jsonl = [
      line({ type: "user", isMeta: true, message: { role: "user", content: "meta" } }),
      line({
        type: "assistant",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "subagent" }] },
      }),
      line({ type: "summary", summary: "a summary" }),
      "{ not valid json",
      "",
    ].join("\n");
    expect(parseClaudeTranscript(jsonl)).toEqual([]);
  });
});
