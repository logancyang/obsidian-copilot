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

import { UserMemoryManager } from "./UserMemoryManager";
import { App, TFile, Vault } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { USER_SENDER } from "@/constants";
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
      condensedMessage: `Condensed: ${message}`,
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

    it("should create nested memory folders recursively", async () => {
      const messages = [createMockMessage("1", "test user message")];

      // Set nested folder path in settings
      mockSettings.memoryFolderName = "deep/nested/memory/folder";

      // Mock folders don't exist
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      // Mock LLM responses
      const mockResponse1 = new AIMessageChunk({ content: "Test Conversation Title" });
      const mockResponse2 = new AIMessageChunk({ content: "NONE" });
      mockChatModel.invoke.mockResolvedValueOnce(mockResponse1);
      mockChatModel.invoke.mockResolvedValueOnce(mockResponse2);

      userMemoryManager.updateUserMemory(messages, mockChatModel);

      // Wait for async operation to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify all nested folders were created
      expect(mockVault.createFolder).toHaveBeenCalledWith("deep");
      expect(mockVault.createFolder).toHaveBeenCalledWith("deep/nested");
      expect(mockVault.createFolder).toHaveBeenCalledWith("deep/nested/memory");
      expect(mockVault.createFolder).toHaveBeenCalledWith("deep/nested/memory/folder");

      // Verify file creation in nested path
      expect(mockVault.create).toHaveBeenCalledWith(
        "deep/nested/memory/folder/Recent Conversations.md",
        expect.stringContaining("## Test Conversation Title")
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

      // Mock vault responses for folder and file existence
      const mockFolder = { path: "copilot/memory", name: "memory" } as any;
      mockVault.getAbstractFileByPath
        .mockReturnValueOnce(mockFolder) // Folder exists
        .mockReturnValueOnce(mockMemoryFile); // File exists

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

      // Execute the updateUserMemory function
      userMemoryManager.updateUserMemory(messages, mockChatModel);

      // Wait for async operation to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the end result: file was modified with new conversation
      const modifyCall = mockVault.modify.mock.calls[0];
      const actualContent = modifyCall[1];

      // Verify that the content includes all previous conversations plus the new one
      expect(actualContent).toContain("## Previous Conversation");
      expect(actualContent).toContain("## Another Conversation");
      expect(actualContent).toContain("## Daily Note Template Setup");

      // Verify the new conversation structure
      expect(actualContent).toMatch(/\*\*Time:\*\* \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
      expect(actualContent).toContain("**User Messages:**");
      expect(actualContent).toContain("- Condensed: How do I create a daily note template");
      expect(actualContent).toContain(
        "- Condensed: That's perfect! Can you also show me how to add tags"
      );

      // Since we provided a detailed conversation, key conclusions should be included
      expect(actualContent).toContain("**Key Conclusions:**");
      expect(actualContent).toContain("- Templates can automatically insert dates and metadata");
      expect(actualContent).toContain("- Tags can be added through template variables");

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
