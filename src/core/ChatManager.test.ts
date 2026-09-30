jest.mock("@/LLMProviders/chatModelManager");
jest.mock("./ContextCompactor");
jest.mock("./ContextManager");
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
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

jest.mock("@/commands/customCommandUtils", () => ({
  processPrompt: jest.fn(),
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
import { AI_SENDER, DEFAULT_SYSTEM_PROMPT, USER_SENDER } from "@/constants";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import { ChatMessage, MessageContext } from "@/types/message";
import * as systemPromptBuilder from "@/system-prompts/systemPromptBuilder";
import * as systemPromptState from "@/system-prompts/state";
import { mockTFile } from "@/__tests__/mockObsidian";
import { getCachedCustomCommands } from "@/commands/state";
import { getSettings } from "@/settings/model";
import { processPrompt } from "@/commands/customCommandUtils";

const ISSUE_3210 = "https://github.com/logancyang/obsidian-copilot/issues/3210";

const PROCESSED_CONTENT = "Hello with context";
const REFRESHED_CONTENT = "Hello with refreshed context";

const emptyContext = (): MessageContext => ({ notes: [], urls: [], selectedTextContexts: [] });

const instructionsBlock = (body: string) =>
  `<user_custom_instructions>\n${body}\n</user_custom_instructions>`;

type MockChainManager = {
  memoryManager: { clearChatMemory: jest.Mock; saveContext: jest.Mock };
  runChain: jest.Mock;
  userMemoryManager?: { getUserMemoryPrompt: () => Promise<string> };
};

describe("ChatManager", () => {
  describe("ChatManager", () => {
    let chatManager: ChatManager;
    let repo: MessageRepository;
    let mockChainManager: MockChainManager;
    let mockFileParserManager: object;
    let getActiveFile: jest.Mock;
    let app: { workspace: { getActiveFile: jest.Mock }; vault: object };
    let mockContextManager: jest.Mocked<ContextManager>;
    let instructions: string;
    let readInstructions: jest.Mock;

    const mockProcessPrompt = processPrompt as jest.Mock;
    const mockGetWebViewerService = getWebViewerService as jest.Mock;

    const systemPromptSent = (callIndex = 0) =>
      mockContextManager.processMessageContext.mock.calls[callIndex][8] as string;

    const addExchange = () => ({
      userId: repo.addMessage("Hello", "Hello", USER_SENDER),
      aiId: repo.addMessage("Response", "Response", AI_SENDER),
    });

    const showActiveWebTab = (url: string, title = "Active Page") =>
      mockGetWebViewerService.mockReturnValue({
        getActiveWebTabState: () => ({ activeWebTabForMentions: { url, title } }),
      });

    const storedWebTabs = (messageId: string) => repo.getMessage(messageId)?.context?.webTabs;

    beforeEach(() => {
      repo = new MessageRepository();
      instructions = "";
      systemPromptState.resetSessionSystemPromptSettings();
      systemPromptState.updateCachedSystemPrompts([]);
      (getSettings as jest.Mock).mockReturnValue({ enableCustomPromptTemplating: true });
      mockProcessPrompt.mockReset();
      mockGetWebViewerService.mockReset();
      (getCachedCustomCommands as jest.Mock).mockReturnValue([]);

      mockChainManager = {
        memoryManager: {
          clearChatMemory: jest.fn().mockResolvedValue(undefined),
          saveContext: jest.fn().mockResolvedValue(undefined),
        },
        runChain: jest.fn().mockResolvedValue(undefined),
      };
      mockFileParserManager = {};

      const instructionsFile = mockTFile({ path: "AGENTS.md", basename: "AGENTS" });
      readInstructions = jest.fn(async () => instructions);
      getActiveFile = jest.fn().mockReturnValue(null);
      app = {
        workspace: { getActiveFile },
        vault: { getAbstractFileByPath: () => instructionsFile, read: readInstructions },
      };

      mockContextManager = {
        processMessageContext: jest
          .fn()
          .mockResolvedValue({ processedContent: PROCESSED_CONTENT, contextEnvelope: undefined }),
        reprocessMessageContext: jest.fn(
          async (_app: unknown, messageId: string, messageRepo: MessageRepository) => {
            messageRepo.updateProcessedText(messageId, REFRESHED_CONTENT);
          }
        ),
      } as unknown as jest.Mocked<ContextManager>;
      (ContextManager.getInstance as jest.Mock).mockReturnValue(mockContextManager);

      chatManager = new ChatManager(
        repo,
        mockChainManager as unknown as ChainManager,
        mockFileParserManager as FileParserManager,
        { app } as unknown as CopilotPlugin
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("sendMessage()", () => {
      it("stores the display text with its context and saves the processed text for the LLM", async () => {
        const note = mockTFile({ path: "context.md", basename: "context" });
        const context = { ...emptyContext(), notes: [note] };
        const updateLoadingMessage = jest.fn();

        const messageId = await chatManager.sendMessage(
          "Hello",
          context,
          ChainType.LLM_CHAIN,
          false,
          false,
          undefined,
          updateLoadingMessage
        );

        expect(chatManager.getMessage(messageId)).toMatchObject({
          message: "Hello",
          sender: USER_SENDER,
          context: { ...context, webTabs: [] },
        });
        expect(chatManager.getLLMMessage(messageId)?.message).toBe(PROCESSED_CONTENT);
        expect(mockContextManager.processMessageContext).toHaveBeenCalledWith(
          app,
          expect.objectContaining({ id: messageId, message: "Hello" }),
          mockFileParserManager,
          app.vault,
          ChainType.LLM_CHAIN,
          false,
          null,
          repo,
          expect.any(String),
          [],
          updateLoadingMessage
        );
      });

      it("adds the active note to the message context when includeActiveNote is true", async () => {
        const activeFile = mockTFile({ path: "active.md", basename: "active" });
        getActiveFile.mockReturnValue(activeFile);

        const messageId = await chatManager.sendMessage(
          "Hello",
          emptyContext(),
          ChainType.LLM_CHAIN,
          true
        );

        expect(chatManager.getMessage(messageId)?.context?.notes).toEqual([activeFile]);
        expect(mockContextManager.processMessageContext.mock.calls[0][6]).toBe(activeFile);
      });

      it("does not add the active note again when it is already attached", async () => {
        const activeFile = mockTFile({ path: "active.md", basename: "active" });
        getActiveFile.mockReturnValue(activeFile);
        const context = { ...emptyContext(), notes: [activeFile] };

        const messageId = await chatManager.sendMessage(
          "Hello",
          context,
          ChainType.LLM_CHAIN,
          true
        );

        expect(chatManager.getMessage(messageId)?.context?.notes).toEqual([activeFile]);
      });

      it("keeps the context unchanged when includeActiveNote is true but no file is open", async () => {
        const messageId = await chatManager.sendMessage(
          "Hello",
          emptyContext(),
          ChainType.LLM_CHAIN,
          true
        );

        expect(chatManager.getMessage(messageId)?.context?.notes).toEqual([]);
        expect(mockContextManager.processMessageContext.mock.calls[0][6]).toBeNull();
      });

      it("replaces a Quick Chat slash alias with its full prompt before displaying and sending it (https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610)", async () => {
        (getCachedCustomCommands as jest.Mock).mockReturnValue([
          {
            title: "summarize",
            content: "Summarize the active note.",
            showInContextMenu: false,
            showInSlashMenu: true,
            order: 0,
            modelKey: "",
            lastUsedMs: 0,
          },
        ]);

        const messageId = await chatManager.sendMessage(
          "/summarize focus on decisions",
          emptyContext(),
          ChainType.LLM_CHAIN
        );

        const expandedPrompt = "Summarize the active note.\n\nfocus on decisions";
        expect(chatManager.getMessage(messageId)?.message).toBe(expandedPrompt);
        expect(mockContextManager.processMessageContext.mock.calls[0][1]).toMatchObject({
          message: expandedPrompt,
        });
      });

      it("notifies the message-created callback with the new id before processing context", async () => {
        const onMessageCreated = jest.fn();
        chatManager.setOnMessageCreatedCallback(onMessageCreated);

        const messageId = await chatManager.sendMessage(
          "Hello",
          emptyContext(),
          ChainType.LLM_CHAIN
        );

        expect(onMessageCreated).toHaveBeenCalledWith(messageId);
        expect(onMessageCreated.mock.invocationCallOrder[0]).toBeLessThan(
          mockContextManager.processMessageContext.mock.invocationCallOrder[0]
        );
      });

      it("rejects with the processing error and keeps the user message in the chat", async () => {
        mockContextManager.processMessageContext.mockRejectedValue(new Error("Context failed"));

        await expect(
          chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN)
        ).rejects.toThrow("Context failed");

        expect(chatManager.getDisplayMessages().map((m) => m.message)).toEqual(["Hello"]);
      });

      it("adds the active web tab to the stored context when includeActiveWebTab is true", async () => {
        showActiveWebTab("https://active.example.com");

        const messageId = await chatManager.sendMessage(
          "Hello",
          emptyContext(),
          ChainType.LLM_CHAIN,
          false,
          true
        );

        expect(storedWebTabs(messageId)).toEqual([
          expect.objectContaining({ url: "https://active.example.com", isActive: true }),
        ]);
      });

      it("adds the active web tab when the text contains the active web tab marker", async () => {
        showActiveWebTab("https://marker.example.com");

        const messageId = await chatManager.sendMessage(
          "Check {activeWebTab}",
          emptyContext(),
          ChainType.LLM_CHAIN
        );

        expect(storedWebTabs(messageId)).toEqual([
          expect.objectContaining({ url: "https://marker.example.com", isActive: true }),
        ]);
      });

      it("leaves web tabs empty when neither includeActiveWebTab nor the marker is present", async () => {
        showActiveWebTab("https://should-not-appear.com");

        const messageId = await chatManager.sendMessage(
          "Hello",
          emptyContext(),
          ChainType.LLM_CHAIN
        );

        expect(storedWebTabs(messageId)).toEqual([]);
        expect(mockGetWebViewerService).not.toHaveBeenCalled();
      });

      it.each([
        [
          "web",
          {
            id: "web-selection-1",
            sourceType: "web" as const,
            title: "Selected Page",
            url: "https://selected.example.com",
            content: "Some selected text from web",
          },
        ],
        [
          "note",
          {
            id: "note-selection-1",
            sourceType: "note" as const,
            noteTitle: "Test Note",
            notePath: "test.md",
            startLine: 1,
            endLine: 5,
            content: "Some selected text from note",
          },
        ],
      ])(
        "keeps existing web tabs and does not add the active web tab when a %s selection exists",
        async (_kind, selection) => {
          showActiveWebTab("https://active.example.com");
          const context = {
            ...emptyContext(),
            selectedTextContexts: [selection],
            webTabs: [{ url: "https://existing.example.com", title: "Existing Tab" }],
          };

          const messageId = await chatManager.sendMessage(
            "Check {activeWebTab}",
            context,
            ChainType.LLM_CHAIN,
            false,
            true
          );

          expect(storedWebTabs(messageId)).toEqual([
            { url: "https://existing.example.com", title: "Existing Tab" },
          ]);
          expect(mockGetWebViewerService).not.toHaveBeenCalled();
        }
      );

      it(`sends current root instructions once per message and sees edits in the same chat (${ISSUE_3210})`, async () => {
        instructions = "Answer with citations.";
        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);
        expect(systemPromptSent(0)).toContain(instructionsBlock("Answer with citations."));

        instructions = "Answer in French.";
        await chatManager.sendMessage("Again", emptyContext(), ChainType.LLM_CHAIN);

        expect(systemPromptSent(1)).toContain(instructionsBlock("Answer in French."));
        expect(systemPromptSent(1)).not.toContain("Answer with citations.");
        expect(readInstructions).toHaveBeenCalledTimes(2);
      });

      it(`uses one instruction snapshot through memory loading and template expansion (${ISSUE_3210})`, async () => {
        instructions = "Use {activeNote}.";
        const includedFile = mockTFile({ path: "Plan.md", basename: "Plan" });
        mockProcessPrompt.mockResolvedValueOnce({
          processedPrompt: "Use the launch plan.",
          includedFiles: [includedFile],
        });
        mockChainManager.userMemoryManager = {
          getUserMemoryPrompt: async () => {
            instructions = "Changed during memory loading.";
            return "<memory>Timezone</memory>";
          },
        };

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        const call = mockContextManager.processMessageContext.mock.calls[0];
        expect(call[8]).toContain("<memory>Timezone</memory>");
        expect(call[8]).toContain("Use the launch plan.");
        expect(call[8]).not.toContain("Changed during memory loading.");
        expect(call[9]).toEqual([includedFile]);
        expect(readInstructions).toHaveBeenCalledTimes(1);
      });

      it("sends the default system prompt without a custom-instructions block when there are no instructions", async () => {
        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(systemPromptSent()).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(mockProcessPrompt).not.toHaveBeenCalled();
      });

      it("skips template processing for instructions without template variables", async () => {
        instructions = "Simple prompt without templates    ";

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(mockProcessPrompt).not.toHaveBeenCalled();
        expect(systemPromptSent()).toContain(instructionsBlock(instructions));
      });

      it("skips template processing when custom prompt templating is disabled", async () => {
        (getSettings as jest.Mock).mockReturnValue({ enableCustomPromptTemplating: false });
        instructions = "Use {activeNote} content";

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(mockProcessPrompt).not.toHaveBeenCalled();
        expect(systemPromptSent()).toContain(instructionsBlock(instructions));
      });

      it("expands templates for the active note and injects the result inside the custom-instructions block", async () => {
        const activeFile = mockTFile({ path: "test.md", basename: "Test Note" });
        getActiveFile.mockReturnValue(activeFile);
        instructions = "Use {activeNote}";
        mockProcessPrompt.mockResolvedValue({
          processedPrompt: "Use {activeNote}\n\n<variable>Note content</variable>\n",
          includedFiles: [],
        });

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(mockProcessPrompt).toHaveBeenCalledWith(
          app,
          "Use {activeNote}",
          "",
          app.vault,
          activeFile,
          true
        );
        expect(systemPromptSent()).toBe(
          `${DEFAULT_SYSTEM_PROMPT}\n${instructionsBlock("Use {activeNote}\n\n<variable>Note content</variable>")}`
        );
      });

      it("keeps the returned text of a prompt containing braces such as JSON", async () => {
        instructions = '{"foo": "bar", "nested": {"a": 1}}';
        mockProcessPrompt.mockResolvedValue({ processedPrompt: instructions, includedFiles: [] });

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(mockProcessPrompt).toHaveBeenCalledTimes(1);
        expect(systemPromptSent()).toContain(instructionsBlock(instructions));
      });

      it("inserts dollar signs in expanded instructions literally", async () => {
        instructions = "Use {activeNote}. Price: $50 each, total $& cost.";
        const expanded = "Note about $100 item $1 and $$. Price: $50 each, total $& cost.";
        mockProcessPrompt.mockResolvedValue({ processedPrompt: expanded, includedFiles: [] });

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(systemPromptSent()).toBe(`${DEFAULT_SYSTEM_PROMPT}\n${instructionsBlock(expanded)}`);
      });

      it("keeps the memory prefix and sends only the instructions through template expansion", async () => {
        const memory = "<user_memory>Some {curly} braces in memory</user_memory>";
        mockChainManager.userMemoryManager = { getUserMemoryPrompt: async () => memory };
        instructions = "Use {activeNote}";
        mockProcessPrompt.mockResolvedValue({
          processedPrompt: "Processed user content",
          includedFiles: [],
        });

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(mockProcessPrompt).toHaveBeenCalledTimes(1);
        expect(mockProcessPrompt.mock.calls[0][1]).toBe("Use {activeNote}");
        expect(systemPromptSent()).toBe(
          `${memory}\n${DEFAULT_SYSTEM_PROMPT}\n${instructionsBlock("Processed user content")}`
        );
      });

      it("sends the unexpanded instructions when template processing throws", async () => {
        instructions = "Use {activeNote}";
        mockProcessPrompt.mockRejectedValue(new Error("Template processing failed"));

        const messageId = await chatManager.sendMessage(
          "Hello",
          emptyContext(),
          ChainType.LLM_CHAIN
        );

        expect(messageId).toEqual(expect.any(String));
        expect(systemPromptSent()).toBe(
          `${DEFAULT_SYSTEM_PROMPT}\n${instructionsBlock("Use {activeNote}")}`
        );
      });

      it("uses only the expanded instructions as the system prompt when the built-in prompt is disabled", async () => {
        systemPromptState.setDisableBuiltinSystemPrompt(true);
        instructions = "Custom prompt with {activeNote}";
        mockProcessPrompt.mockResolvedValue({
          processedPrompt: "PROCESSED_CONTENT_ONLY",
          includedFiles: [],
        });

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(systemPromptSent()).toBe("PROCESSED_CONTENT_ONLY");
      });

      it("keeps the memory prefix when the built-in prompt is disabled", async () => {
        systemPromptState.setDisableBuiltinSystemPrompt(true);
        const memory = "<user_memory>Memory content</user_memory>";
        mockChainManager.userMemoryManager = { getUserMemoryPrompt: async () => memory };
        instructions = "Custom {activeNote}";
        mockProcessPrompt.mockResolvedValue({ processedPrompt: "PROCESSED", includedFiles: [] });

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(systemPromptSent()).toBe(`${memory}\nPROCESSED`);
      });

      it("sends the original prompt and drops included files when the prompt without memory is not a suffix of the memory prompt", async () => {
        const memory = "<user_memory>Memory content</user_memory>";
        mockChainManager.userMemoryManager = { getUserMemoryPrompt: async () => memory };
        instructions = "Use {activeNote}";
        jest.spyOn(systemPromptBuilder, "getSystemPrompt").mockReturnValue("DIFFERENT");
        mockProcessPrompt.mockResolvedValue({
          processedPrompt: "PROCESSED",
          includedFiles: [mockTFile({ path: "included.md", basename: "included" })],
        });

        await chatManager.sendMessage("Hello", emptyContext(), ChainType.LLM_CHAIN);

        expect(systemPromptSent()).toBe(
          `${memory}\n${DEFAULT_SYSTEM_PROMPT}\n${instructionsBlock("Use {activeNote}")}`
        );
        expect(mockContextManager.processMessageContext.mock.calls[0][9]).toEqual([]);
      });
    });

    describe("editMessage()", () => {
      it("updates the message text, reprocesses its context and rebuilds chain memory", async () => {
        const activeFile = mockTFile({ path: "active.md", basename: "active" });
        getActiveFile.mockReturnValue(activeFile);
        const { userId } = addExchange();

        const result = await chatManager.editMessage(userId, "Edited message", ChainType.LLM_CHAIN);

        expect(result).toBe(true);
        expect(chatManager.getMessage(userId)?.message).toBe("Edited message");
        expect(chatManager.getLLMMessage(userId)?.message).toBe(REFRESHED_CONTENT);
        expect(mockContextManager.reprocessMessageContext).toHaveBeenCalledWith(
          app,
          userId,
          repo,
          mockFileParserManager,
          app.vault,
          ChainType.LLM_CHAIN,
          false,
          activeFile,
          expect.any(String),
          []
        );
        expect(mockChainManager.memoryManager.clearChatMemory).toHaveBeenCalled();
      });

      it("returns false without reprocessing when the message does not exist", async () => {
        const result = await chatManager.editMessage("missing", "Edited", ChainType.LLM_CHAIN);

        expect(result).toBe(false);
        expect(mockContextManager.reprocessMessageContext).not.toHaveBeenCalled();
      });

      it("returns false when context reprocessing fails", async () => {
        const { userId } = addExchange();
        mockContextManager.reprocessMessageContext.mockRejectedValue(new Error("Reprocess failed"));

        const result = await chatManager.editMessage(userId, "Edited", ChainType.LLM_CHAIN);

        expect(result).toBe(false);
      });

      it(`uses current vault instructions when reprocessing an edited message (${ISSUE_3210})`, async () => {
        const { userId } = addExchange();
        instructions = "Use the updated rules.";

        await chatManager.editMessage(userId, "Edited", ChainType.LLM_CHAIN);

        expect(mockContextManager.reprocessMessageContext.mock.calls[0][8]).toContain(
          instructionsBlock("Use the updated rules.")
        );
      });
    });

    describe("regenerateMessage()", () => {
      it("drops the AI reply, refreshes the user message context and reruns the chain", async () => {
        const { userId, aiId } = addExchange();
        const onUpdate = jest.fn();
        const onAdd = jest.fn();
        const onTruncate = jest.fn();

        const result = await chatManager.regenerateMessage(aiId, onUpdate, onAdd, onTruncate);

        expect(result).toBe(true);
        expect(chatManager.getDisplayMessages().map((m) => m.id)).toEqual([userId]);
        expect(onTruncate).toHaveBeenCalledTimes(1);
        expect(mockChainManager.runChain).toHaveBeenCalledWith(
          expect.objectContaining({ id: userId, message: REFRESHED_CONTENT }),
          expect.any(AbortController),
          onUpdate,
          onAdd,
          expect.any(Object)
        );
      });

      it("reprocesses the user message with the current chain type and no active note inclusion", async () => {
        const { userId, aiId } = addExchange();

        await chatManager.regenerateMessage(aiId, jest.fn(), jest.fn());

        expect(mockContextManager.reprocessMessageContext).toHaveBeenCalledWith(
          app,
          userId,
          repo,
          mockFileParserManager,
          app.vault,
          "copilot_plus_chain",
          false,
          null,
          DEFAULT_SYSTEM_PROMPT,
          []
        );
      });

      it(`reprocesses an existing envelope with current instructions before retrying (${ISSUE_3210})`, async () => {
        repo.addMessage({
          id: "msg-1",
          message: "Hello",
          sender: USER_SENDER,
          timestamp: null,
          isVisible: true,
          contextEnvelope: { layers: [] } as never,
        });
        repo.addMessage("Response", "Response", AI_SENDER);
        instructions = "Use changed retry instructions.";

        const result = await chatManager.regenerateMessage(
          chatManager.getDisplayMessages()[1].id!,
          jest.fn(),
          jest.fn()
        );

        expect(result).toBe(true);
        expect(mockContextManager.reprocessMessageContext.mock.calls[0][1]).toBe("msg-1");
        expect(mockContextManager.reprocessMessageContext.mock.calls[0][8]).toContain(
          instructionsBlock("Use changed retry instructions.")
        );
        expect(mockChainManager.runChain.mock.calls[0][0]).toMatchObject({
          message: REFRESHED_CONTENT,
        });
      });

      it("returns false when the message does not exist", async () => {
        addExchange();

        expect(await chatManager.regenerateMessage("missing", jest.fn(), jest.fn())).toBe(false);
        expect(mockChainManager.runChain).not.toHaveBeenCalled();
      });

      it("returns false for the first message in the chat", async () => {
        const { userId } = addExchange();

        expect(await chatManager.regenerateMessage(userId, jest.fn(), jest.fn())).toBe(false);
        expect(chatManager.getDisplayMessages()).toHaveLength(2);
      });

      it("returns false without truncating when the preceding message is not from the user", async () => {
        repo.addMessage("First reply", "First reply", AI_SENDER);
        const secondReplyId = repo.addMessage("Second reply", "Second reply", AI_SENDER);

        expect(await chatManager.regenerateMessage(secondReplyId, jest.fn(), jest.fn())).toBe(
          false
        );
        expect(chatManager.getDisplayMessages()).toHaveLength(2);
      });

      it("returns false when the chain fails", async () => {
        const { aiId } = addExchange();
        mockChainManager.runChain.mockRejectedValue(new Error("Chain failed"));

        expect(await chatManager.regenerateMessage(aiId, jest.fn(), jest.fn())).toBe(false);
      });
    });

    describe("deleteMessage()", () => {
      it("removes the message and rebuilds chain memory from the remaining messages", async () => {
        const { userId, aiId } = addExchange();
        const secondUserId = repo.addMessage("Again", "Again", USER_SENDER);
        repo.addMessage("Reply", "Reply", AI_SENDER);

        expect(await chatManager.deleteMessage(secondUserId)).toBe(true);

        expect(chatManager.getDisplayMessages().map((m) => m.id)).toEqual([
          userId,
          aiId,
          expect.any(String),
        ]);
        expect(mockChainManager.memoryManager.saveContext).toHaveBeenCalledTimes(1);
        expect(mockChainManager.memoryManager.saveContext).toHaveBeenCalledWith(
          { input: "Hello" },
          { output: "Response" }
        );
      });

      it("returns false for a message that does not exist", async () => {
        addExchange();

        expect(await chatManager.deleteMessage("missing")).toBe(false);
        expect(chatManager.getDisplayMessages()).toHaveLength(2);
        expect(mockChainManager.memoryManager.clearChatMemory).not.toHaveBeenCalled();
      });
    });

    describe("truncateAfterMessageId()", () => {
      it("removes later messages and rebuilds chain memory from the remaining ones", async () => {
        const { aiId } = addExchange();
        repo.addMessage("Again", "Again", USER_SENDER);
        repo.addMessage("Reply", "Reply", AI_SENDER);

        await chatManager.truncateAfterMessageId(aiId);

        expect(chatManager.getDisplayMessages()).toHaveLength(2);
        expect(mockChainManager.memoryManager.saveContext).toHaveBeenCalledTimes(1);
        expect(mockChainManager.memoryManager.saveContext).toHaveBeenCalledWith(
          { input: "Hello" },
          { output: "Response" }
        );
      });
    });

    describe("getSourcePath()", () => {
      it("is empty before any chat is loaded or saved", () => {
        expect(chatManager.getSourcePath()).toBe("");
      });
    });

    describe("loadChatHistory()", () => {
      const persistence = () =>
        (ChatPersistenceManager as jest.Mock).mock.results.slice(-1)[0].value as {
          loadChat: jest.Mock;
        };

      it("replaces the current messages with the loaded chat and rebuilds chain memory", async () => {
        addExchange();
        persistence().loadChat.mockResolvedValue([
          { id: "a", message: "Question", sender: USER_SENDER, timestamp: null, isVisible: true },
          { id: "b", message: "Answer", sender: AI_SENDER, timestamp: null, isVisible: true },
        ]);

        await chatManager.loadChatHistory(mockTFile({ path: "chat/Saved.md" }));

        expect(chatManager.getDisplayMessages().map((m) => m.id)).toEqual(["a", "b"]);
        expect(mockChainManager.memoryManager.saveContext).toHaveBeenCalledWith(
          { input: "Question" },
          { output: "Answer" }
        );
      });

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
        const persistence = (ChatPersistenceManager as jest.Mock).mock.results.slice(-1)[0]
          .value as { saveChat: jest.Mock };
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
          if (loadAnother)
            await chatManager.loadChatHistory(mockTFile({ path: "chat/Another.md" }));
          resolve({ path: "chat/Previous.md" });
          await saving;
          expect(chatManager.getSourcePath()).toBe(loadAnother ? "chat/Another.md" : "");
        }
      );
    });

    describe("clearMessages()", () => {
      it("removes all messages, the conversation source and the chain history", async () => {
        addExchange();
        await chatManager.loadChatHistory(mockTFile({ path: "chat/Original.md" }));
        repo.addMessage("Hello", "Hello", USER_SENDER);

        chatManager.clearMessages();

        expect(chatManager.getLLMMessages()).toEqual([]);
        expect(chatManager.getSourcePath()).toBe("");
        expect(mockChainManager.memoryManager.clearChatMemory).toHaveBeenCalled();
      });
    });

    describe("addMessage()", () => {
      it("adds the ChatMessage and returns its id", () => {
        const message: ChatMessage = {
          id: "msg-1",
          message: "Hello",
          sender: USER_SENDER,
          timestamp: null,
          isVisible: true,
        };

        expect(chatManager.addMessage(message)).toBe("msg-1");
        expect(chatManager.getMessage("msg-1")?.message).toBe("Hello");
      });
    });

    describe("loadMessages()", () => {
      it("replaces the messages, clears the conversation source and rebuilds chain memory", async () => {
        addExchange();
        await chatManager.loadChatHistory(mockTFile({ path: "chat/Original.md" }));
        const messages: ChatMessage[] = [
          { id: "a", message: "Question", sender: USER_SENDER, timestamp: null, isVisible: true },
          { id: "b", message: "Answer", sender: AI_SENDER, timestamp: null, isVisible: true },
        ];

        await chatManager.loadMessages(messages);

        expect(chatManager.getDisplayMessages().map((m) => m.id)).toEqual(["a", "b"]);
        expect(chatManager.getSourcePath()).toBe("");
        expect(mockChainManager.memoryManager.saveContext).toHaveBeenCalledWith(
          { input: "Question" },
          { output: "Answer" }
        );
      });
    });

    describe("getDisplayMessages()", () => {
      it("returns only visible messages", () => {
        chatManager.addMessage({
          id: "hidden",
          message: "Hidden",
          sender: USER_SENDER,
          timestamp: null,
          isVisible: false,
        });
        const { userId } = addExchange();

        expect(chatManager.getDisplayMessages().map((m) => m.id)).toContain(userId);
        expect(chatManager.getDisplayMessages().map((m) => m.id)).not.toContain("hidden");
      });
    });

    describe("getLLMMessages()", () => {
      it("returns every message including hidden ones", () => {
        chatManager.addMessage({
          id: "hidden",
          message: "Hidden",
          sender: USER_SENDER,
          timestamp: null,
          isVisible: false,
        });
        addExchange();

        expect(chatManager.getLLMMessages()).toHaveLength(3);
      });
    });

    describe("getMessage()", () => {
      it("returns the display text of a message", () => {
        const id = repo.addMessage("Shown", "Sent to LLM", USER_SENDER);

        expect(chatManager.getMessage(id)?.message).toBe("Shown");
      });
    });

    describe("getLLMMessage()", () => {
      it("returns the processed text of a message", () => {
        const id = repo.addMessage("Shown", "Sent to LLM", USER_SENDER);

        expect(chatManager.getLLMMessage(id)?.message).toBe("Sent to LLM");
      });
    });

    describe("getDebugInfo()", () => {
      it("reports total, visible and user message counts", () => {
        addExchange();

        expect(chatManager.getDebugInfo()).toMatchObject({
          totalMessages: 2,
          visibleMessages: 2,
          userMessages: 1,
        });
      });
    });
  });
});
