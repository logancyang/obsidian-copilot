import {
  loadAndAddChatHistory,
  processRawChatHistory,
  processedMessagesToTextOnly,
} from "./chatHistoryUtils";

jest.mock("@/logger");

describe("chatHistoryUtils", () => {
  describe("processRawChatHistory()", () => {
    it("maps human and ai LangChain messages to user and assistant turns", () => {
      const rawHistory = [
        {
          type: "human",
          content: "Hello",
        },
        {
          type: "ai",
          content: "Hi there!",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });

    it("keeps multimodal content arrays as they are", () => {
      const multimodalContent = [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
      ];

      const rawHistory = [
        {
          type: "human",
          content: multimodalContent,
        },
        {
          type: "ai",
          content: "This is an image of a cat.",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([
        { role: "user", content: multimodalContent },
        { role: "assistant", content: "This is an image of a cat." },
      ]);
    });

    it("drops system messages", () => {
      const rawHistory = [
        {
          type: "system",
          content: "You are a helpful assistant",
        },
        {
          type: "human",
          content: "Hello",
        },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("maps legacy role and sender fields to user and assistant turns", () => {
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

    it("skips null, undefined, empty and content-less entries", () => {
      const rawHistory = [
        null,
        undefined,
        {
          type: "human",
          content: "Hello",
        },
        {},
        { content: undefined },
      ];

      const result = processRawChatHistory(rawHistory);

      expect(result).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("drops messages whose type or role is unknown", () => {
      const rawHistory = [
        {
          type: "unknown",
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

  describe("processedMessagesToTextOnly()", () => {
    it("keeps string content as it is", () => {
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

    it("reduces multimodal content to its text part", () => {
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

    it("joins several text parts with a space and drops the images between them", () => {
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

    it("replaces image-only content with an [Image content] placeholder", () => {
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
  describe("loadAndAddChatHistory()", () => {
    it("appends the processed memory history to the messages and returns it", async () => {
      const memory = {
        loadMemoryVariables: jest.fn().mockResolvedValue({
          history: [
            { type: "human", content: "Hello" },
            { type: "ai", content: "Hi there!" },
          ],
        }),
      };
      const messages = [{ role: "system", content: "You are helpful" }];

      const history = await loadAndAddChatHistory(memory, messages);

      expect(history).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
      expect(messages).toEqual([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });

    it("leaves the messages untouched when memory has no history", async () => {
      const memory = { loadMemoryVariables: jest.fn().mockResolvedValue({}) };
      const messages = [{ role: "system", content: "You are helpful" }];

      const history = await loadAndAddChatHistory(memory, messages);

      expect(history).toEqual([]);
      expect(messages).toEqual([{ role: "system", content: "You are helpful" }]);
    });
  });
});
