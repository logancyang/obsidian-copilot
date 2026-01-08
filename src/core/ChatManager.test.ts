// Mock dependencies first to avoid circular dependencies
jest.mock("./MessageRepository");
jest.mock("./ContextManager");
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
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

jest.mock("./ChatPersistenceManager", () => ({
  ChatPersistenceManager: jest.fn().mockImplementation(() => ({
    saveChat: jest.fn().mockResolvedValue({ success: true, path: "/test/path.md" }),
  })),
}));

jest.mock("@/aiParams", () => ({
  getCurrentProject: jest.fn().mockReturnValue(null),
}));

jest.mock("@/LLMProviders/projectManager", () => ({
  default: {
    instance: {
      getProjectContext: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock("@/settings/model", () => ({
  getSystemPromptWithMemory: jest.fn().mockResolvedValue("Test system prompt"),
  getSettings: jest.fn().mockReturnValue({}),
}));

jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(),
}));
import { ChatManager } from "./ChatManager";
import { MessageRepository } from "./MessageRepository";
import { ContextManager } from "./ContextManager";
import { ChainType } from "@/chainFactory";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import { ChatMessage, MessageContext } from "@/types/message";
import { TFile } from "obsidian";

const USER_SENDER = "user";
const createContextResult = (content = "Hello with context") => ({
  processedContent: content,
  contextEnvelope: undefined,
});

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
      clear: jest.fn(),
      getDisplayMessages: jest.fn(),
      getLLMMessages: jest.fn(),
      getLLMMessage: jest.fn(),
      editMessage: jest.fn(),
      getDebugInfo: jest.fn(),
      truncateAfter: jest.fn(),
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
        getCurrentProjectId: jest.fn().mockReturnValue(null),
        getCachedMessages: jest.fn().mockReturnValue(null),
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
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      const result = await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

      expect(result).toBe("msg-1");
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        "Hello",
        "Hello",
        USER_SENDER,
        {
          ...context,
          webTabs: [],
        },
        undefined
      );
      expect(mockContextManager.processMessageContext).toHaveBeenCalledWith(
        mockMessage,
        mockFileParserManager,
        mockPlugin.app.vault,
        ChainType.LLM_CHAIN,
        false,
        mockActiveFile,
        expect.anything(), // messageRepo
        expect.any(String) // systemPrompt
      );
      expect(mockMessageRepo.updateProcessedText).toHaveBeenCalledWith(
        "msg-1",
        "Hello with context",
        undefined
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
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN, true);

      // Should have called addMessage with updated context that includes active note
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        "Hello",
        "Hello",
        USER_SENDER,
        {
          notes: [mockActiveFile],
          urls: [],
          selectedTextContexts: [],
          webTabs: [],
        },
        undefined
      );
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
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      const result = await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN, true);

      expect(result).toBe("msg-1");
      // Should not include active note in context
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        "Hello",
        "Hello",
        USER_SENDER,
        {
          ...context,
          webTabs: [],
        },
        undefined
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
        mockActiveFile,
        expect.any(String) // systemPrompt
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
      mockMessageRepo.truncateAfter.mockReturnValue(undefined);
      mockChainManager.runChain.mockResolvedValue(undefined);

      const mockUpdateMessage = jest.fn();
      const mockAddMessage = jest.fn();

      const result = await chatManager.regenerateMessage(
        "msg-2",
        mockUpdateMessage,
        mockAddMessage
      );

      expect(result).toBe(true);
      expect(mockMessageRepo.truncateAfter).toHaveBeenCalledWith(0);
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

  describe("addMessage", () => {
    it("should add a message from ChatMessage object", () => {
      const mockMessage: ChatMessage = {
        id: "msg-1",
        message: "Hello",
        sender: USER_SENDER,
        timestamp: null,
        isVisible: true,
      };

      mockMessageRepo.addMessage.mockReturnValue("msg-1");

      const result = chatManager.addMessage(mockMessage);

      expect(result).toBe("msg-1");
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(mockMessage);
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
      expect(mockMessageRepo.addMessage).toHaveBeenCalledTimes(2);
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
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
        mockMessageRepo.updateProcessedText.mockReturnValue(true);

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN, true);

        // Verify that active note was added to context
        expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
          "Hello",
          "Hello",
          USER_SENDER,
          {
            notes: [mockActiveFile],
            urls: [],
            selectedTextContexts: [],
            webTabs: [],
          },
          undefined
        );
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
          mockActiveFile,
          expect.any(String) // systemPrompt
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
        mockMessageRepo.truncateAfter.mockReturnValue(undefined);
        mockChainManager.runChain.mockResolvedValue(undefined);

        const result = await chatManager.regenerateMessage("msg-2", jest.fn(), jest.fn());

        expect(result).toBe(true);
        expect(mockMessageRepo.truncateAfter).toHaveBeenCalledWith(0);
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

  describe("buildWebTabsWithActiveSnapshot (via sendMessage)", () => {
    const mockGetWebViewerService = getWebViewerService as jest.Mock;

    beforeEach(() => {
      mockGetWebViewerService.mockReset();
    });

    it("should include active web tab when includeActiveWebTab is true", async () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://active.example.com",
            title: "Active Page",
            faviconUrl: "https://active.example.com/favicon.ico",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage(
        "Hello",
        context,
        ChainType.LLM_CHAIN,
        false, // includeActiveNote
        true // includeActiveWebTab
      );

      // The webTabs should include the active tab with isActive: true
      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        "Hello",
        "Hello",
        USER_SENDER,
        expect.objectContaining({
          webTabs: expect.arrayContaining([
            expect.objectContaining({
              url: "https://active.example.com",
              isActive: true,
            }),
          ]),
        }),
        undefined
      );
    });

    it("should include active web tab when ACTIVE_WEB_TAB_MARKER is in text", async () => {
      const mockMessage = createMockMessage("msg-1", "Check {activeWebTab}", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://marker.example.com",
            title: "Marker Page",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      // includeActiveWebTab=false but marker in text should still trigger inclusion
      await chatManager.sendMessage("Check {activeWebTab}", context, ChainType.LLM_CHAIN);

      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        "Check {activeWebTab}",
        "Check {activeWebTab}",
        USER_SENDER,
        expect.objectContaining({
          webTabs: expect.arrayContaining([
            expect.objectContaining({
              url: "https://marker.example.com",
              isActive: true,
            }),
          ]),
        }),
        undefined
      );
    });

    it("should merge active tab with existing same-URL tab", async () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [
          {
            url: "https://same.example.com",
            title: "Old Title",
          },
        ],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://same.example.com",
            title: "New Title",
            faviconUrl: "https://same.example.com/new-favicon.ico",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage("Hello {activeWebTab}", context, ChainType.LLM_CHAIN);

      // Should merge and not duplicate
      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];
      expect(webTabs).toHaveLength(1);
      expect(webTabs[0]).toEqual(
        expect.objectContaining({
          url: "https://same.example.com",
          title: "New Title",
          faviconUrl: "https://same.example.com/new-favicon.ico",
          isActive: true,
        })
      );
    });

    it("should clear multiple isActive flags and keep only active tab as active", async () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [
          { url: "https://first.com", isActive: true },
          { url: "https://second.com", isActive: true },
        ],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://third.com",
            title: "Third",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage("Hello {activeWebTab}", context, ChainType.LLM_CHAIN);

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      // Only the new active tab should have isActive: true
      const activeTabs = webTabs.filter((t: { isActive?: boolean }) => t.isActive);
      expect(activeTabs).toHaveLength(1);
      expect(activeTabs[0].url).toBe("https://third.com");
    });

    it("should handle Web Viewer unavailable gracefully (mobile/error)", async () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [{ url: "https://existing.com" }],
      };

      // Simulate Web Viewer service throwing (mobile scenario)
      mockGetWebViewerService.mockImplementation(() => {
        throw new Error("Web Viewer not available on mobile");
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      // Should not throw, should return sanitized tabs unchanged
      await chatManager.sendMessage("Hello {activeWebTab}", context, ChainType.LLM_CHAIN);

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      // Should still have the existing tab, just sanitized
      expect(webTabs).toHaveLength(1);
      expect(webTabs[0]?.url).toBe("https://existing.com");
    });

    it("should return sanitized tabs unchanged when no active web tab available", async () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [{ url: "https://existing.com", title: "Existing" }],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: null, // No active tab
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage("Hello {activeWebTab}", context, ChainType.LLM_CHAIN);

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      expect(webTabs).toHaveLength(1);
      expect(webTabs[0]?.url).toBe("https://existing.com");
    });

    it("should not include active web tab when includeActiveWebTab is false and no marker", async () => {
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://should-not-appear.com",
            title: "Should Not Appear",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      // No marker in text, includeActiveWebTab defaults to false
      await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      expect(webTabs).toHaveLength(0);
    });

    it("should suppress active web tab when web selection exists (even with marker)", async () => {
      const mockMessage = createMockMessage("msg-1", "Check {activeWebTab}", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "web-selection-1",
            sourceType: "web",
            title: "Selected Page",
            url: "https://selected.example.com",
            content: "Some selected text from web",
          },
        ],
        webTabs: [],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://active.example.com",
            title: "Active Page",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      // Even with marker in text and includeActiveWebTab=true, web selection should suppress
      await chatManager.sendMessage(
        "Check {activeWebTab}",
        context,
        ChainType.LLM_CHAIN,
        false,
        true // includeActiveWebTab=true
      );

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      // Should NOT include active web tab because web selection exists
      expect(webTabs).toHaveLength(0);
      expect(webTabs.find((t: { isActive?: boolean }) => t.isActive)).toBeUndefined();
    });

    it("should include active web tab when note selection exists (not web selection)", async () => {
      const mockMessage = createMockMessage("msg-1", "Check {activeWebTab}", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "note-selection-1",
            sourceType: "note",
            noteTitle: "Test Note",
            notePath: "test.md",
            startLine: 1,
            endLine: 5,
            content: "Some selected text from note",
          },
        ],
        webTabs: [],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://active.example.com",
            title: "Active Page",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      // Note selection should NOT suppress active web tab
      await chatManager.sendMessage("Check {activeWebTab}", context, ChainType.LLM_CHAIN);

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      // Should include active web tab because only note selection exists
      expect(webTabs).toHaveLength(1);
      expect(webTabs[0]).toEqual(
        expect.objectContaining({
          url: "https://active.example.com",
          isActive: true,
        })
      );
    });

    it("should preserve existing webTabs but not inject active when web selection exists", async () => {
      const mockMessage = createMockMessage("msg-1", "Check {activeWebTab}", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "web-selection-1",
            sourceType: "web",
            title: "Selected Page",
            url: "https://selected.example.com",
            content: "Some selected text from web",
          },
        ],
        webTabs: [
          { url: "https://existing.example.com", title: "Existing Tab" },
        ],
      };

      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://active.example.com",
            title: "Active Page",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage(
        "Check {activeWebTab}",
        context,
        ChainType.LLM_CHAIN,
        false,
        true
      );

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      // Should preserve existing webTabs but NOT inject active tab
      expect(webTabs).toHaveLength(1);
      expect(webTabs[0]?.url).toBe("https://existing.example.com");
      expect(webTabs.find((t: { isActive?: boolean }) => t.isActive)).toBeUndefined();
    });

    it("should not call getWebViewerService when web selection exists", async () => {
      const mockMessage = createMockMessage("msg-1", "Check {activeWebTab}", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "web-selection-1",
            sourceType: "web",
            title: "Selected Page",
            url: "https://selected.example.com",
            content: "Some selected text from web",
          },
        ],
        webTabs: [],
      };

      // Reset mock to track calls
      mockGetWebViewerService.mockClear();
      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://active.example.com",
            title: "Active Page",
          },
        }),
      });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage(
        "Check {activeWebTab}",
        context,
        ChainType.LLM_CHAIN,
        false,
        true
      );

      // getWebViewerService should NOT be called because web selection suppresses active tab
      expect(mockGetWebViewerService).not.toHaveBeenCalled();
    });
  });
});
