/**
 * Unit tests for MessageChannel
 */

import { MessageChannel, createPromptChannel } from "./MessageChannel";
import { SDKUserMessage } from "./types";

// Mock the logger to prevent console output during tests
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("MessageChannel", () => {
  describe("constructor", () => {
    it("should create a channel with auto-generated session ID", () => {
      const channel = new MessageChannel();
      expect(channel.isClosed()).toBe(false);
      expect(channel.queueSize()).toBe(0);
    });

    it("should create a channel with provided session ID", () => {
      const channel = new MessageChannel("custom-session-id");
      expect(channel.isClosed()).toBe(false);
    });
  });

  describe("push", () => {
    it("should queue a string message", () => {
      const channel = new MessageChannel();
      const result = channel.push("Hello, world!");
      expect(result).toBe(true);
      expect(channel.queueSize()).toBe(1);
    });

    it("should queue an SDKUserMessage directly", () => {
      const channel = new MessageChannel("test-session");
      const message: SDKUserMessage = {
        type: "user",
        session_id: "test-session",
        message: {
          role: "user",
          content: "Direct message",
        },
        parent_tool_use_id: null,
      };

      const result = channel.push(message);
      expect(result).toBe(true);
      expect(channel.queueSize()).toBe(1);
    });

    it("should return false when pushing to closed channel", () => {
      const channel = new MessageChannel();
      channel.close();

      const result = channel.push("Too late!");
      expect(result).toBe(false);
      expect(channel.queueSize()).toBe(0);
    });
  });

  describe("message merging", () => {
    it("should merge consecutive text messages", () => {
      const channel = new MessageChannel();
      channel.push("First message");
      channel.push("Second message");

      expect(channel.queueSize()).toBe(1);
    });

    it("should merge up to MAX_MERGED_TEXT_LENGTH (12000 chars)", () => {
      const channel = new MessageChannel();

      // Create messages that will stay under the limit when merged
      // 5999 + 1 (newline) + 5999 = 11999, which is under 12000
      const longMessage1 = "a".repeat(5999);
      const longMessage2 = "b".repeat(5999);
      channel.push(longMessage1);
      channel.push(longMessage2); // Should merge (total 11999)

      expect(channel.queueSize()).toBe(1);

      // This one should exceed the limit and not merge
      // 11999 + 1 (newline) + 1 = 12001, which exceeds 12000
      channel.push("c");
      expect(channel.queueSize()).toBe(2);
    });

    it("should not merge non-string content messages", () => {
      const channel = new MessageChannel("test-session");

      // Push a message with non-string content
      const complexMessage: SDKUserMessage = {
        type: "user",
        session_id: "test-session",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-123",
              content: "Result",
            },
          ],
        },
        parent_tool_use_id: null,
      };

      channel.push("First message");
      channel.push(complexMessage);

      // Should not merge because complexMessage has array content
      expect(channel.queueSize()).toBe(2);
    });
  });

  describe("queue depth", () => {
    it("should respect MAX_QUEUE_DEPTH of 8 messages", () => {
      const channel = new MessageChannel("test-session");

      // Push messages that won't merge (using complex content)
      for (let i = 0; i < 10; i++) {
        const message: SDKUserMessage = {
          type: "user",
          session_id: "test-session",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `tool-${i}`,
                content: `Message ${i}`,
              },
            ],
          },
          parent_tool_use_id: null,
        };
        channel.push(message);
      }

      // Queue should be capped at 8
      expect(channel.queueSize()).toBe(8);
    });

    it("should drop oldest message when queue is full", async () => {
      const channel = new MessageChannel("test-session");

      // Fill the queue with distinct messages
      for (let i = 0; i < 8; i++) {
        const message: SDKUserMessage = {
          type: "user",
          session_id: "test-session",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `tool-${i}`,
                content: `Message ${i}`,
              },
            ],
          },
          parent_tool_use_id: null,
        };
        channel.push(message);
      }

      // Push one more
      const newMessage: SDKUserMessage = {
        type: "user",
        session_id: "test-session",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-new",
              content: "New message",
            },
          ],
        },
        parent_tool_use_id: null,
      };
      channel.push(newMessage);

      // Get the first message - it should be "Message 1" (not 0, which was dropped)
      const iterator = channel[Symbol.asyncIterator]();
      const first = await iterator.next();

      expect(first.done).toBe(false);
      const content = first.value?.message.content;
      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect((content[0] as any).content).toBe("Message 1");
      }
    });
  });

  describe("async iteration", () => {
    it("should yield queued messages", async () => {
      const channel = new MessageChannel();
      channel.push("Message 1");
      channel.push("Message 2"); // Will merge with Message 1
      channel.close();

      const messages: SDKUserMessage[] = [];
      for await (const msg of channel) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].message.content).toContain("Message 1");
      expect(messages[0].message.content).toContain("Message 2");
    });

    it("should wait for messages when queue is empty", async () => {
      const channel = new MessageChannel();

      // Start consuming in background
      const consumePromise = (async () => {
        const messages: SDKUserMessage[] = [];
        for await (const msg of channel) {
          messages.push(msg);
          if (messages.length === 1) {
            // Close after receiving first message to end iteration
            channel.close();
          }
        }
        return messages;
      })();

      // Push message after a delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      channel.push("Delayed message");

      const messages = await consumePromise;
      expect(messages).toHaveLength(1);
      expect(messages[0].message.content).toBe("Delayed message");
    });

    it("should signal done when closed and queue is empty", async () => {
      const channel = new MessageChannel();
      channel.close();

      const iterator = channel[Symbol.asyncIterator]();
      const result = await iterator.next();

      expect(result.done).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it("should deliver remaining messages before signaling done", async () => {
      const channel = new MessageChannel("test-session");

      // Push distinct messages
      const msg1: SDKUserMessage = {
        type: "user",
        session_id: "test-session",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "1", content: "M1" }],
        },
        parent_tool_use_id: null,
      };
      const msg2: SDKUserMessage = {
        type: "user",
        session_id: "test-session",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "2", content: "M2" }],
        },
        parent_tool_use_id: null,
      };

      channel.push(msg1);
      channel.push(msg2);
      channel.close();

      const messages: SDKUserMessage[] = [];
      for await (const msg of channel) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(2);
    });
  });

  describe("close", () => {
    it("should mark channel as closed", () => {
      const channel = new MessageChannel();
      expect(channel.isClosed()).toBe(false);

      channel.close();
      expect(channel.isClosed()).toBe(true);
    });

    it("should be idempotent", () => {
      const channel = new MessageChannel();
      channel.close();
      channel.close(); // Should not throw

      expect(channel.isClosed()).toBe(true);
    });

    it("should resolve pending consumers with done", async () => {
      const channel = new MessageChannel();

      // Start waiting for a message
      const iterator = channel[Symbol.asyncIterator]();
      const pendingNext = iterator.next();

      // Close while waiting
      channel.close();

      const result = await pendingNext;
      expect(result.done).toBe(true);
    });
  });

  describe("clear", () => {
    it("should remove all queued messages", () => {
      const channel = new MessageChannel("test-session");

      // Push distinct messages
      for (let i = 0; i < 3; i++) {
        const message: SDKUserMessage = {
          type: "user",
          session_id: "test-session",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: `${i}`, content: `M${i}` }],
          },
          parent_tool_use_id: null,
        };
        channel.push(message);
      }

      expect(channel.queueSize()).toBe(3);

      channel.clear();
      expect(channel.queueSize()).toBe(0);
    });
  });

  describe("iterator.throw", () => {
    it("should close channel and reject pending promises", async () => {
      const channel = new MessageChannel();

      const iterator = channel[Symbol.asyncIterator]();

      // Start waiting for a message
      const pendingNext = iterator.next();

      // Throw error
      const testError = new Error("Test error");
      await iterator.throw?.(testError);

      expect(channel.isClosed()).toBe(true);

      // Pending promise should reject
      await expect(pendingNext).rejects.toThrow("Test error");
    });
  });

  describe("iterator.return", () => {
    it("should close the channel", async () => {
      const channel = new MessageChannel();

      const iterator = channel[Symbol.asyncIterator]();
      await iterator.return?.();

      expect(channel.isClosed()).toBe(true);
    });
  });
});

describe("createPromptChannel", () => {
  it("should create a channel with prompt and close it", () => {
    const channel = createPromptChannel("Test prompt");

    expect(channel.queueSize()).toBe(1);
    expect(channel.isClosed()).toBe(true);
  });

  it("should use provided session ID", async () => {
    const channel = createPromptChannel("Test prompt", "my-session");

    const iterator = channel[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.done).toBe(false);
    expect(result.value?.session_id).toBe("my-session");
  });
});
