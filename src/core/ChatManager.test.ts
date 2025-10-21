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

jest.mock("@/LLMProviders/projectManager", () => {
  const mockFn = jest.fn().mockResolvedValue(null);
  return {
    __esModule: true,
    default: {
      instance: {
        getProjectContext: mockFn,
      },
    },
    __mockGetProjectContext: mockFn,
  };
});

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ enableCustomPromptTemplating: true }),
}));

jest.mock("@/system-prompts/systemPromptBuilder", () => ({
  getSystemPromptWithMemory: jest.fn().mockResolvedValue("Test system prompt"),
  getSystemPrompt: jest.fn().mockReturnValue("Test system prompt"),
  getEffectiveUserPrompt: jest.fn().mockReturnValue(""),
}));

jest.mock("@/system-prompts/state", () => ({
  getEffectiveSystemPromptContent: jest.fn().mockReturnValue(""),
}));

jest.mock("@/commands/customCommandUtils", () => ({
  processPrompt: jest.fn().mockResolvedValue({
    processedPrompt: "",
    includedFiles: [],
  }),
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
        expect.any(String), // systemPrompt
        expect.any(Array) // systemPromptIncludedFiles
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
        expect.any(String), // systemPrompt
        expect.any(Array) // systemPromptIncludedFiles
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
          expect.any(String), // systemPrompt
          expect.any(Array) // systemPromptIncludedFiles
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
      // Note: Raw URL is preserved (no normalization applied to stored URL)
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
      // Note: Raw URL is preserved (no normalization applied to stored URL)
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

    it("should merge active tab when only hash fragment differs (regression test for duplicate entries)", async () => {
      // Regression test: same page with different hash should NOT create duplicate entry
      const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        webTabs: [
          {
            url: "https://docs.example.com/guide#section1",
            title: "Guide - Section 1",
          },
        ],
      };

      // User navigated to a different section on the same page
      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({
          activeWebTabForMentions: {
            url: "https://docs.example.com/guide#section2",
            title: "Guide - Section 2",
            faviconUrl: "https://docs.example.com/favicon.ico",
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

      // Should merge (same page, different hash) - NOT create duplicate entry
      expect(webTabs).toHaveLength(1);
      // Active tab's URL (with its hash) is now preserved to support SPA routing
      expect(webTabs[0]).toEqual(
        expect.objectContaining({
          url: "https://docs.example.com/guide#section2", // Active tab's URL preserved (with hash)
          title: "Guide - Section 2", // Title updated from active tab
          faviconUrl: "https://docs.example.com/favicon.ico",
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
      // Note: Raw URL is preserved (no normalization applied to stored URL)
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

    it("should suppress active web tab when note selection exists (any selection suppresses)", async () => {
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

      // Any selection (including note selection) should suppress active web tab
      await chatManager.sendMessage("Check {activeWebTab}", context, ChainType.LLM_CHAIN);

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

      // Should NOT include active web tab because note selection exists
      expect(webTabs).toHaveLength(0);
      expect(webTabs.find((t: { isActive?: boolean }) => t.isActive)).toBeUndefined();
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

  describe("System Prompt Template Processing", () => {
    // Import mocked modules for manipulation
    const { processPrompt } = jest.requireMock("@/commands/customCommandUtils");
    const { getSystemPrompt, getSystemPromptWithMemory, getEffectiveUserPrompt } = jest.requireMock(
      "@/system-prompts/systemPromptBuilder"
    );
    const { getSettings } = jest.requireMock("@/settings/model");
    const { getCurrentProject } = jest.requireMock("@/aiParams");

    beforeEach(() => {
      // Reset to defaults
      getEffectiveUserPrompt.mockReturnValue("");
      processPrompt.mockResolvedValue({ processedPrompt: "", includedFiles: [] });
      getSystemPrompt.mockReturnValue("Test system prompt");
      getSystemPromptWithMemory.mockResolvedValue("Test system prompt");
      getSettings.mockReturnValue({ enableCustomPromptTemplating: true });
      getCurrentProject.mockReturnValue(null);
    });

    describe("Template Skip Logic", () => {
      it("should not call processPrompt when user custom prompt has no template variables", async () => {
        const mockActiveFile = { path: "active.md", basename: "active" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // User custom prompt without any { } characters, with trailing whitespace
        const userCustomPrompt = "Simple prompt without templates    ";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // processPrompt should NOT be called because no template tokens in user custom prompt
        expect(processPrompt).not.toHaveBeenCalled();

        // Trailing whitespace should be preserved (no trimEnd when templates not processed)
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain(userCustomPrompt);
      });

      it("should call processPrompt for JSON but preserve content (handled internally)", async () => {
        const mockActiveFile = { path: "active.md", basename: "active" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // User custom prompt with JSON - processPrompt will be called but JSON is handled internally
        const userCustomPrompt = '{"foo": "bar", "nested": {"a": 1}}';
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        // processPrompt will be called but should return the JSON unchanged
        // (because processPrompt internally checks if variableName.startsWith('"'))
        processPrompt.mockResolvedValue({
          processedPrompt: userCustomPrompt,
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // processPrompt IS called (because prompt contains { and })
        expect(processPrompt).toHaveBeenCalled();

        // JSON content should be preserved (processPrompt handles it internally)
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain(userCustomPrompt.trimEnd());
      });

      it("should treat {} as literal in system prompts (not expand to activeNote)", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use format: {} for placeholders";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        // Mock processPrompt to return {} unchanged (because skipEmptyBraces: true)
        processPrompt.mockResolvedValue({
          processedPrompt: userCustomPrompt,
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify processPrompt was called with skipEmptyBraces: true
        expect(processPrompt).toHaveBeenCalledWith(
          userCustomPrompt,
          "",
          mockPlugin.app.vault,
          mockActiveFile,
          true
        );

        // Verify {} is preserved as literal
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain("{}");
      });

      it("should preserve trailing whitespace for JSON content", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // JSON with trailing whitespace
        const userCustomPrompt = '{"format": "json"}   \n';
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        // processPrompt returns JSON unchanged (handled internally)
        processPrompt.mockResolvedValue({
          processedPrompt: userCustomPrompt,
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Since processPrompt doesn't modify the JSON, trailing whitespace is trimmed by trimEnd()
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain('{"format": "json"}');
      });

      it("should not call processPrompt when enableCustomPromptTemplating is false", async () => {
        const mockActiveFile = { path: "active.md", basename: "active" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // User custom prompt WITH template variables but templating disabled
        getEffectiveUserPrompt.mockReturnValue("Use {activeNote} content");
        getSettings.mockReturnValue({ enableCustomPromptTemplating: false });
        getSystemPrompt.mockReturnValue(
          "DEFAULT\n<user_custom_instructions>\nUse {activeNote} content\n</user_custom_instructions>"
        );
        getSystemPromptWithMemory.mockResolvedValue(
          "DEFAULT\n<user_custom_instructions>\nUse {activeNote} content\n</user_custom_instructions>"
        );

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // processPrompt should NOT be called because templating is disabled
        expect(processPrompt).not.toHaveBeenCalled();
      });

      it("should not call processPrompt when no user custom prompt is set", async () => {
        const mockActiveFile = { path: "active.md", basename: "active" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // No user custom prompt
        getEffectiveUserPrompt.mockReturnValue("");

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // processPrompt should NOT be called because no user custom prompt
        expect(processPrompt).not.toHaveBeenCalled();
      });
    });

    describe("Template Processing", () => {
      it("should call processPrompt with correct arguments for {activeNote} template", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use context from {activeNote}";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        processPrompt.mockResolvedValue({
          processedPrompt: "Use context from {activeNote}\n\n<variable>...</variable>",
          includedFiles: [mockActiveFile],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify processPrompt was called with correct arguments
        expect(processPrompt).toHaveBeenCalledWith(
          userCustomPrompt, // prompt
          "", // selectedText (empty for system prompts)
          mockPlugin.app.vault, // vault
          mockActiveFile, // activeNote
          true // skipEmptyBraces (system prompts treat {} as literal)
        );
      });

      it("should pass includedFiles to contextManager for deduplication", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockIncludedFile = { path: "included.md", basename: "Included Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        getEffectiveUserPrompt.mockReturnValue("Use {activeNote}");
        getSystemPrompt.mockReturnValue(
          "DEFAULT\n<user_custom_instructions>\nUse {activeNote}\n</user_custom_instructions>"
        );
        getSystemPromptWithMemory.mockResolvedValue(
          "DEFAULT\n<user_custom_instructions>\nUse {activeNote}\n</user_custom_instructions>"
        );

        processPrompt.mockResolvedValue({
          processedPrompt: "Processed content",
          includedFiles: [mockIncludedFile],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify contextManager received includedFiles
        expect(mockContextManager.processMessageContext).toHaveBeenCalledWith(
          mockMessage,
          mockFileParserManager,
          mockPlugin.app.vault,
          ChainType.LLM_CHAIN,
          false,
          mockActiveFile,
          expect.anything(),
          expect.any(String),
          expect.arrayContaining([mockIncludedFile]) // Should contain the included file
        );
      });
    });

    describe("Injection Logic", () => {
      it("should inject processed content into user_custom_instructions block", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use {activeNote}";
        const processedContent = "Use {activeNote}\n\n<variable>Note content</variable>";

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        processPrompt.mockResolvedValue({
          processedPrompt: processedContent,
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify the system prompt passed to contextManager has injected content
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain("<user_custom_instructions>");
        expect(systemPromptArg).toContain(processedContent.trimEnd());
        expect(systemPromptArg).toContain("</user_custom_instructions>");
      });

      it("should preserve $ characters in user prompt without interpreting as replacement patterns", async () => {
        // Regression test: String.prototype.replace treats $&, $1, $$ etc. as special sequences.
        // Using function replacement avoids this issue.
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // User prompt containing $ patterns that would be misinterpreted by string replacement
        const userCustomPrompt = "Cost is $100. Use $& and $1 patterns. Double $$ too.";
        const processedContent = userCustomPrompt; // No template processing needed

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        // No templates, so processPrompt won't be called
        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify the $ characters are preserved exactly as-is
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain("$100");
        expect(systemPromptArg).toContain("$&");
        expect(systemPromptArg).toContain("$1");
        expect(systemPromptArg).toContain("$$");
        // Full content should be preserved
        expect(systemPromptArg).toContain(userCustomPrompt);

        // CRITICAL: Structural assertion to catch $& expansion bug
        // If $& were interpreted, it would inject the entire matched block, causing nested tags
        const openTagCount = ((systemPromptArg as string).match(/<user_custom_instructions>/g) || [])
          .length;
        const closeTagCount = ((systemPromptArg as string).match(/<\/user_custom_instructions>/g) ||
          []).length;
        expect(openTagCount).toBe(1);
        expect(closeTagCount).toBe(1);
      });

      it("should preserve $ characters when template processing is involved", async () => {
        // Regression test: Even when templates are processed, $ in output must not be interpreted
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // User prompt with template AND $ characters
        const userCustomPrompt = "Use {activeNote}. Price: $50 each, total $& cost.";
        // Simulated processed output still contains $
        const processedContent =
          "Use {activeNote}\n\n<variable>Note about $100 item</variable>. Price: $50 each, total $& cost.";

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        processPrompt.mockResolvedValue({
          processedPrompt: processedContent,
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify $ characters from processed content are preserved
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain("$100");
        expect(systemPromptArg).toContain("$50");
        expect(systemPromptArg).toContain("$&");

        // CRITICAL: Structural assertion to catch $& expansion bug
        // If $& were interpreted, it would inject the entire matched block, causing nested tags
        const openTagCount = ((systemPromptArg as string).match(/<user_custom_instructions>/g) || [])
          .length;
        const closeTagCount = ((systemPromptArg as string).match(/<\/user_custom_instructions>/g) ||
          []).length;
        expect(openTagCount).toBe(1);
        expect(closeTagCount).toBe(1);
      });
    });

    describe("Memory Preservation", () => {
      it("should preserve memory prefix and not process it for templates", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use {activeNote}";
        const memoryContent = "<user_memory>Some {curly} braces in memory</user_memory>";
        const systemPromptWithoutMemory = `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`;

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(systemPromptWithoutMemory);
        // Memory prefix + system prompt
        getSystemPromptWithMemory.mockResolvedValue(
          `${memoryContent}\n\n${systemPromptWithoutMemory}`
        );

        processPrompt.mockResolvedValue({
          processedPrompt: "Processed user content",
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify processPrompt was only called with user custom prompt, not memory
        expect(processPrompt).toHaveBeenCalledTimes(1);
        expect(processPrompt).toHaveBeenCalledWith(
          userCustomPrompt, // Only user custom prompt
          "",
          mockPlugin.app.vault,
          mockActiveFile,
          true // skipEmptyBraces
        );

        // Verify the final system prompt still contains memory prefix
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain(memoryContent);
      });
    });

    describe("Error Handling", () => {
      it("should return original prompt when processPrompt throws error", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use {activeNote}";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        // Make processPrompt throw an error
        processPrompt.mockRejectedValue(new Error("Template processing failed"));

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        // Should not throw, should continue with original prompt
        await expect(chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN)).resolves.toBe(
          "msg-1"
        );

        // Verify contextManager was still called (chat continues)
        expect(mockContextManager.processMessageContext).toHaveBeenCalled();
      });
    });

    describe("Builtin Disabled Branch", () => {
      it("should handle builtin disabled scenario (no user_custom_instructions block)", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // When builtin is disabled, getSystemPrompt returns userCustomPrompt directly
        const userCustomPrompt = "Custom prompt with {activeNote}";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        // No <user_custom_instructions> block - just the user prompt
        getSystemPrompt.mockReturnValue(userCustomPrompt);
        getSystemPromptWithMemory.mockResolvedValue(userCustomPrompt);

        const processedContent = "PROCESSED_CONTENT_ONLY";
        processPrompt.mockResolvedValue({
          processedPrompt: processedContent,
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        // Verify the system prompt is the processed content (not wrapped in block)
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toBe(processedContent.trimEnd());
        // Should NOT contain the original unprocessed prompt
        expect(systemPromptArg).not.toContain(userCustomPrompt);
      });

      it("should preserve memory prefix when builtin is disabled", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Custom {activeNote}";
        const memoryContent = "<user_memory>Memory content</user_memory>";

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(userCustomPrompt);
        // Memory + user prompt (no DEFAULT_SYSTEM_PROMPT)
        getSystemPromptWithMemory.mockResolvedValue(`${memoryContent}\n${userCustomPrompt}`);

        processPrompt.mockResolvedValue({
          processedPrompt: "PROCESSED",
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        // Should contain memory prefix
        expect(systemPromptArg).toContain(memoryContent);
        // Should contain processed content
        expect(systemPromptArg).toContain("PROCESSED");
      });
    });

    describe("EndsWith Mismatch Fallback", () => {
      it("should fallback to original base prompt when endsWith check fails", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use {activeNote}";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);

        // Simulate a mismatch: getSystemPrompt returns different content than
        // the suffix of getSystemPromptWithMemory (edge case, shouldn't happen normally)
        getSystemPrompt.mockReturnValue("DIFFERENT_SYSTEM_PROMPT");
        getSystemPromptWithMemory.mockResolvedValue(
          "Memory\n\nACTUAL_SYSTEM_PROMPT_THAT_DOESNT_MATCH"
        );

        processPrompt.mockResolvedValue({
          processedPrompt: "PROCESSED",
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        // Should not throw
        await expect(chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN)).resolves.toBe(
          "msg-1"
        );

        // Verify contextManager was called (chat continues)
        expect(mockContextManager.processMessageContext).toHaveBeenCalled();

        // In fallback case, should return original basePromptWithMemory unchanged
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toBe("Memory\n\nACTUAL_SYSTEM_PROMPT_THAT_DOESNT_MATCH");
      });
    });

    describe("Project Chain Integration", () => {
      // Access the mock function via requireMock
      const getProjectContextMock = () =>
        jest.requireMock("@/LLMProviders/projectManager").__mockGetProjectContext as jest.Mock;

      beforeEach(() => {
        // Reset mock for each test
        getProjectContextMock().mockReset();
        getProjectContextMock().mockResolvedValue(null);
      });

      it("should process project system prompt templates", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        // Setup project
        const mockProject = {
          id: "proj-1",
          name: "Test Project",
          systemPrompt: "Project prompt with {activeNote}",
        };
        getCurrentProject.mockReturnValue(mockProject);
        getProjectContextMock().mockResolvedValue("Project context data");

        // No user custom prompt
        getEffectiveUserPrompt.mockReturnValue("");
        getSystemPrompt.mockReturnValue("DEFAULT_SYSTEM_PROMPT");
        getSystemPromptWithMemory.mockResolvedValue("DEFAULT_SYSTEM_PROMPT");

        const projectIncludedFile = { path: "project-note.md", basename: "Project Note" } as TFile;
        processPrompt.mockResolvedValue({
          processedPrompt: "PROCESSED_PROJECT_PROMPT",
          includedFiles: [projectIncludedFile],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.PROJECT_CHAIN);

        // Verify processPrompt was called for project system prompt
        expect(processPrompt).toHaveBeenCalledWith(
          mockProject.systemPrompt,
          "",
          mockPlugin.app.vault,
          mockActiveFile,
          true // skipEmptyBraces
        );

        // Verify the final prompt contains project blocks
        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain("<project_system_prompt>");
        expect(systemPromptArg).toContain("PROCESSED_PROJECT_PROMPT");
        expect(systemPromptArg).toContain("</project_system_prompt>");
        expect(systemPromptArg).toContain("<project_context>");
        expect(systemPromptArg).toContain("Project context data");
        expect(systemPromptArg).toContain("</project_context>");

        // Verify includedFiles contains project file
        const includedFilesArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(includedFilesArg).toContainEqual(projectIncludedFile);
      });

      it("should merge includedFiles from both user and project prompts", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const mockProject = {
          id: "proj-1",
          name: "Test Project",
          systemPrompt: "Project {activeNote}",
        };
        getCurrentProject.mockReturnValue(mockProject);
        getProjectContextMock().mockResolvedValue(null);

        const userCustomPrompt = "User {activeNote}";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        const userIncludedFile = { path: "user-note.md", basename: "User Note" } as TFile;
        const projectIncludedFile = { path: "project-note.md", basename: "Project Note" } as TFile;

        // First call for user prompt, second call for project prompt
        processPrompt
          .mockResolvedValueOnce({
            processedPrompt: "PROCESSED_USER",
            includedFiles: [userIncludedFile],
          })
          .mockResolvedValueOnce({
            processedPrompt: "PROCESSED_PROJECT",
            includedFiles: [projectIncludedFile],
          });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.PROJECT_CHAIN);

        // Verify processPrompt was called twice (user + project)
        expect(processPrompt).toHaveBeenCalledTimes(2);

        // Verify includedFiles contains both files
        const includedFilesArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(includedFilesArg).toContainEqual(userIncludedFile);
        expect(includedFilesArg).toContainEqual(projectIncludedFile);
      });

      it("should not add project_context block when context is null", async () => {
        const mockActiveFile = { path: "test.md", basename: "Test Note" } as TFile;
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const mockProject = {
          id: "proj-1",
          name: "Test Project",
          systemPrompt: "Project prompt",
        };
        getCurrentProject.mockReturnValue(mockProject);
        getProjectContextMock().mockResolvedValue(null);

        getEffectiveUserPrompt.mockReturnValue("");
        getSystemPrompt.mockReturnValue("DEFAULT");
        getSystemPromptWithMemory.mockResolvedValue("DEFAULT");

        processPrompt.mockResolvedValue({
          processedPrompt: "PROCESSED",
          includedFiles: [],
        });

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.PROJECT_CHAIN);

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][7];
        expect(systemPromptArg).toContain("<project_system_prompt>");
        expect(systemPromptArg).not.toContain("<project_context>");
      });
    });
  });
});
