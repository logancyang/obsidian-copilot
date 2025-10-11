import { logMarkdownBlock } from "@/logger";
import {
  __getLatestPromptPayloadSnapshotForTests,
  clearRecordedPromptPayload,
  flushRecordedPromptPayloadToLog,
  recordPromptPayload,
} from "./promptPayloadRecorder";

jest.mock("@/logger", () => ({
  logMarkdownBlock: jest.fn(),
}));

describe("promptPayloadRecorder", () => {
  beforeEach(() => {
    (logMarkdownBlock as jest.Mock).mockClear();
    clearRecordedPromptPayload();
  });

  it("records messages and flushes them as markdown", async () => {
    const messages = [
      { role: "system", content: "hello" },
      { role: "user", content: "world" },
    ];

    recordPromptPayload({ messages, modelName: "gpt-test" });
    expect(__getLatestPromptPayloadSnapshotForTests()).not.toBeNull();

    await flushRecordedPromptPayloadToLog();

    expect(logMarkdownBlock).toHaveBeenCalledTimes(1);
    const lines = (logMarkdownBlock as jest.Mock).mock.calls[0][0] as string[];
    expect(lines[0]).toContain("Agent Prompt Payload");
    expect(lines[0]).toContain("gpt-test");
    expect(lines[1]).toBe("```json");
    expect(lines[2]).toContain('"role": "system"');
    expect(lines[3]).toBe("```");
    expect(__getLatestPromptPayloadSnapshotForTests()).toBeNull();
  });

  it("does not flush twice without a new recording", async () => {
    recordPromptPayload({ messages: [{ role: "system", content: "hello" }] });

    await flushRecordedPromptPayloadToLog();
    await flushRecordedPromptPayloadToLog();

    expect(logMarkdownBlock).toHaveBeenCalledTimes(1);
  });

  it("clears recorded payloads when requested", async () => {
    recordPromptPayload({ messages: [{ role: "system", content: "hello" }] });
    clearRecordedPromptPayload();

    await flushRecordedPromptPayloadToLog();

    expect(logMarkdownBlock).not.toHaveBeenCalled();
  });

  it("serializes circular message graphs without throwing", async () => {
    const circular: any = { role: "system" };
    circular.self = circular;

    expect(() => recordPromptPayload({ messages: [circular] })).not.toThrow();

    await flushRecordedPromptPayloadToLog();

    expect(logMarkdownBlock).toHaveBeenCalledTimes(1);
    const lines = (logMarkdownBlock as jest.Mock).mock.calls[0][0] as string[];
    expect(lines[2]).toContain("[Circular]");
  });
});
