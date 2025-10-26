import { PromptContextEnvelope } from "@/context/PromptContextTypes";
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
    const output = lines.join("\n");
    expect(lines[0]).toContain("Prompt");
    expect(lines[0]).toContain("gpt-test");
    expect(output).toContain("**Actual Messages Sent to LLM:**");
    expect(output).toContain("```json");
    expect(output).toContain('"role": "system"');
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
    const output = lines.join("\n");
    expect(output).toContain("[Circular]");
  });

  it("formats layered context envelope when provided", async () => {
    const messages = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "User question" },
    ];

    const mockEnvelope: PromptContextEnvelope = {
      version: 1,
      conversationId: "conv-123",
      messageId: "msg-456",
      layers: [
        {
          id: "L1_SYSTEM",
          label: "System Instructions",
          text: "You are a helpful assistant.",
          stable: true,
          segments: [],
          hash: "abc123def456",
        },
        {
          id: "L2_PREVIOUS",
          label: "Previous Turn Context",
          text: "<note_context>\nPrevious note content\n</note_context>",
          stable: true,
          segments: [],
          hash: "prev789xyz",
        },
        {
          id: "L3_TURN",
          label: "Current Turn Context",
          text: "<note_context>\nCurrent note content\n</note_context>",
          stable: false,
          segments: [],
          hash: "turn123abc",
        },
        {
          id: "L4_STRIP",
          label: "Conversation Strip",
          text: "",
          stable: false,
          segments: [],
          hash: "strip456",
        },
        {
          id: "L5_USER",
          label: "User Message",
          text: "What is this about?",
          stable: false,
          segments: [],
          hash: "user789def",
        },
      ],
      serializedText: "System + Context + User",
      layerHashes: {
        L1_SYSTEM: "abc123def456",
        L2_PREVIOUS: "prev789xyz",
        L3_TURN: "turn123abc",
        L4_STRIP: "strip456",
        L5_USER: "user789def",
      },
      combinedHash: "combined123",
    };

    recordPromptPayload({ messages, modelName: "gpt-4", contextEnvelope: mockEnvelope });
    await flushRecordedPromptPayloadToLog();

    expect(logMarkdownBlock).toHaveBeenCalledTimes(1);
    const lines = (logMarkdownBlock as jest.Mock).mock.calls[0][0] as string[];
    const output = lines.join("\n");

    // Verify header
    expect(lines[0]).toContain("Prompt");
    expect(lines[0]).toContain("gpt-4");

    // Verify BOTH sections are present
    expect(output).toContain("**Actual Messages Sent to LLM:**");
    expect(output).toContain("**Layered Context Metadata:**");

    // Verify actual messages JSON is shown
    expect(output).toContain("```json");
    expect(output).toContain('"role": "system"');
    expect(output).toContain('"role": "user"');

    // Verify layered format with emojis and layer names
    expect(output).toContain("msg:msg-456");
    expect(output).toContain("conv:conv-123");
    expect(output).toContain("🔒 L1_SYSTEM");
    expect(output).toContain("🔒 L2_PREVIOUS");
    expect(output).toContain("⚡ L3_TURN");
    expect(output).toContain("⚡ L5_USER");

    // Verify layer content appears
    expect(output).toContain("You are a helpful assistant");
    expect(output).toContain("Previous note content");
    expect(output).toContain("Current note content");
    expect(output).toContain("What is this about?");

    // Verify hash prefixes appear
    expect(output).toContain("abc123de"); // L1 hash prefix
    expect(output).toContain("prev789x"); // L2 hash prefix
  });
});
