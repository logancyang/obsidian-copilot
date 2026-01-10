/**
 * Unit tests for transformSDKMessage
 */

import {
  transformSDKMessage,
  transformSDKMessages,
  transformSDKMessagesAsync,
} from "./transformSDKMessage";
import {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessageSuccess,
  SDKResultMessageError,
  SDKSystemMessage,
  SDKPartialAssistantMessage,
  SDKCompactBoundaryMessage,
  StreamChunk,
  TextChunk,
  ThinkingChunk,
  ToolUseChunk,
  ToolResultChunk,
  SessionInitChunk,
  UsageChunk,
  ErrorChunk,
  UUID,
} from "./types";

// Helper to generate test UUIDs
const testUUID = (): UUID => "test-uuid-1234-5678-abcd" as UUID;

describe("transformSDKMessage", () => {
  describe("system messages", () => {
    it("should transform init message to SessionInitChunk", () => {
      const message: SDKSystemMessage = {
        type: "system",
        subtype: "init",
        uuid: testUUID(),
        session_id: "session-123",
        apiKeySource: "user",
        cwd: "/test/path",
        tools: ["Read", "Write", "Bash"],
        mcp_servers: [],
        model: "claude-sonnet-4-20250514",
        permissionMode: "default",
        slash_commands: [],
        output_style: "text",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("session_init");

      const chunk = chunks[0] as SessionInitChunk;
      expect(chunk.sessionId).toBe("session-123");
      expect(chunk.model).toBe("claude-sonnet-4-20250514");
      expect(chunk.tools).toEqual(["Read", "Write", "Bash"]);
      expect(chunk.cwd).toBe("/test/path");
      expect(chunk.permissionMode).toBe("default");
    });

    it("should not yield chunks for compact_boundary messages", () => {
      const message: SDKCompactBoundaryMessage = {
        type: "system",
        subtype: "compact_boundary",
        uuid: testUUID(),
        session_id: "session-123",
        compact_metadata: {
          trigger: "auto",
          pre_tokens: 50000,
        },
      };

      const chunks = [...transformSDKMessage(message)];
      expect(chunks).toHaveLength(0);
    });
  });

  describe("assistant messages", () => {
    it("should transform text content blocks", () => {
      const message: SDKAssistantMessage = {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello, world!" }],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text");

      const chunk = chunks[0] as TextChunk;
      expect(chunk.text).toBe("Hello, world!");
      expect(chunk.isPartial).toBe(false);
    });

    it("should transform thinking content blocks", () => {
      const message: SDKAssistantMessage = {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Let me analyze this problem..." }],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking");

      const chunk = chunks[0] as ThinkingChunk;
      expect(chunk.thinking).toBe("Let me analyze this problem...");
      expect(chunk.isPartial).toBe(false);
    });

    it("should transform tool_use content blocks", () => {
      const message: SDKAssistantMessage = {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-123",
              name: "Read",
              input: { file_path: "/test/file.txt" },
            },
          ],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool_use");

      const chunk = chunks[0] as ToolUseChunk;
      expect(chunk.toolUseId).toBe("tool-123");
      expect(chunk.toolName).toBe("Read");
      expect(chunk.input).toEqual({ file_path: "/test/file.txt" });
      expect(chunk.isPartial).toBe(false);
    });

    it("should transform multiple content blocks", () => {
      const message: SDKAssistantMessage = {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Analyzing..." },
            { type: "text", text: "Here is my response" },
            {
              type: "tool_use",
              id: "tool-456",
              name: "Bash",
              input: { command: "ls -la" },
            },
          ],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe("thinking");
      expect(chunks[1].type).toBe("text");
      expect(chunks[2].type).toBe("tool_use");
    });

    it("should handle empty content array", () => {
      const message: SDKAssistantMessage = {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];
      expect(chunks).toHaveLength(0);
    });
  });

  describe("user messages with tool results", () => {
    it("should transform tool_result content blocks", () => {
      const message: SDKUserMessage = {
        type: "user",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-123",
              content: "File contents here",
              is_error: false,
            },
          ],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool_result");

      const chunk = chunks[0] as ToolResultChunk;
      expect(chunk.toolUseId).toBe("tool-123");
      expect(chunk.content).toBe("File contents here");
      expect(chunk.isError).toBe(false);
    });

    it("should handle error tool results", () => {
      const message: SDKUserMessage = {
        type: "user",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-789",
              content: "Command failed with exit code 1",
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      const chunk = chunks[0] as ToolResultChunk;
      expect(chunk.isError).toBe(true);
    });

    it("should handle null content in tool results", () => {
      const message: SDKUserMessage = {
        type: "user",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-999",
              content: null,
              is_error: false,
            },
          ],
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      const chunk = chunks[0] as ToolResultChunk;
      expect(chunk.content).toBeNull();
    });

    it("should not yield chunks for string content user messages", () => {
      const message: SDKUserMessage = {
        type: "user",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "user",
          content: "User input text",
        },
        parent_tool_use_id: null,
      };

      const chunks = [...transformSDKMessage(message)];
      expect(chunks).toHaveLength(0);
    });
  });

  describe("result messages", () => {
    it("should transform success result to UsageChunk", () => {
      const message: SDKResultMessageSuccess = {
        type: "result",
        subtype: "success",
        uuid: testUUID(),
        session_id: "session-123",
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        num_turns: 3,
        result: "Task completed successfully",
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
        modelUsage: {},
        permission_denials: [],
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("usage");

      const chunk = chunks[0] as UsageChunk;
      expect(chunk.usage.input_tokens).toBe(1000);
      expect(chunk.usage.output_tokens).toBe(500);
      expect(chunk.totalCostUsd).toBe(0.05);
      expect(chunk.durationMs).toBe(5000);
      expect(chunk.numTurns).toBe(3);
      expect(chunk.isError).toBe(false);
    });

    it("should transform error result with errors array", () => {
      const message: SDKResultMessageError = {
        type: "result",
        subtype: "error_during_execution",
        uuid: testUUID(),
        session_id: "session-123",
        duration_ms: 2000,
        duration_api_ms: 1800,
        is_error: true,
        num_turns: 1,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 500,
          output_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        errors: ["Connection timeout", "Rate limit exceeded"],
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      const chunk = chunks[0] as UsageChunk;
      expect(chunk.isError).toBe(true);
      expect(chunk.errors).toEqual(["Connection timeout", "Rate limit exceeded"]);
    });
  });

  describe("stream events (partial messages)", () => {
    it("should transform content_block_start with text block", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "Starting..." },
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text");

      const chunk = chunks[0] as TextChunk;
      expect(chunk.text).toBe("Starting...");
      expect(chunk.isPartial).toBe(true);
    });

    it("should transform content_block_start with thinking block", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "Hmm..." },
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking");

      const chunk = chunks[0] as ThinkingChunk;
      expect(chunk.thinking).toBe("Hmm...");
      expect(chunk.isPartial).toBe(true);
    });

    it("should transform content_block_start with tool_use block", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-abc",
            name: "Write",
            input: {},
          },
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool_use");

      const chunk = chunks[0] as ToolUseChunk;
      expect(chunk.toolUseId).toBe("tool-abc");
      expect(chunk.toolName).toBe("Write");
      expect(chunk.isPartial).toBe(true);
    });

    it("should transform content_block_delta with text_delta", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " more text" },
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text");

      const chunk = chunks[0] as TextChunk;
      expect(chunk.text).toBe(" more text");
      expect(chunk.isPartial).toBe(true);
    });

    it("should transform content_block_delta with thinking_delta", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: " continuing thought" },
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking");

      const chunk = chunks[0] as ThinkingChunk;
      expect(chunk.thinking).toBe(" continuing thought");
      expect(chunk.isPartial).toBe(true);
    });

    it("should transform content_block_delta with input_json_delta", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"file_path": "/test' },
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool_use");

      const chunk = chunks[0] as ToolUseChunk;
      expect(chunk.input).toEqual({ _partial: '{"file_path": "/test' });
      expect(chunk.isPartial).toBe(true);
    });

    it("should transform message_delta with usage", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "message_delta",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("usage");

      const chunk = chunks[0] as UsageChunk;
      expect(chunk.usage.input_tokens).toBe(100);
      expect(chunk.usage.output_tokens).toBe(50);
    });

    it("should not yield chunks for content_block_stop", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: 0,
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];
      expect(chunks).toHaveLength(0);
    });

    it("should not yield chunks for message_stop", () => {
      const message: SDKPartialAssistantMessage = {
        type: "stream_event",
        event: {
          type: "message_stop",
        },
        parent_tool_use_id: null,
        uuid: testUUID(),
        session_id: "session-123",
      };

      const chunks = [...transformSDKMessage(message)];
      expect(chunks).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("should yield error chunk on transformation failure", () => {
      // Create a message that will cause an error by having invalid structure
      const invalidMessage = {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              // Missing text property - this should cause an error when accessed
              get text(): string {
                throw new Error("Property access error");
              },
            },
          ],
        },
        parent_tool_use_id: null,
      } as SDKAssistantMessage;

      const chunks = [...transformSDKMessage(invalidMessage)];

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("error");

      const chunk = chunks[0] as ErrorChunk;
      expect(chunk.message).toContain("Property access error");
      expect(chunk.code).toBe("TRANSFORM_ERROR");
    });
  });
});

