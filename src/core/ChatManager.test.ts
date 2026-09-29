jest.mock("./MessageRepository");
jest.mock("@/LLMProviders/chatModelManager");
jest.mock("./ContextCompactor");
jest.mock("./ContextManager");
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/chatUtils", () => ({
  updateChatMemory: jest.fn(),
}));

jest.mock("./ChatPersistenceManager", () => ({
  ChatPersistenceManager: jest.fn().mockImplementation(() => ({
    saveChat: jest.fn().mockResolvedValue({ path: "/test/path.md" }),
    loadChat: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock("@/aiParams", () => ({
  getChainType: jest.fn().mockReturnValue("copilot_plus_chain"),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ enableCustomPromptTemplating: true }),
}));

jest.mock("@/system-prompts/systemPromptBuilder", () => ({
  getSystemPromptWithMemory: jest.fn().mockResolvedValue("Test system prompt"),
  getSystemPrompt: jest.fn().mockReturnValue("Test system prompt"),
  getEffectiveUserPrompt: jest.fn().mockReturnValue(""),
}));

jest.mock("@/commands/customCommandUtils", () => ({
  processPrompt: jest.fn().mockResolvedValue({
    processedPrompt: "",
    includedFiles: [],
  }),
}));

jest.mock("@/commands/state", () => ({
  getCachedCustomCommands: jest.fn().mockReturnValue([]),
}));

jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(),
}));
import { ChatPersistenceManager } from "./ChatPersistenceManager";
import { ChatManager } from "./ChatManager";
import { MessageRepository } from "./MessageRepository";
import { ContextManager } from "./ContextManager";
import type ChainManager from "@/LLMProviders/chainManager";
import type { FileParserManager } from "@/tools/FileParserManager";
import type CopilotPlugin from "@/main";
import { ChainType } from "@/chainType";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import { ChatMessage, MessageContext } from "@/types/message";
import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { mockTFile } from "@/__tests__/mockObsidian";
import { getCachedCustomCommands } from "@/commands/state";

const USER_SENDER = "user";
const createContextResult = (content = "Hello with context") => ({
  processedContent: content,
  contextEnvelope: undefined,
});

type MockChainManager = {
  memoryManager: { clearChatMemory: jest.Mock };
  runChain: jest.Mock;
};
type MockPlugin = {
  app: {
    workspace: { getActiveFile: jest.Mock };
    vault?: { adapter?: { stat: jest.Mock } };
  };
};

describe("ChatManager", () => {
  let chatManager: ChatManager;
  let mockMessageRepo: jest.Mocked<MessageRepository>;
  let mockChainManager: MockChainManager;
  let mockFileParserManager: object;
  let mockPlugin: MockPlugin;
  let mockContextManager: jest.Mocked<ContextManager>;

  const createMockMessage = (id: string, message: string, sender: string): ChatMessage => ({
    id,
    message,
    sender,
    timestamp: null,
    isVisible: true,
  });

  beforeEach(() => {
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
    } as unknown as jest.Mocked<MessageRepository>;

    mockChainManager = {
      memoryManager: {
        clearChatMemory: jest.fn().mockResolvedValue(undefined),
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
    };

    mockContextManager = {
      processMessageContext: jest.fn(),
      reprocessMessageContext: jest.fn(),
    } as unknown as jest.Mocked<ContextManager>;

    (ContextManager.getInstance as jest.Mock).mockReturnValue(mockContextManager);

    chatManager = new ChatManager(
      mockMessageRepo,
      mockChainManager as unknown as ChainManager,
      mockFileParserManager as FileParserManager,
      mockPlugin as unknown as CopilotPlugin
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("vault instruction integration", () => {
    const builder = jest.requireMock<Record<string, jest.Mock>>(
      "@/system-prompts/systemPromptBuilder"
    );
    const actualBuilder = jest.requireActual<typeof import("@/system-prompts/systemPromptBuilder")>(
      "@/system-prompts/systemPromptBuilder"
    );
    const state =
      jest.requireActual<typeof import("@/system-prompts/state")>("@/system-prompts/state");
    let instructions: string;
    let read: jest.Mock;
    const context = { notes: [], urls: [], selectedTextContexts: [] };

    beforeEach(() => {
      instructions = "Answer with citations.";
      state.resetSessionSystemPromptSettings();
      state.updateCachedSystemPrompts([]);
      for (const key of Object.keys(actualBuilder) as Array<keyof typeof actualBuilder>) {
        builder[key].mockImplementation(actualBuilder[key]);
      }
      jest.requireMock("@/settings/model").getSettings.mockReturnValue({
        enableCustomPromptTemplating: false,
        userSystemPrompt: "Obsolete instructions",
        defaultSystemPromptTitle: "Hidden default",
      });
      const file = mockTFile({ path: "AGENTS.md", basename: "AGENTS" });
      read = jest.fn(async () => instructions);
      Object.assign(mockPlugin.app, { vault: { getAbstractFileByPath: () => file, read } });
      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(createMockMessage("msg-1", "Hello", USER_SENDER));
      mockContextManager.processMessageContext.mockResolvedValue(createContextResult());
      mockMessageRepo.editMessage.mockReturnValue(true);
    });
    afterEach(() => {
      builder.getEffectiveUserPrompt.mockReset().mockReturnValue("");
      builder.getSystemPrompt.mockReset().mockReturnValue("Test system prompt");
      builder.getSystemPromptWithMemory.mockReset().mockResolvedValue("Test system prompt");
      jest
        .requireMock("@/settings/model")
        .getSettings.mockReturnValue({ enableCustomPromptTemplating: true });
    });

    describe("sendMessage()", () => {
      it("sends current root instructions once per message and sees edits in the same chat (https://github.com/logancyang/obsidian-copilot/issues/3210)", async () => {
        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);
        expect(mockContextManager.processMessageContext.mock.calls[0][8]).toContain(
          "Answer with citations."
        );
        instructions = "Answer in French.";
        await chatManager.sendMessage("Again", context, ChainType.LLM_CHAIN);
        expect(mockContextManager.processMessageContext.mock.calls[1][8]).toContain(
          "Answer in French."
        );
        expect(mockContextManager.processMessageContext.mock.calls[1][8]).not.toContain(
          "Answer with citations."
        );
        expect(read).toHaveBeenCalledTimes(2);
      });
      it("uses one instruction snapshot through memory loading and template expansion (https://github.com/logancyang/obsidian-copilot/issues/3210)", async () => {
        instructions = "Use {activeNote}.";
        jest
          .requireMock("@/settings/model")
          .getSettings.mockReturnValue({ enableCustomPromptTemplating: true });
        const includedFile = mockTFile({ path: "Plan.md", basename: "Plan" });
        jest.requireMock("@/commands/customCommandUtils").processPrompt.mockResolvedValueOnce({
          processedPrompt: "Use the launch plan.",
          includedFiles: [includedFile],
        });
        Object.assign(mockChainManager, {
          userMemoryManager: {
            getUserMemoryPrompt: async () => {
              instructions = "Changed during memory loading.";
              return "<memory>Timezone</memory>";
            },
          },
        });
        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);
        const call = mockContextManager.processMessageContext.mock.calls[0];
        expect(call[8]).toContain("<memory>Timezone</memory>");
        expect(call[8]).toContain("Use the launch plan.");
        expect(call[8]).not.toContain("Changed during memory loading.");
        expect(call[9]).toEqual([includedFile]);
        expect(read).toHaveBeenCalledTimes(1);
      });
    });
    describe("editMessage()", () => {
      it("uses current vault instructions when reprocessing an edited message (https://github.com/logancyang/obsidian-copilot/issues/3210)", async () => {
        instructions = "Use the updated rules.";
        expect(await chatManager.editMessage("msg-1", "Edited", ChainType.LLM_CHAIN)).toBe(true);
        expect(mockContextManager.reprocessMessageContext.mock.calls[0][8]).toContain(instructions);
      });
    });
    describe("regenerateMessage()", () => {
      it("reprocesses an existing envelope with current instructions before retrying (https://github.com/logancyang/obsidian-copilot/issues/3210)", async () => {
        const userMessage = { ...createMockMessage("msg-1", "Hello", USER_SENDER), context };
        const aiMessage = createMockMessage("msg-2", "Response", "AI");
        const oldMessage = {
          ...userMessage,
          contextEnvelope: { layers: [] } as unknown as PromptContextEnvelope,
        };
        const refreshedMessage = { ...oldMessage, message: "Refreshed original context" };
        mockMessageRepo.getMessage.mockReturnValue(aiMessage);
        mockMessageRepo.getDisplayMessages.mockReturnValue([userMessage, aiMessage]);
        mockMessageRepo.getLLMMessage
          .mockReturnValueOnce(oldMessage)
          .mockReturnValue(refreshedMessage);
        instructions = "Use changed retry instructions.";
        expect(await chatManager.regenerateMessage("msg-2", jest.fn(), jest.fn())).toBe(true);
        expect(mockContextManager.reprocessMessageContext.mock.calls[0]?.[8]).toContain(
          instructions
        );
        expect(mockContextManager.reprocessMessageContext.mock.calls[0]?.[1]).toBe("msg-1");
        expect(userMessage.context).toBe(context);
        expect(mockChainManager.runChain.mock.calls[0][0]).toBe(refreshedMessage);
      });
    });
  });

  describe("sendMessage", () => {
    it("should send a message with basic context", async () => {
      const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });
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
        mockPlugin.app,
        mockMessage,
        mockFileParserManager,
        mockPlugin.app.vault,
        ChainType.LLM_CHAIN,
        false,
        mockActiveFile,
        expect.anything(),
        expect.any(String),
        expect.any(Array),
        undefined
      );
      expect(mockMessageRepo.updateProcessedText).toHaveBeenCalledWith(
        "msg-1",
        "Hello with context",
        undefined
      );
    });

    it("replaces a Quick Chat slash alias with its full prompt before displaying and sending it (https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610)", async () => {
      const expandedPrompt = "Summarize the active note.\n\nfocus on decisions";
      const mockMessage = createMockMessage("msg-1", expandedPrompt, USER_SENDER);
      const context: MessageContext = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
      };
      const command = {
        title: "summarize",
        content: "Summarize the active note.",
        showInContextMenu: false,
        showInSlashMenu: true,
        order: 0,
        modelKey: "",
        lastUsedMs: 0,
      };

      (getCachedCustomCommands as jest.Mock).mockReturnValue([command]);
      mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
      mockMessageRepo.addMessage.mockReturnValue("msg-1");
      mockMessageRepo.getMessage.mockReturnValue(mockMessage);
      mockContextManager.processMessageContext.mockResolvedValue(
        createContextResult(expandedPrompt)
      );
      mockMessageRepo.updateProcessedText.mockReturnValue(true);

      await chatManager.sendMessage("/summarize focus on decisions", context, ChainType.LLM_CHAIN);

      expect(mockMessageRepo.addMessage).toHaveBeenCalledWith(
        expandedPrompt,
        expandedPrompt,
        USER_SENDER,
        { ...context, webTabs: [] },
        undefined
      );
      expect(mockContextManager.processMessageContext).toHaveBeenCalledWith(
        mockPlugin.app,
        mockMessage,
        mockFileParserManager,
        mockPlugin.app.vault,
        ChainType.LLM_CHAIN,
        false,
        null,
        expect.anything(),
        expect.any(String),
        expect.any(Array),
        undefined
      );
    });

    it("should include active note in context when includeActiveNote is true", async () => {
      const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });
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
      mockMessageRepo.getMessage.mockReturnValue(undefined);

      await expect(
        chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN)
      ).rejects.toThrow();
    });
  });

  describe("editMessage", () => {
    it("should edit a message and reprocess context", async () => {
      const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });

      mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
      mockMessageRepo.editMessage.mockReturnValue(true);
      mockContextManager.reprocessMessageContext.mockResolvedValue(undefined);

      const result = await chatManager.editMessage("msg-1", "Edited message", ChainType.LLM_CHAIN);

      expect(result).toBe(true);
      expect(mockMessageRepo.editMessage).toHaveBeenCalledWith("msg-1", "Edited message");
      expect(mockContextManager.reprocessMessageContext).toHaveBeenCalledWith(
        mockPlugin.app,
        "msg-1",
        mockMessageRepo,
        mockFileParserManager,
        mockPlugin.app.vault,
        ChainType.LLM_CHAIN,
        false,
        mockActiveFile,
        expect.any(String),
        expect.any(Array)
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
      const mockLLMMessage = {
        ...createMockMessage("msg-1", "Hello with context", USER_SENDER),
        contextEnvelope: { layers: [] } as unknown as PromptContextEnvelope,
      };

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

    it("should lazily reprocess context when envelope is missing (loaded from disk)", async () => {
      const mockAiMessage = createMockMessage("msg-2", "AI response", "AI");
      const mockUserMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
      const mockLLMMessageNoEnvelope = createMockMessage(
        "msg-1",
        "Hello with context",
        USER_SENDER
      );
      const mockLLMMessageWithEnvelope = {
        ...createMockMessage("msg-1", "Hello with context", USER_SENDER),
        contextEnvelope: { layers: [] } as unknown as PromptContextEnvelope,
      };

      mockMessageRepo.getMessage.mockReturnValue(mockAiMessage);
      mockMessageRepo.getDisplayMessages.mockReturnValue([mockUserMessage, mockAiMessage]);
      mockMessageRepo.getLLMMessage
        .mockReturnValueOnce(mockLLMMessageNoEnvelope)
        .mockReturnValueOnce(mockLLMMessageWithEnvelope);
      mockMessageRepo.truncateAfter.mockReturnValue(undefined);
      mockChainManager.runChain.mockResolvedValue(undefined);
      mockContextManager.reprocessMessageContext.mockResolvedValue(undefined);

      const result = await chatManager.regenerateMessage("msg-2", jest.fn(), jest.fn());

      expect(result).toBe(true);
      expect(mockContextManager.reprocessMessageContext).toHaveBeenCalledWith(
        mockPlugin.app,
        "msg-1",
        expect.anything(),
        expect.anything(),
        undefined,
        "copilot_plus_chain",
        false,
        undefined,
        "Test system prompt",
        []
      );
      expect(mockChainManager.runChain).toHaveBeenCalledWith(
        mockLLMMessageWithEnvelope,
        expect.any(AbortController),
        expect.any(Function),
        expect.any(Function),
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
      };

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

  describe("getSourcePath()", () => {
    it("starts without a conversation source", () => {
      expect(chatManager.getSourcePath()).toBe("");
    });
  });

  describe("loadChatHistory()", () => {
    it("retains the loaded file so vault renames update link resolution https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
      const file = mockTFile({ path: "chat/Conversation.md" });
      await chatManager.loadChatHistory(file);
      expect(chatManager.getSourcePath()).toBe("chat/Conversation.md");
      file.path = "archive/Conversation.md";
      expect(chatManager.getSourcePath()).toBe("archive/Conversation.md");
    });
  });

  describe("saveChat()", () => {
    function saveMock(): jest.Mock {
      const persistence = (ChatPersistenceManager as jest.Mock).mock.results.slice(-1)[0].value as {
        saveChat: jest.Mock;
      };
      return persistence.saveChat;
    }

    it("adopts a successful first save and follows its live file through renames", async () => {
      const file = mockTFile({ path: "chat/Saved.md" });
      saveMock().mockResolvedValue(file);
      await chatManager.saveChat("model");
      expect(chatManager.getSourcePath()).toBe("chat/Saved.md");
      file.path = "archive/Saved.md";
      expect(chatManager.getSourcePath()).toBe("archive/Saved.md");
    });

    it("preserves the loaded path when saving fails https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
      await chatManager.loadChatHistory(mockTFile({ path: "chat/Original.md" }));
      saveMock().mockResolvedValue(null);
      await chatManager.saveChat("model");
      expect(chatManager.getSourcePath()).toBe("chat/Original.md");
    });

    it.each([false, true])(
      "ignores an old save after switching conversation (load another = %s) https://github.com/Brevilabs/obsidian-copilot-private/issues/539",
      async (loadAnother) => {
        let resolve!: (source: { path: string }) => void;
        saveMock().mockReturnValue(
          new Promise((done) => {
            resolve = done;
          })
        );
        const saving = chatManager.saveChat("model");
        chatManager.clearMessages();
        if (loadAnother) await chatManager.loadChatHistory(mockTFile({ path: "chat/Another.md" }));
        resolve({ path: "chat/Previous.md" });
        await saving;
        expect(chatManager.getSourcePath()).toBe(loadAnother ? "chat/Another.md" : "");
      }
    );
  });

  describe("clearMessages", () => {
    it("should clear all messages, conversation source, and chain history", async () => {
      await chatManager.loadChatHistory(mockTFile({ path: "chat/Original.md" }));
      chatManager.clearMessages();
      expect(chatManager.getSourcePath()).toBe("");

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
    it("should load messages from array", async () => {
      const messages: ChatMessage[] = [
        createMockMessage("msg-1", "Hello", USER_SENDER),
        createMockMessage("msg-2", "Response", "AI"),
      ];

      await chatManager.loadChatHistory(mockTFile({ path: "chat/Original.md" }));
      await chatManager.loadMessages(messages);
      expect(chatManager.getSourcePath()).toBe("");

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
        const mockActiveFile = mockTFile({ path: "lesson4.md", basename: "Lesson 4" });
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
        const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });

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
          mockPlugin.app,
          "msg-1",
          mockMessageRepo,
          mockFileParserManager,
          mockPlugin.app.vault,
          ChainType.LLM_CHAIN,
          false,
          mockActiveFile,
          expect.any(String),
          expect.any(Array)
        );
      });
    });

    describe("Regeneration Bug Prevention", () => {
      it("should handle regeneration with proper message truncation", async () => {
        const mockAiMessage = createMockMessage("msg-2", "AI response", "AI");
        const mockUserMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const mockLLMMessage = {
          ...createMockMessage("msg-1", "Hello with context", USER_SENDER),
          contextEnvelope: { layers: [] } as unknown as PromptContextEnvelope,
        };

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

      await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN, false, true);

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
          ]) as unknown,
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
          ]) as unknown,
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

      expect(webTabs).toHaveLength(1);
      expect(webTabs[0]).toEqual(
        expect.objectContaining({
          url: "https://docs.example.com/guide#section2",
          title: "Guide - Section 2",
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

      mockGetWebViewerService.mockImplementation(() => {
        throw new Error("Web Viewer not available on mobile");
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
          activeWebTabForMentions: null,
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

      await chatManager.sendMessage(
        "Check {activeWebTab}",
        context,
        ChainType.LLM_CHAIN,
        false,
        true
      );

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

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

      await chatManager.sendMessage("Check {activeWebTab}", context, ChainType.LLM_CHAIN);

      const addMessageCall = mockMessageRepo.addMessage.mock.calls[0];
      const webTabs = addMessageCall[3]?.webTabs ?? [];

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
        webTabs: [{ url: "https://existing.example.com", title: "Existing Tab" }],
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

      expect(mockGetWebViewerService).not.toHaveBeenCalled();
    });
  });

  describe("System Prompt Template Processing", () => {
    const { processPrompt } = jest.requireMock<{ processPrompt: jest.Mock }>(
      "@/commands/customCommandUtils"
    );
    const { getSystemPrompt, getSystemPromptWithMemory, getEffectiveUserPrompt } =
      jest.requireMock<{
        getSystemPrompt: jest.Mock;
        getSystemPromptWithMemory: jest.Mock;
        getEffectiveUserPrompt: jest.Mock;
      }>("@/system-prompts/systemPromptBuilder");
    const { getSettings } = jest.requireMock<{ getSettings: jest.Mock }>("@/settings/model");

    beforeEach(() => {
      getEffectiveUserPrompt.mockReturnValue("");
      processPrompt.mockResolvedValue({ processedPrompt: "", includedFiles: [] });
      getSystemPrompt.mockReturnValue("Test system prompt");
      getSystemPromptWithMemory.mockResolvedValue("Test system prompt");
      getSettings.mockReturnValue({ enableCustomPromptTemplating: true });
    });

    describe("Template Skip Logic", () => {
      it("should not call processPrompt when user custom prompt has no template variables", async () => {
        const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

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

        expect(processPrompt).not.toHaveBeenCalled();

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain(userCustomPrompt);
      });

      it("should call processPrompt for JSON but preserve content (handled internally)", async () => {
        const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = '{"foo": "bar", "nested": {"a": 1}}';
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

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

        expect(processPrompt).toHaveBeenCalled();

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain(userCustomPrompt.trimEnd());
      });

      it("should treat {} as literal in system prompts (not expand to activeNote)", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
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

        expect(processPrompt).toHaveBeenCalledWith(
          mockPlugin.app,
          userCustomPrompt,
          "",
          mockPlugin.app.vault,
          mockActiveFile,
          true
        );

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain("{}");
      });

      it("should preserve trailing whitespace for JSON content", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = '{"format": "json"}   \n';
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

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

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain('{"format": "json"}');
      });

      it("should not call processPrompt when enableCustomPromptTemplating is false", async () => {
        const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

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

        expect(processPrompt).not.toHaveBeenCalled();
      });

      it("should not call processPrompt when no user custom prompt is set", async () => {
        const mockActiveFile = mockTFile({ path: "active.md", basename: "active" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        getEffectiveUserPrompt.mockReturnValue("");

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        expect(processPrompt).not.toHaveBeenCalled();
      });
    });

    describe("Template Processing", () => {
      it("should call processPrompt with correct arguments for {activeNote} template", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
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

        expect(processPrompt).toHaveBeenCalledWith(
          mockPlugin.app,
          userCustomPrompt,
          "",
          mockPlugin.app.vault,
          mockActiveFile,
          true
        );
      });

      it("should pass includedFiles to contextManager for deduplication", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockIncludedFile = mockTFile({ path: "included.md", basename: "Included Note" });
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

        expect(mockContextManager.processMessageContext).toHaveBeenCalledWith(
          mockPlugin.app,
          mockMessage,
          mockFileParserManager,
          mockPlugin.app.vault,
          ChainType.LLM_CHAIN,
          false,
          mockActiveFile,
          expect.anything(),
          expect.any(String),
          expect.arrayContaining([mockIncludedFile]),
          undefined
        );
      });
    });

    describe("Injection Logic", () => {
      it("should inject processed content into user_custom_instructions block", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
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

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain("<user_custom_instructions>");
        expect(systemPromptArg).toContain(processedContent.trimEnd());
        expect(systemPromptArg).toContain("</user_custom_instructions>");
      });

      it("should preserve $ characters in user prompt without interpreting as replacement patterns", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Cost is $100. Use $& and $1 patterns. Double $$ too.";

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );
        getSystemPromptWithMemory.mockResolvedValue(
          `DEFAULT_SYSTEM_PROMPT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`
        );

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN);

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain("$100");
        expect(systemPromptArg).toContain("$&");
        expect(systemPromptArg).toContain("$1");
        expect(systemPromptArg).toContain("$$");
        expect(systemPromptArg).toContain(userCustomPrompt);

        const openTagCount = (
          (systemPromptArg as string).match(/<user_custom_instructions>/g) || []
        ).length;
        const closeTagCount = (
          (systemPromptArg as string).match(/<\/user_custom_instructions>/g) || []
        ).length;
        expect(openTagCount).toBe(1);
        expect(closeTagCount).toBe(1);
      });

      it("should preserve $ characters when template processing is involved", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use {activeNote}. Price: $50 each, total $& cost.";
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

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain("$100");
        expect(systemPromptArg).toContain("$50");
        expect(systemPromptArg).toContain("$&");

        const openTagCount = (
          (systemPromptArg as string).match(/<user_custom_instructions>/g) || []
        ).length;
        const closeTagCount = (
          (systemPromptArg as string).match(/<\/user_custom_instructions>/g) || []
        ).length;
        expect(openTagCount).toBe(1);
        expect(closeTagCount).toBe(1);
      });
    });

    describe("Memory Preservation", () => {
      it("should preserve memory prefix and not process it for templates", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use {activeNote}";
        const memoryContent = "<user_memory>Some {curly} braces in memory</user_memory>";
        const systemPromptWithoutMemory = `DEFAULT\n<user_custom_instructions>\n${userCustomPrompt}\n</user_custom_instructions>`;

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(systemPromptWithoutMemory);
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

        expect(processPrompt).toHaveBeenCalledTimes(1);
        expect(processPrompt).toHaveBeenCalledWith(
          mockPlugin.app,
          userCustomPrompt,
          "",
          mockPlugin.app.vault,
          mockActiveFile,
          true
        );

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain(memoryContent);
      });
    });

    describe("Error Handling", () => {
      it("should return original prompt when processPrompt throws error", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
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

        processPrompt.mockRejectedValue(new Error("Template processing failed"));

        mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockActiveFile);
        mockPlugin.app.vault = { adapter: { stat: jest.fn() } };
        mockMessageRepo.addMessage.mockReturnValue("msg-1");
        mockMessageRepo.getMessage.mockReturnValue(mockMessage);
        mockContextManager.processMessageContext.mockResolvedValue(createContextResult());

        await expect(chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN)).resolves.toBe(
          "msg-1"
        );

        expect(mockContextManager.processMessageContext).toHaveBeenCalled();
      });
    });

    describe("Builtin Disabled Branch", () => {
      it("should handle builtin disabled scenario (no user_custom_instructions block)", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Custom prompt with {activeNote}";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
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

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toBe(processedContent.trimEnd());
        expect(systemPromptArg).not.toContain(userCustomPrompt);
      });

      it("should preserve memory prefix when builtin is disabled", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Custom {activeNote}";
        const memoryContent = "<user_memory>Memory content</user_memory>";

        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);
        getSystemPrompt.mockReturnValue(userCustomPrompt);
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

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toContain(memoryContent);
        expect(systemPromptArg).toContain("PROCESSED");
      });
    });

    describe("EndsWith Mismatch Fallback", () => {
      it("should fallback to original base prompt when endsWith check fails", async () => {
        const mockActiveFile = mockTFile({ path: "test.md", basename: "Test Note" });
        const mockMessage = createMockMessage("msg-1", "Hello", USER_SENDER);
        const context: MessageContext = { notes: [], urls: [], selectedTextContexts: [] };

        const userCustomPrompt = "Use {activeNote}";
        getEffectiveUserPrompt.mockReturnValue(userCustomPrompt);

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

        await expect(chatManager.sendMessage("Hello", context, ChainType.LLM_CHAIN)).resolves.toBe(
          "msg-1"
        );

        expect(mockContextManager.processMessageContext).toHaveBeenCalled();

        const systemPromptArg = mockContextManager.processMessageContext.mock.calls[0][8];
        expect(systemPromptArg).toBe("Memory\n\nACTUAL_SYSTEM_PROMPT_THAT_DOESNT_MATCH");
      });
    });
  });
});
