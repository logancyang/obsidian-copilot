import { MessageRepository } from "./MessageRepository";
import { ChatMessage, MessageContext, StoredMessage } from "@/types/message";
import { formatDateTime } from "@/utils";
import { TFile } from "obsidian";

// Mock dependencies
jest.mock("@/utils", () => ({
  formatDateTime: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

describe("MessageRepository", () => {
  let messageRepo: MessageRepository;
  let mockFormattedDateTime: any;

  beforeEach(() => {
    messageRepo = new MessageRepository();
    mockFormattedDateTime = {
      display: "2023-12-01 10:30:00",
      epoch: 1701423000000,
    };
    (formatDateTime as jest.Mock).mockReturnValue(mockFormattedDateTime);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("addMessage", () => {
    it("should add a message with basic properties", () => {
      const messageId = messageRepo.addMessage("Hello", "Hello", "user");

      expect(messageId).toBeDefined();
      expect(messageId).toMatch(/^msg-\d+-\w+$/);

      const message = messageRepo.getMessage(messageId);
      expect(message).toEqual({
        id: messageId,
        message: "Hello",
        originalMessage: "Hello",
        sender: "user",
        timestamp: mockFormattedDateTime,
        isVisible: true,
        context: undefined,
        contextEnvelope: undefined,
        isErrorMessage: false,
        sources: undefined,
        content: undefined,
      });
    });

    it("should add a message with context", () => {
      const mockFile = { path: "test.md", basename: "test" } as TFile;
      const context: MessageContext = {
        notes: [mockFile],
        urls: ["https://example.com"],
        selectedTextContexts: [],
      };

      const messageId = messageRepo.addMessage("Hello", "Hello with context", "user", context);

      const message = messageRepo.getMessage(messageId);
      expect(message?.context).toEqual(context);
      expect(message?.contextEnvelope).toBeUndefined();
    });

    it("should store both display and processed text", () => {
      const messageId = messageRepo.addMessage("Hello", "Hello with context added", "user");

      const displayMessage = messageRepo.getMessage(messageId);
      expect(displayMessage?.message).toBe("Hello");
      expect(displayMessage?.contextEnvelope).toBeUndefined();

      const llmMessage = messageRepo.getLLMMessage(messageId);
      expect(llmMessage?.message).toBe("Hello with context added");
    });
  });

  describe("getDisplayMessages", () => {
    it("should return only visible messages with display text", () => {
      messageRepo.addMessage("Hello", "Hello", "user");
      messageRepo.addMessage("Response", "Response", "AI");

      const messages = messageRepo.getDisplayMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0].message).toBe("Hello");
      expect(messages[1].message).toBe("Response");
      expect(messages[0].isVisible).toBe(true);
      expect(messages[1].isVisible).toBe(true);
      expect(messages[0].contextEnvelope).toBeUndefined();
    });

    it("should filter out invisible messages", () => {
      messageRepo.addMessage("Hello", "Hello", "user");

      // Make message invisible by directly accessing internal array
      const internalMessages = (messageRepo as any).messages as StoredMessage[];
      internalMessages[0].isVisible = false;

      const messages = messageRepo.getDisplayMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe("getLLMMessages", () => {
    it("should return all messages with display text (for history, no context)", () => {
      const id1 = messageRepo.addMessage("Hello", "Hello with context", "user");
      messageRepo.addMessage("Response", "Response", "AI");

      // getLLMMessages() returns display text for chat history (no context)
      const messages = messageRepo.getLLMMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0].message).toBe("Hello"); // Display text only
      expect(messages[1].message).toBe("Response");
      expect(messages[0].isVisible).toBe(false); // LLM messages are not visible
      expect(messages[1].isVisible).toBe(false);

      // For full context, use getLLMMessage(id)
      const fullMessage = messageRepo.getLLMMessage(id1);
      expect(fullMessage?.message).toBe("Hello with context");
    });
  });

  describe("editMessage", () => {
    it("should update message text and mark for reprocessing", () => {
      const messageId = messageRepo.addMessage("Hello", "Hello", "user");

      const success = messageRepo.editMessage(messageId, "Hi there");

      expect(success).toBe(true);

      const message = messageRepo.getMessage(messageId);
      expect(message?.message).toBe("Hi there");
      expect(message?.originalMessage).toBe("Hi there");
    });

    it("should return false for non-existent message", () => {
      const success = messageRepo.editMessage("non-existent", "New text");
      expect(success).toBe(false);
    });
  });

  describe("updateProcessedText", () => {
    it("should update processed text for existing message", () => {
      const messageId = messageRepo.addMessage("Hello", "Hello", "user");

      const success = messageRepo.updateProcessedText(messageId, "Hello with context");

      expect(success).toBe(true);

      const llmMessage = messageRepo.getLLMMessage(messageId);
      expect(llmMessage?.message).toBe("Hello with context");

      // Display message should remain unchanged
      const displayMessage = messageRepo.getMessage(messageId);
      expect(displayMessage?.message).toBe("Hello");
    });

    it("should return false for non-existent message", () => {
      const success = messageRepo.updateProcessedText("non-existent", "New text");
      expect(success).toBe(false);
    });
  });

  describe("truncateAfterMessageId", () => {
    it("should remove all messages after specified message", () => {
      const messageId1 = messageRepo.addMessage("First", "First", "user");
      messageRepo.addMessage("Second", "Second", "AI");
      messageRepo.addMessage("Third", "Third", "user");

      messageRepo.truncateAfterMessageId(messageId1);

      const messages = messageRepo.getDisplayMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(messageId1);
    });

    it("should do nothing if message ID not found", () => {
      messageRepo.addMessage("First", "First", "user");
      messageRepo.addMessage("Second", "Second", "AI");

      messageRepo.truncateAfterMessageId("non-existent");

      const messages = messageRepo.getDisplayMessages();
      expect(messages).toHaveLength(2);
    });
  });

  describe("deleteMessage", () => {
    it("should remove message by ID", () => {
      const messageId1 = messageRepo.addMessage("First", "First", "user");
      const messageId2 = messageRepo.addMessage("Second", "Second", "AI");

      const success = messageRepo.deleteMessage(messageId1);

      expect(success).toBe(true);

      const messages = messageRepo.getDisplayMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(messageId2);
    });

    it("should return false for non-existent message", () => {
      const success = messageRepo.deleteMessage("non-existent");
      expect(success).toBe(false);
    });
  });

  describe("addMessage with ChatMessage object", () => {
    it("should add message from ChatMessage object", () => {
      const chatMessage: ChatMessage = {
        id: "test-id",
        message: "Test message",
        sender: "user",
        timestamp: mockFormattedDateTime,
        isVisible: true,
        context: {
          notes: [],
          urls: [],
          selectedTextContexts: [],
        },
      };

      const messageId = messageRepo.addMessage(chatMessage);

      expect(messageId).toBe("test-id");

      const retrievedMessage = messageRepo.getMessage("test-id");
      expect(retrievedMessage?.message).toBe("Test message");
      expect(retrievedMessage?.context).toEqual(chatMessage.context);
    });

    it("should generate ID if not provided", () => {
      const chatMessage: ChatMessage = {
        message: "Test message",
        sender: "user",
        timestamp: mockFormattedDateTime,
        isVisible: true,
      };

      const messageId = messageRepo.addMessage(chatMessage);

      expect(messageId).toBeDefined();
      expect(messageId).toMatch(/^msg-\d+-\w+$/);
    });
  });

  describe("clear", () => {
    it("should remove all messages", () => {
      messageRepo.addMessage("First", "First", "user");
      messageRepo.addMessage("Second", "Second", "AI");

      messageRepo.clear();

      const messages = messageRepo.getDisplayMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe("getDebugInfo", () => {
    it("should return debug information", () => {
      messageRepo.addMessage("First", "First", "user");
      messageRepo.addMessage("Second", "Second", "AI");

      const debugInfo = messageRepo.getDebugInfo();

      expect(debugInfo).toEqual({
        totalMessages: 2,
        visibleMessages: 2,
        userMessages: 1,
        aiMessages: 1,
      });
    });
  });

  describe("Bug Prevention Tests", () => {
    describe("Context Badge Bug Prevention", () => {
      it("should preserve context when creating display messages", () => {
        const mockFile = { path: "test.md", basename: "test" } as TFile;
        const context: MessageContext = {
          notes: [mockFile],
          urls: ["https://example.com"],
          selectedTextContexts: [],
        };

        const messageId = messageRepo.addMessage("Hello", "Hello", "user", context);

        const displayMessage = messageRepo.getMessage(messageId);
        expect(displayMessage?.context).toBeDefined();
        expect(displayMessage?.context?.notes).toHaveLength(1);
        expect(displayMessage?.context?.notes[0]).toEqual(mockFile);
      });
    });

    describe("Memory Synchronization Bug Prevention", () => {
      it("should maintain consistent message count after truncation", () => {
        const messageId1 = messageRepo.addMessage("First", "First", "user");
        messageRepo.addMessage("Second", "Second", "AI");
        messageRepo.addMessage("Third", "Third", "user");

        expect(messageRepo.getLLMMessages()).toHaveLength(3);

        messageRepo.truncateAfterMessageId(messageId1);

        expect(messageRepo.getLLMMessages()).toHaveLength(1);
        expect(messageRepo.getDisplayMessages()).toHaveLength(1);
      });
    });

    describe("Edit Message Bug Prevention", () => {
      it("should maintain message integrity after editing", () => {
        const messageId = messageRepo.addMessage("Original", "Original", "user");

        const success = messageRepo.editMessage(messageId, "Edited");

        expect(success).toBe(true);

        const displayMessage = messageRepo.getMessage(messageId);
        expect(displayMessage?.message).toBe("Edited");
        expect(displayMessage?.id).toBe(messageId);
        expect(displayMessage?.sender).toBe("user");
      });
    });
  });
});
