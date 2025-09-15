// Mock dependencies first to avoid circular dependencies
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

jest.mock("@/constants", () => ({
  USER_SENDER: "user",
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(),
}));

import { UserMemoryManager } from "./UserMemoryManager";
import { App, TFile, Vault } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { USER_SENDER } from "@/constants";
import { ensureFolderExists } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";

// Helper to create TFile mock instances
const createMockTFile = (path: string): TFile => {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.name = path.split("/").pop() || "";
  file.basename = file.name.replace(/\.[^/.]+$/, "");
  file.extension = path.split(".").pop() || "";
  return file;
};

describe("UserMemoryManager", () => {
  let userMemoryManager: UserMemoryManager;
  let mockApp: jest.Mocked<App>;
  let mockVault: jest.Mocked<Vault>;
  let mockChatModel: jest.Mocked<BaseChatModel>;
  let mockSettings: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock settings
    mockSettings = {
      enableMemory: true,
      memoryFolderName: "copilot/memory",
      maxRecentConversations: 30,
    };
    (getSettings as jest.Mock).mockReturnValue(mockSettings);

    // Mock vault
    mockVault = {
      getAbstractFileByPath: jest.fn(),
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      createFolder: jest.fn(),
    } as any;

    // Mock app
    mockApp = {
      vault: mockVault,
    } as any;

    // Reset ensureFolderExists mock
    (ensureFolderExists as jest.Mock).mockClear();

    // Mock chat model
    mockChatModel = {
      invoke: jest.fn(),
    } as any;

    userMemoryManager = new UserMemoryManager(mockApp);
  });

  describe("updateUserMemory", () => {
    const createMockMessage = (
      id: string,
      message: string,
      sender: string = USER_SENDER
    ): ChatMessage => ({
      id,
      message,
      sender,
      timestamp: null,
      isVisible: true,
      condensedUserMessage: `Condensed: ${message}`,
    });

    it("should skip memory update when memory is disabled", () => {
      mockSettings.enableMemory = false;
      const messages = [createMockMessage("1", "test message")];

      userMemoryManager.updateUserMemory(messages, mockChatModel);

      expect(logInfo).toHaveBeenCalledWith(
        "[UserMemoryManager] Recent history referencing is disabled, skipping analysis"
      );
    });

    it("should skip memory update when no messages provided", () => {
      userMemoryManager.updateUserMemory([], mockChatModel);

      expect(logInfo).toHaveBeenCalledWith(
        "[UserMemoryManager] No messages to analyze for user memory"
      );
    });

    it("should complete end-to-end memory update with existing file", async () => {
      // Setup: Create test messages simulating a real conversation with enough content for key conclusions
      const messages = [
        createMockMessage(
          "1",
          "How do I create a daily note template in Obsidian with automatic date formatting? I want to have a template that automatically inserts today's date and creates sections for tasks, notes, and reflections."
        ),
        createMockMessage(
          "2",
          "I can help you create a daily note template with automatic date formatting. Here's how you can set this up: First, create a template file in your templates folder with variables like {{date}} for automatic date insertion. You can use format strings to customize the date display. For the sections, you can create headers for Tasks, Notes, and Reflections that will be included every time you create a new daily note.",
          "ai"
        ),
        createMockMessage(
          "3",
          "That's perfect! Can you also show me how to add tags automatically to these daily notes? I'd like them to be tagged with #daily-note and maybe the current month."
        ),
        createMockMessage(
          "4",
          "Certainly! You can add automatic tags to your template by including tag syntax directly in the template file. Add #daily-note and #{{date:MMMM}} to automatically tag with the current month. This way every daily note will be consistently tagged and easy to find later.",
          "ai"
        ),
      ];

      // Mock existing memory file with previous conversations
      const existingMemoryContent = `## Previous Conversation
**Time:** 2024-01-01T09:00:00Z
**User Messages:**
- Asked about plugin installation
**Key Conclusions:**
- Plugins enhance Obsidian functionality

## Another Conversation
**Time:** 2024-01-01T10:00:00Z
**User Messages:**
- Inquired about linking notes
**Key Conclusions:**
- Backlinks create knowledge connections
`;

      const mockMemoryFile = createMockTFile("copilot/memory/Recent Conversations.md");

      // Mock ensureFolderExists to resolve successfully
      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);

      // Mock app instance for file operations
      mockVault.getAbstractFileByPath.mockReturnValue(mockMemoryFile);

      // Mock reading existing file content
      mockVault.read.mockResolvedValue(existingMemoryContent);

      // Mock LLM responses for conversation processing
      const mockTitleResponse = new AIMessageChunk({ content: "Daily Note Template Setup" });
      const mockConclusionResponse = new AIMessageChunk({
        content:
          "- Templates can automatically insert dates and metadata\n- Tags can be added through template variables",
      });
      mockChatModel.invoke
        .mockResolvedValueOnce(mockTitleResponse)
        .mockResolvedValueOnce(mockConclusionResponse);

      // Execute the updateMemory function directly to ensure proper awaiting
      await (userMemoryManager as any).updateMemory(messages, mockChatModel);

      // Verify the end result: file was modified with new conversation
      const modifyCall = mockVault.modify.mock.calls[0];
      const actualContent = modifyCall[1];

      // Check the full memory content structure as a whole - exact line-by-line verification
      const expectedContentStructure = [
        // Previous conversations should be preserved (no empty lines between conversations)
        "## Previous Conversation",
        "**Time:** 2024-01-01T09:00:00Z",
        "**User Messages:**",
        "- Asked about plugin installation",
        "**Key Conclusions:**",
        "- Plugins enhance Obsidian functionality",
        "## Another Conversation",
        "**Time:** 2024-01-01T10:00:00Z",
        "**User Messages:**",
        "- Inquired about linking notes",
        "**Key Conclusions:**",
        "- Backlinks create knowledge connections",
        // New conversation should be added
        "## Daily Note Template Setup",
        // Dynamic timestamp pattern
        /\*\*Time:\*\* \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/,
        "**User Messages:**",
        "- Condensed: How do I create a daily note template in Obsidian with automatic date formatting? I want to have a template that automatically inserts today's date and creates sections for tasks, notes, and reflections.",
        "- Condensed: That's perfect! Can you also show me how to add tags automatically to these daily notes? I'd like them to be tagged with #daily-note and maybe the current month.",
        "**Key Conclusions:**",
        "- Templates can automatically insert dates and metadata",
        "- Tags can be added through template variables",
        "", // Empty line at end
        "", // Second empty line at end
      ];

      // Verify the complete content structure line by line
      const contentLines = actualContent.split("\n");

      // Verify we have the expected number of lines
      expect(contentLines).toHaveLength(expectedContentStructure.length);

      // Verify each line matches the expected structure
      for (let i = 0; i < expectedContentStructure.length; i++) {
        const expectedItem = expectedContentStructure[i];
        const actualLine = contentLines[i];

        if (expectedItem instanceof RegExp) {
          // Handle regex patterns for dynamic content like timestamps
          expect(actualLine).toMatch(expectedItem);
        } else {
          // Handle exact string matches
          expect(actualLine).toBe(expectedItem);
        }
      }

      // Verify all conversations have the required sections using pattern matching
      expect(actualContent.match(/## [^#\n]+/g)).toHaveLength(3); // 3 conversations
      expect(actualContent.match(/\*\*Time:\*\*/g)).toHaveLength(3); // Each has a timestamp
      expect(actualContent.match(/\*\*User Messages:\*\*/g)).toHaveLength(3); // Each has user messages
      expect(actualContent.match(/\*\*Key Conclusions:\*\*/g)).toHaveLength(3); // Each has key conclusions

      // Verify that the conversation title and key conclusions were extracted via LLM
      expect(mockChatModel.invoke).toHaveBeenCalledTimes(2);

      // Verify title extraction call
      expect(mockChatModel.invoke).toHaveBeenNthCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("Generate a title for the conversation"),
          }),
        ])
      );

      // Verify key conclusions extraction call
      expect(mockChatModel.invoke).toHaveBeenNthCalledWith(
        2,
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("extract key conclusions"),
          }),
        ])
      );

      // Verify no folder creation was needed since folder already exists
      expect(mockVault.createFolder).not.toHaveBeenCalled();

      // Verify no new file creation was needed since file already exists
      expect(mockVault.create).not.toHaveBeenCalled();
    });

    it("should handle missing condensed messages by creating them inline (race condition fix)", async () => {
      // Setup: Create messages without condensed messages to simulate race condition
      const messages = [
        createMockMessage("1", "How do I create daily notes?"),
        createMockMessage("2", "AI response about daily notes", "ai"),
        createMockMessage("3", "What about templates?"),
      ];

      // Remove condensed messages to simulate race condition
      delete messages[0].condensedUserMessage;
      delete messages[2].condensedUserMessage;

      const mockMemoryFile = createMockTFile("copilot/memory/Recent Conversations.md");
      const existingContent = "";

      // Mock ensureFolderExists and file operations
      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);
      mockVault.getAbstractFileByPath.mockReturnValue(mockMemoryFile);
      mockVault.read.mockResolvedValue(existingContent);

      // Mock LLM responses
      const mockTitleResponse = new AIMessageChunk({ content: "Daily Notes Help" });
      const mockConclusionResponse = new AIMessageChunk({
        content: "- Daily notes can be automated with templates",
      });

      // Setup condensed message creation (called inline for missing entries)
      const condensedMessage1 = "Asked about creating daily notes";
      const condensedMessage2 = "Inquired about template usage";

      // Mock createCondensedMessage to return condensed versions
      const createCondensedMessageSpy = jest.spyOn(
        userMemoryManager as any,
        "createCondensedMessage"
      );

      createCondensedMessageSpy.mockImplementation(async (message, model) => {
        if (message === "How do I create daily notes?") {
          return condensedMessage1;
        }
        if (message === "What about templates?") {
          return condensedMessage2;
        }
        return null;
      });

      mockChatModel.invoke
        .mockResolvedValueOnce(mockTitleResponse)
        .mockResolvedValueOnce(mockConclusionResponse);

      // Execute the updateMemory function
      await (userMemoryManager as any).updateMemory(messages, mockChatModel);

      // Verify condensed messages were created inline for missing entries
      expect(createCondensedMessageSpy).toHaveBeenCalledTimes(2);
      expect(createCondensedMessageSpy).toHaveBeenCalledWith(
        "How do I create daily notes?",
        mockChatModel
      );
      expect(createCondensedMessageSpy).toHaveBeenCalledWith(
        "What about templates?",
        mockChatModel
      );

      // Verify the final content includes the inline-created condensed messages
      const modifyCall = mockVault.modify.mock.calls[0];
      const actualContent = modifyCall[1];

      expect(actualContent).toContain("Asked about creating daily notes");
      expect(actualContent).toContain("Inquired about template usage");

      createCondensedMessageSpy.mockRestore();
    });
  });

  describe("getUserMemoryPrompt", () => {
    it("should return memory prompt when recent conversations exist", async () => {
      const mockFile = createMockTFile("copilot/memory/Recent Conversations.md");
      const mockContent = "## Test Conversation\n**Time:** 2024-01-01T10:00:00Z\n";

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue(mockContent);

      const result = await userMemoryManager.getUserMemoryPrompt();

      expect(result).toBe(`\n${mockContent}\n`);
    });

    it("should return null when no memory content exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const result = await userMemoryManager.getUserMemoryPrompt();

      expect(result).toBeNull();
    });

    it("should handle errors and return null", async () => {
      const mockFile = createMockTFile("copilot/memory/Recent Conversations.md");
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockRejectedValue(new Error("Read error"));

      const result = await userMemoryManager.getUserMemoryPrompt();

      expect(result).toBeNull();
      expect(logError).toHaveBeenCalledWith(
        "[UserMemoryManager] Error reading recent conversations file:",
        expect.any(Error)
      );
    });
  });
});
