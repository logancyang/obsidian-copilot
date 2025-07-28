import {
  processRawChatHistory,
  addChatHistoryToMessages,
  processedMessagesToTextOnly,
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
});