describe("transformSDKMessages", () => {
  it("should transform multiple messages", () => {
    const messages = [
      {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "First message" }],
        },
        parent_tool_use_id: null,
      } as SDKAssistantMessage,
      {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Second message" }],
        },
        parent_tool_use_id: null,
      } as SDKAssistantMessage,
    ];

    const chunks = [...transformSDKMessages(messages)];

    expect(chunks).toHaveLength(2);
    expect((chunks[0] as TextChunk).text).toBe("First message");
    expect((chunks[1] as TextChunk).text).toBe("Second message");
  });

  it("should handle empty messages array", () => {
    const chunks = [...transformSDKMessages([])];
    expect(chunks).toHaveLength(0);
  });
});

describe("transformSDKMessagesAsync", () => {
  it("should transform async iterable of messages", async () => {
    async function* generateMessages() {
      yield {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Async message 1" }],
        },
        parent_tool_use_id: null,
      } as SDKAssistantMessage;

      yield {
        type: "assistant",
        uuid: testUUID(),
        session_id: "session-123",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Async message 2" }],
        },
        parent_tool_use_id: null,
      } as SDKAssistantMessage;
    }

    const chunks: StreamChunk[] = [];
    for await (const chunk of transformSDKMessagesAsync(generateMessages())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect((chunks[0] as TextChunk).text).toBe("Async message 1");
    expect((chunks[1] as TextChunk).text).toBe("Async message 2");
  });
});
