import {
  processRawChatHistory,
  addChatHistoryToMessages,
  processedMessagesToTextOnly,
  extractConversationTurns,
  estimateToolOutputSize,
} from "./chatHistoryUtils";

describe("chatHistoryUtils", () => {
  describe("processRawChatHistory", () => {
    it("should process BaseMessage objects correctly", () => {
      const rawHistory = [
        {
          _getType: () => "human",
          content: "Hello",
        },
        {
          _getType: () => "ai",
          content: "Hi there!",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });

    it("should handle multimodal content in BaseMessage objects", () => {
      const multimodalContent = [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
      ];

      const rawHistory = [
        {
          _getType: () => "human",
          content: multimodalContent,
        },
        {
          _getType: () => "ai",
          content: "This is an image of a cat.",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([
        { role: "user", content: multimodalContent },
        { role: "assistant", content: "This is an image of a cat." },
      ]);
    });

    it("should skip system messages", () => {
      const rawHistory = [
        {
          _getType: () => "system",
          content: "You are a helpful assistant",
        },
        {
          _getType: () => "human",
          content: "Hello",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("should handle legacy message formats", () => {
      const rawHistory = [
        {
          role: "human",
          content: "Hello",
        },
        {
          role: "ai",
          content: "Hi!",
        },
        {
          sender: "user",
          content: "How are you?",
        },
        {
          sender: "AI",
          content: "I am doing well!",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I am doing well!" },
      ]);
    });

    it("should handle null and undefined messages", () => {
      const rawHistory = [
        null,
        undefined,
        {
          _getType: () => "human",
          content: "Hello",
        },
        {},
        { content: undefined },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("should handle messages with unknown types", () => {
      const rawHistory = [
        {
          _getType: () => "unknown",
          content: "Some content",
        },
        {
          role: "unknown",
          content: "Other content",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([]);
    });
  });

  describe("addChatHistoryToMessages", () => {
    it("should add processed messages to target array", () => {
      const rawHistory = [
        {
          _getType: () => "human",
          content: "Hello",
        },
        {
          _getType: () => "ai",
          content: "Hi there!",
        },
      ];

      const messages: any[] = [];
      addChatHistoryToMessages(rawHistory, messages);

      expect(messages).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });

    it("should append to existing messages", () => {
      const rawHistory = [
        {
          _getType: () => "human",
          content: "Hello",
        },
      ];

      const messages = [{ role: "system", content: "You are helpful" }];

      addChatHistoryToMessages(rawHistory, messages);

      expect(messages).toEqual([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ]);
    });
  });

  describe("processedMessagesToTextOnly", () => {
    it("should handle string content", () => {
      const processedMessages = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];

      const result = processedMessagesToTextOnly(processedMessages);

      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });

    it("should extract text from multimodal content", () => {
      const processedMessages = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
          ],
        },
        {
          role: "assistant" as const,
          content: "This is a cat.",
        },
      ];

      const result = processedMessagesToTextOnly(processedMessages);

      expect(result).toEqual([
        { role: "user", content: "What is this?" },
        { role: "assistant", content: "This is a cat." },
      ]);
    });

    it("should handle multiple text parts in multimodal content", () => {
      const processedMessages = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "First part." },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
            { type: "text", text: "Second part." },
          ],
        },
      ];

      const result = processedMessagesToTextOnly(processedMessages);

      expect(result).toEqual([{ role: "user", content: "First part. Second part." }]);
    });

    it("should handle image-only content", () => {
      const processedMessages = [
        {
          role: "user" as const,
          content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }],
        },
      ];

      const result = processedMessagesToTextOnly(processedMessages);

      expect(result).toEqual([{ role: "user", content: "[Image content]" }]);
    });
  });

  describe("extractConversationTurns", () => {
    it("should extract complete turn pairs from even-length history", () => {
      const history = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
        { role: "user" as const, content: "How are you?" },
        { role: "assistant" as const, content: "I am doing well!" },
      ];

      const result = extractConversationTurns(history);

      expect(result.turns).toEqual([
        { user: "Hello", assistant: "Hi there!" },
        { user: "How are you?", assistant: "I am doing well!" },
      ]);
      expect(result.trailingUserMessage).toBeNull();
    });

    it("should detect trailing unpaired user message", () => {
      const history = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
        { role: "user" as const, content: "What about this?" },
      ];

      const result = extractConversationTurns(history);

      expect(result.turns).toEqual([{ user: "Hello", assistant: "Hi there!" }]);
      expect(result.trailingUserMessage).toBe("What about this?");
    });

    it("should handle single user message (no complete turns)", () => {
      const history = [{ role: "user" as const, content: "Hello" }];

      const result = extractConversationTurns(history);

      expect(result.turns).toEqual([]);
      expect(result.trailingUserMessage).toBe("Hello");
    });

    it("should handle empty history", () => {
      const result = extractConversationTurns([]);

      expect(result.turns).toEqual([]);
      expect(result.trailingUserMessage).toBeNull();
    });

    it("should handle multimodal content by extracting text", () => {
      const multimodalContent = [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
      ];

      const history = [
        { role: "user" as const, content: multimodalContent },
        { role: "assistant" as const, content: "This is a cat." },
        { role: "user" as const, content: "Tell me more" },
      ];

      const result = extractConversationTurns(history);

      // Should extract text content, not stringify (which would include huge base64 data)
      expect(result.turns).toEqual([{ user: "What is this?", assistant: "This is a cat." }]);
      expect(result.trailingUserMessage).toBe("Tell me more");
    });

    it("should handle trailing user message with multimodal content", () => {
      const multimodalContent = [{ type: "text", text: "Look at this" }];

      const history = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi!" },
        { role: "user" as const, content: multimodalContent },
      ];

      const result = extractConversationTurns(history);

      expect(result.turns).toEqual([{ user: "Hello", assistant: "Hi!" }]);
      // Should extract text content, not stringify
      expect(result.trailingUserMessage).toBe("Look at this");
    });

    it("should handle assistant-first history (e.g., BufferWindowMemory slice)", () => {
      // When BufferWindowMemory slices mid-conversation, history may start with assistant
      const history = [
        { role: "assistant" as const, content: "Starting message" }, // assistant first (sliced)
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi!" },
      ];

      const result = extractConversationTurns(history);

      // Should skip the orphaned assistant message and extract the user-assistant pair
      expect(result.turns).toEqual([{ user: "Hello", assistant: "Hi!" }]);
      expect(result.trailingUserMessage).toBeNull();
    });

    it("should handle multiple orphaned assistant messages at start", () => {
      const history = [
        { role: "assistant" as const, content: "Orphan 1" },
        { role: "assistant" as const, content: "Orphan 2" },
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi!" },
        { role: "user" as const, content: "Follow up" },
      ];

      const result = extractConversationTurns(history);

      // Should skip orphaned assistant messages, extract one turn, detect trailing user
      expect(result.turns).toEqual([{ user: "Hello", assistant: "Hi!" }]);
      expect(result.trailingUserMessage).toBe("Follow up");
    });

    it("should handle consecutive user messages (only last before assistant forms pair)", () => {
      const history = [
        { role: "user" as const, content: "First attempt" },
        { role: "user" as const, content: "Let me rephrase" },
        { role: "assistant" as const, content: "I understand now" },
      ];

      const result = extractConversationTurns(history);

      // First user message has no following assistant, second does
      expect(result.turns).toEqual([{ user: "Let me rephrase", assistant: "I understand now" }]);
      expect(result.trailingUserMessage).toBeNull();
    });
  });

  describe("estimateToolOutputSize", () => {
    it("should return 0 for empty tool outputs", () => {
      const result = estimateToolOutputSize([]);
      expect(result).toBe(0);
    });

    it("should calculate size for single tool output", () => {
      const toolOutputs = [{ tool: "search", output: "result data" }];

      const result = estimateToolOutputSize(toolOutputs);

      // "# Additional context:\n\n" = 23 chars (21 + 2 newlines)
      // "<search>\n" = 9 chars
      // "result data" = 11 chars
      // "\n</search>" = 10 chars
      // Total: 23 + 9 + 11 + 10 = 53
      expect(result).toBe(53);
    });

    it("should calculate size for multiple tool outputs with separators", () => {
      const toolOutputs = [
        { tool: "search", output: "abc" },
        { tool: "web", output: "xyz" },
      ];

      const result = estimateToolOutputSize(toolOutputs);

      // "# Additional context:\n\n" = 23 chars
      // "<search>\nabc\n</search>" = 9 + 3 + 10 = 22 chars
      // "\n\n" separator = 2 chars
      // "<web>\nxyz\n</web>" = 6 + 3 + 7 = 16 chars
      // Total: 23 + 22 + 2 + 16 = 63
      expect(result).toBe(63);
    });

    it("should stringify object outputs", () => {
      const toolOutputs = [{ tool: "api", output: { key: "value" } }];

      const result = estimateToolOutputSize(toolOutputs);

      // JSON.stringify({ key: "value" }) = '{"key":"value"}' = 15 chars
      // "# Additional context:\n\n" = 23 chars
      // "<api>\n" = 6 chars
      // jsonContent = 15 chars
      // "\n</api>" = 7 chars
      // Total: 23 + 6 + 15 + 7 = 51
      expect(result).toBe(51);
    });

    it("should handle tool outputs with long content", () => {
      const longContent = "x".repeat(10000);
      const toolOutputs = [{ tool: "data", output: longContent }];

      const result = estimateToolOutputSize(toolOutputs);

      // "# Additional context:\n\n" = 23 chars
      // "<data>\n" = 7 chars
      // longContent = 10000 chars
      // "\n</data>" = 8 chars
      // Total: 23 + 7 + 10000 + 8 = 10038
      expect(result).toBe(10038);
    });

    it("should match actual formatted output size", () => {
      // This test verifies the estimate matches the actual format used
      const toolOutputs = [
        { tool: "localSearch", output: "Found 5 results" },
        { tool: "webSearch", output: "Web results here" },
      ];

      const estimated = estimateToolOutputSize(toolOutputs);

      // Manually build what formatAllToolOutputs would produce
      const formatted =
        "# Additional context:\n\n" +
        "<localSearch>\nFound 5 results\n</localSearch>\n\n" +
        "<webSearch>\nWeb results here\n</webSearch>";

      expect(estimated).toBe(formatted.length);
    });
  });
});
