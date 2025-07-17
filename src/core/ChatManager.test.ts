// Mock dependencies first to avoid circular dependencies
jest.mock("./MessageRepository");
jest.mock("./ContextManager");
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

jest.mock("@/chatUtils", () => ({
  updateChatMemory: jest.fn(),
}));

jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "llm_chain",
    COPILOT_PLUS_CHAIN: "copilot_plus_chain",
    PROJECT_CHAIN: "project_chain",
  },
}));

import { ChatManager } from "./ChatManager";
import { MessageRepository } from "./MessageRepository";
import { ContextManager } from "./ContextManager";
import { ChainType } from "@/chainFactory";
import { ChatMessage, MessageContext } from "@/types/message";
import { TFile } from "obsidian";

const USER_SENDER = "user";

describe("ChatManager", () => {
  let chatManager: ChatManager;
  let mockMessageRepo: jest.Mocked<MessageRepository>;
  let mockChainManager: any;
  let mockFileParserManager: any;
  let mockPlugin: any;
  let mockContextManager: jest.Mocked<ContextManager>;

  // Helper function to create mock messages
  const createMockMessage = (id: string, message: string, sender: string): ChatMessage => ({
    id,
    message,
    sender,
    timestamp: null,
    isVisible: true,
  });

  beforeEach(() => {
    // Setup mocks
    mockMessageRepo = {
      addMessage: jest.fn(),
      getMessage: jest.fn(),
      updateProcessedText: jest.fn(),
      truncateAfterMessageId: jest.fn(),
      deleteMessage: jest.fn(),
      addDisplayOnlyMessage: jest.fn(),
      addFullMessage: jest.fn(),
      clear: jest.fn(),
      getDisplayMessages: jest.fn(),
      getLLMMessages: jest.fn(),
      getLLMMessage: jest.fn(),
      editMessage: jest.fn(),
      getDebugInfo: jest.fn(),
    } as any;

    mockChainManager = {
      memoryManager: {
        clearChatMemory: jest.fn(),
      },
      runChain: jest.fn(),
    };

    mockFileParserManager = {};

    mockPlugin = {
      app: {
        workspace: {
          getActiveFile: jest.fn(),
        },
      },
      projectManager: {
        getCurrentChainManager: jest.fn().mockReturnValue(mockChainManager),
      },
    };

    mockContextManager = {
      processMessageContext: jest.fn(),
      reprocessMessageContext: jest.fn(),
    } as any;

    // Mock ContextManager.getInstance
    (ContextManager.getInstance as jest.Mock).mockReturnValue(mockContextManager);

    chatManager = new ChatManager(
      mockMessageRepo,
      mockChainManager,
      mockFileParserManager,
      mockPlugin
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("sendMessage", () => {
    it("should send a message with basic context", async () => {
      const mockActiveFile = { path: "active.md", basename: "active" } as TFile;
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
      };

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue("Hello with context");
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      const result = await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

      expect(result).toBe("msg-1");
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        "Hello",
        "Hello",
        USER_SENDER,
        context
      );
      expect(mockContextManager.processMessageContext).toHaveBeenCalledWith(
        mockMessage,
        mockFileParserManager,
        mockPlugin.app.vault,
        ChainType.LLM_CHAIN,
        false,
        mockActiveFile
      );
      expect(mockMessageRepo.updateProcessedText).toHaveBeenCalledWith(
        "msg-1",
        "Hello with context"
      );
    });

    it("should include active note in context when includeActiveNote is true", async () => {
      const mockActiveFile = { path: "active.md", basename: "active" } as TFile;
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
      };

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue("Hello with context");
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN, true);

      // Should have called addMessage with updated context that includes active note
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith("Hello", "Hello", USER_SENDER, {
        notes: [mockActiveFile],
        urls: [],
        selectedTextContexts: [],
      });
    });

    it("should handle case when no active file exists", async () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
      };

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue("Hello with context");
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      const result = await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN, true);

      expect(result).toBe("msg-1");
      // Should not include active note in context
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        "Hello",
        "Hello",
        USER_SENDER,
        context
      );
    });

    it("should handle errors gracefully", async () => {
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
      };

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(undefined); // Simulate failure

      await expect(
        chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN)
      ).rejects.toThrow();
    });
  });

  describe("editMessage", () => {
    it("should edit a message and reprocess context", async () => {
      const mockActiveFile = { path: "active.md", basename: "active" } as TFile;

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
      mockMessageRepo.editMessage.mockReturnValue(true);
      mockContextManager.reprocessMessageContext.mockResolvedValue(undefined);

      const result = await chatManager.editMessage("msg-1", "Edited message", ChainType.LLM_CHAIN);

      expect(result).toBe(true);
      expect(mockMessageRepo.editMessage).toHaveBeenCalledWith("msg-1", "Edited message");
      expect(mockContextManager.reprocessMessageContext).toHaveBeenCalledWith(
        "msg-1",
        mockMessageRepo,
        mockFileParserManager,
        mockPlugin.app.vault,
        ChainType.LLM_CHAIN,
        false,
        mockActiveFile
      );
    });

    it("should return false when message edit fails", async () => {
      mockMessageRepo.editMessage.mockReturnValue(false);

      const result = await chatManager.editMessage("msg-1", "Edited message", ChainType.LLM_CHAIN);

      expect(result).toBe(false);
      expect(mockContextManager.reprocessMessageContext).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      mockMessageRepo.editMessage.mockImplementation(() => {
        throw new Error("Edit failed");
      });

      const result = await chatManager.editMessage("msg-1", "Edited message", ChainType.LLM_CHAIN);

      expect(result).toBe(false);
    });
  });

  describe("regenerateMessage", () => {
    it("should regenerate AI message successfully", async () => {
      const mockAiMessage = createMockMessage("msg-2", "AI response", "AI");
      const mockUserMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const mockLLMMessage = createMockMessage("msg-1", "Hello with context", USER_SENDER);

      mockMessageRepo.getMessage.mockReturnValue(mockAiMessage);
      mockMessageRepo.getDisplayMessages.mockReturnValue([mockUserMessage, mockAiMessage]);
      mockMessageRepo.getLLMMessage.mockReturnValue(mockLLMMessage);
      mockChainManager.runChain.mockResolvedValue(undefined);

      const mockUpdateMessage = jest.fn();
      const mockAddMessage = jest.fn();

      const result = await chatManager.regenerateMessage(
        "msg-2",
        mockUpdateMessage,
        mockAddMessage
      );

      expect(result).toBe(true);
      expect(mockMessageRepo.truncateAfterMessageId).toHaveBeenCalledWith("msg-1");
      expect(mockChainManager.runChain).toHaveBeenCalledWith(
        mockLLMMessage,
        expect.any(AbortController),
        mockUpdateMessage,
        mockAddMessage,
        expect.any(Object)
      );
    });

    it("should return false when message not found", async () => {
      mockMessageRepo.getMessage.mockReturnValue(undefined);

      const result = await chatManager.regenerateMessage("msg-2", jest.fn(), jest.fn());

      expect(result).toBe(false);
    });

    it("should return false when user message has no ID", async () => {
      const mockAiMessage = createMockMessage("msg-2", "AI response", "AI");
      const mockUserMessage = {
        message: "Hello",
        sender: USER_SENDER,
        timestamp: null,
        isVisible: true,
      }; // No ID

      mockMessageRepo.getMessage.mockReturnValue(mockAiMessage);
      mockMessageRepo.getDisplayMessages.mockReturnValue([mockUserMessage, mockAiMessage]);

      const result = await chatManager.regenerateMessage("msg-2", jest.fn(), jest.fn());

      expect(result).toBe(false);
    });

    it("should return false when trying to regenerate first message", async () => {
      const mockFirstMessage = createMockMessage("msg-1", "First message", USER_SENDER);

      mockMessageRepo.getMessage.mockReturnValue(mockFirstMessage);
      mockMessageRepo.getDisplayMessages.mockReturnValue([mockFirstMessage]);

      const result = await chatManager.regenerateMessage("msg-1", jest.fn(), jest.fn());

      expect(result).toBe(false);
    });

    it("should handle errors gracefully", async () => {
      const mockAiMessage = createMockMessage("msg-2", "AI response", "AI");
      const mockUserMessage = createMockMessage("msg-1", "Hello", USER_SENDER);

      mockMessageRepo.getMessage.mockReturnValue(mockAiMessage);
      mockMessageRepo.getDisplayMessages.mockReturnValue([mockUserMessage, mockAiMessage]);
      mockChainManager.runChain.mockRejectedValue(new Error("Chain failed"));

      const result = await chatManager.regenerateMessage("msg-2", jest.fn(), jest.fn());

      expect(result).toBe(false);
    });
  });

  describe("deleteMessage", () => {
    it("should delete a message successfully", async () => {
      mockMessageRepo.deleteMessage.mockReturnValue(true);

      const result = await chatManager.deleteMessage("msg-1");

      expect(result).toBe(true);
      expect(mockMessageRepo.deleteMessage).toHaveBeenCalledWith("msg-1");
    });

    it("should return false when delete fails", async () => {
      mockMessageRepo.deleteMessage.mockReturnValue(false);

      const result = await chatManager.deleteMessage("msg-1");

      expect(result).toBe(false);
    });

    it("should handle errors gracefully", async () => {
      mockMessageRepo.deleteMessage.mockImplementation(() => {
        throw new Error("Delete failed");
      });

      const result = await chatManager.deleteMessage("msg-1");

      expect(result).toBe(false);
    });
  });

  describe("truncateAfterMessageId", () => {
    it("should truncate messages and update chain memory", async () => {
      const { updateChatMemory } = await import("@/chatUtils");

      mockMessageRepo.getLLMMessages.mockReturnValue([
        createMockMessage("msg-1", "Hello", USER_SENDER),
      ]);

      await chatManager.truncateAfterMessageId("msg-1");

      expect(mockMessageRepo.truncateAfterMessageId).toHaveBeenCalledWith("msg-1");
      expect(updateChatMemory).toHaveBeenCalledWith(
        expect.any(Array),
        mockChainManager.memoryManager
      );
    });
  });

  describe("clearMessages", () => {
    it("should clear all messages and chain history", () => {
      chatManager.clearMessages();

      expect(mockMessageRepo.clear).toHaveBeenCalled();
      expect(mockChainManager.memoryManager.clearChatMemory).toHaveBeenCalled();
    });
  });

  describe("addDisplayMessage", () => {
    it("should add a display message", () => {
      mockMessageRepo.addDisplayOnlyMessage.mockReturnValue("msg-1");

      const result = chatManager.addDisplayMessage("Hello", "AI");

      expect(result).toBe("msg-1");
      expect(mockMessageRepo.addDisplayOnlyMessage).toHaveBeenCalledWith("Hello", "AI", undefined);
    });

    it("should add a display message with custom ID", () => {
      mockMessageRepo.addDisplayOnlyMessage.mockReturnValue("custom-id");

      const result = chatManager.addDisplayMessage("Hello", "AI", "custom-id");

      expect(result).toBe("custom-id");
      expect(mockMessageRepo.addDisplayOnlyMessage).toHaveBeenCalledWith(
        "Hello",
        "AI",
        "custom-id"
      );
    });
  });

  describe("addFullMessage", () => {
    it("should add a full message", () => {
      const mockMessage: ChatMessage = {
        id: "msg-1",
        message: "Hello",
        sender: USER_SENDER,
        timestamp: null,
        isVisible: true,
      };

      mockMessageRepo.addFullMessage.mockReturnValue("msg-1");

      const result = chatManager.addFullMessage(mockMessage);

      expect(result).toBe("msg-1");
      expect(mockMessageRepo.addFullMessage).toHaveBeenCalledWith(mockMessage);
    });
  });

  describe("loadMessages", () => {
    it("should load messages from array", () => {
      const messages: ChatMessage[] = [
        createMockMessage("msg-1", "Hello", USER_SENDER),
        createMockMessage("msg-2", "Response", "AI"),
      ];

      chatManager.loadMessages(messages);

      expect(mockMessageRepo.clear).toHaveBeenCalled();
      expect(mockMessageRepo.addFullMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("getters", () => {
    it("should get display messages", () => {
      const mockMessages = [createMockMessage("msg-1", "Hello", USER_SENDER)];
      mockMessageRepo.getDisplayMessages.mockReturnValue(mockMessages);

      const result = chatManager.getDisplayMessages();

      expect(result).toEqual(mockMessages);
    });

    it("should get LLM messages", () => {
      const mockMessages = [
        { ...createMockMessage("msg-1", "Hello", USER_SENDER), isVisible: false },
      ];
      mockMessageRepo.getLLMMessages.mockReturnValue(mockMessages);

      const result = chatManager.getLLMMessages();

      expect(result).toEqual(mockMessages);
    });

    it("should get specific message", () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);

      const result = chatManager.getMessage("msg-1");

      expect(result).toEqual(mockMessage);
    });

    it("should get LLM message", () => {
      const mockMessage = { ...createMockMessage("msg-1", "Hello", USER_SENDER), isVisible: false };
      mockMessageRepo.getLLMMessage.mockReturnValue(mockMessage);

      const result = chatManager.getLLMMessage("msg-1");

      expect(result).toEqual(mockMessage);
    });
  });

  describe("Bug Prevention Tests", () => {
    describe("Context Badge Bug Prevention", () => {
      it("should include active note in context when includeActiveNote is true", async () => {
        const mockActiveFile = { path: "lesson4.md", basename: "Lesson 4" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = {
          notes: [],
          urls: [],
          selectedTextContexts: [],
        };

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue("Hello with context");
        mockMessageRepo.updateProcessedText.mockReturnValue(true);

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN, true);

        // Verify that active note was added to context
        expect(mockMessageRepo.addMessage).toHaveBeenCalledWith("Hello", "Hello", USER_SENDER, {
          notes: [mockActiveFile],
          urls: [],
          selectedTextContexts: [],
        });
      });
    });

    describe("Memory Synchronization Bug Prevention", () => {
      it("should update chain memory after truncation", async () => {
        const { updateChatMemory } = await import("@/chatUtils");

        mockMessageRepo.getLLMMessages.mockReturnValue([
          createMockMessage("msg-1", "Hello", USER_SENDER),
        ]);

        await chatManager.truncateAfterMessageId("msg-1");

        expect(updateChatMemory).toHaveBeenCalledWith(
          expect.any(Array),
          mockChainManager.memoryManager
        );
      });
    });

    describe("Edit Message Bug Prevention", () => {
      it("should reprocess context after editing", async () => {
        const mockActiveFile = { path: "active.md", basename: "active" } as TFile;

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockMessageRepo.editMessage.mockReturnValue(true);
        mockContextManager.reprocessMessageContext.mockResolvedValue(undefined);

        const result = await chatManager.editMessage(
          "msg-1",
          "Edited message",
          ChainType.LLM_CHAIN
        );

        expect(result).toBe(true);
        expect(mockContextManager.reprocessMessageContext).toHaveBeenCalledWith(
          "msg-1",
          mockMessageRepo,
          mockFileParserManager,
          mockPlugin.app.vault,
          ChainType.LLM_CHAIN,
          false,
          mockActiveFile
        );
      });
    });

    describe("Regeneration Bug Prevention", () => {
      it("should handle regeneration with proper message truncation", async () => {
        const mockAiMessage = createMockMessage("msg-2", "AI response", "AI");
        const mockUserMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const mockLLMMessage = createMockMessage("msg-1", "Hello with context", USER_SENDER);

        mockMessageRepo.getMessage.mockReturnValue(mockAiMessage);
        mockMessageRepo.getDisplayMessages.mockReturnValue([mockUserMessage, mockAiMessage]);
        mockMessageRepo.getLLMMessage.mockReturnValue(mockLLMMessage);
        mockChainManager.runChain.mockResolvedValue(undefined);

        const result = await chatManager.regenerateMessage("msg-2", jest.fn(), jest.fn());

        expect(result).toBe(true);
        expect(mockMessageRepo.truncateAfterMessageId).toHaveBeenCalledWith("msg-1");
        expect(mockChainManager.runChain).toHaveBeenCalledWith(
          mockLLMMessage,
          expect.any(AbortController),
          expect.any(Function),
          expect.any(Function),
          expect.any(Object)
        );
      });
    });
  });
});
