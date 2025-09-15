// Mock dependencies first to avoid circular dependencies
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(),
}));

import { UserMemoryManager } from "./UserMemoryManager";
import { App, TFile, Vault } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { getSettings } from "@/settings/model";
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
      sender: string = "user"
    ): ChatMessage => ({
      id,
      message,
      sender,
      timestamp: null,
      isVisible: true,
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

    it("should complete end-to-end memory update with new simple format", async () => {
      // Setup: Create test messages simulating a real conversation
      const messages = [
        createMockMessage(
          "1",
          "How do I create a daily note template in Obsidian with automatic date formatting?"
        ),
        createMockMessage(
          "2",
          "I can help you create a daily note template with automatic date formatting...",
          "ai"
        ),
        createMockMessage(
          "3",
          "That's perfect! Can you also show me how to add tags automatically?"
        ),
        createMockMessage("4", "Certainly! You can add automatic tags to your template...", "ai"),
      ];

      // Mock existing memory file with previous conversations
      const existingMemoryContent = `## Previous Conversation
**Time:** 2024-01-01T09:00:00Z
**Summary:** User asked about plugin installation and learned that plugins enhance Obsidian functionality.

## Another Conversation
**Time:** 2024-01-01T10:00:00Z
**Summary:** User inquired about linking notes and discovered that backlinks create knowledge connections.
`;

      const mockMemoryFile = createMockTFile("copilot/memory/Recent Conversations.md");

      // Mock ensureFolderExists to resolve successfully
      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);

      // Mock app instance for file operations
      mockVault.getAbstractFileByPath.mockReturnValue(mockMemoryFile);

      // Mock reading existing file content
      mockVault.read.mockResolvedValue(existingMemoryContent);

      // Mock LLM response for title and summary
      const mockResponse = new AIMessageChunk({
        content: JSON.stringify({
          title: "Daily Note Template Setup",
          summary:
            "User asked about creating daily note templates with automatic date formatting and tagging. Learned how to use template variables for dates and automatic tag insertion.",
        }),
      });
      mockChatModel.invoke.mockResolvedValueOnce(mockResponse);

      // Execute the updateMemory function directly to ensure proper awaiting
      await (userMemoryManager as any).updateMemory(messages, mockChatModel);

      // Verify the end result: file was modified with new conversation
      const modifyCall = mockVault.modify.mock.calls[0];
      const actualContent = modifyCall[1];

      // Check that the new format is used
      expect(actualContent).toContain("## Daily Note Template Setup");
      expect(actualContent).toMatch(/\*\*Time:\*\* \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
      expect(actualContent).toContain(
        "**Summary:** User asked about creating daily note templates"
      );

      // Verify previous conversations are preserved
      expect(actualContent).toContain("## Previous Conversation");
      expect(actualContent).toContain("## Another Conversation");

      // Verify that the title and summary were extracted via single LLM call
      expect(mockChatModel.invoke).toHaveBeenCalledTimes(1);

      // Verify the LLM call format
      expect(mockChatModel.invoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("generate both a title and a summary"),
          }),
        ])
      );
    });

    it("should handle LLM JSON parsing errors gracefully", async () => {
      const messages = [createMockMessage("1", "test message")];
      const mockMemoryFile = createMockTFile("copilot/memory/Recent Conversations.md");

      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);
      mockVault.getAbstractFileByPath.mockReturnValue(mockMemoryFile);
      mockVault.read.mockResolvedValue("");

      // Mock LLM response with invalid JSON
      const mockResponse = new AIMessageChunk({ content: "Invalid JSON response" });
      mockChatModel.invoke.mockResolvedValueOnce(mockResponse);

      await (userMemoryManager as any).updateMemory(messages, mockChatModel);

      // Should still create a conversation entry with fallback values
      const modifyCall = mockVault.modify.mock.calls[0];
      const actualContent = modifyCall[1];

      expect(actualContent).toContain("## Untitled Conversation");
      expect(actualContent).toContain("**Summary:** Summary generation failed");
      expect(logError).toHaveBeenCalledWith(
        "[UserMemoryManager] Failed to parse LLM response as JSON:",
        expect.any(Error)
      );
    });

    it("should handle JSON wrapped in code blocks from Gemini", async () => {
      const messages = [createMockMessage("1", "test message")];
      const mockMemoryFile = createMockTFile("copilot/memory/Recent Conversations.md");

      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);
      mockVault.getAbstractFileByPath.mockReturnValue(mockMemoryFile);
      mockVault.read.mockResolvedValue("");

      // Mock LLM response with JSON wrapped in code blocks (typical Gemini behavior)
      const mockResponse = new AIMessageChunk({
        content: `Here's the title and summary for the conversation:

\`\`\`json
{
  "title": "Code Block Test",
  "summary": "This tests JSON extraction from code blocks."
}
\`\`\``,
      });
      mockChatModel.invoke.mockResolvedValueOnce(mockResponse);

      await (userMemoryManager as any).updateMemory(messages, mockChatModel);

      // Should successfully extract JSON from code block
      const modifyCall = mockVault.modify.mock.calls[0];
      const actualContent = modifyCall[1];

      expect(actualContent).toContain("## Code Block Test");
      expect(actualContent).toContain("**Summary:** This tests JSON extraction from code blocks.");
    });

    it("should handle JSON wrapped in unmarked code blocks", async () => {
      const messages = [createMockMessage("1", "test message")];
      const mockMemoryFile = createMockTFile("copilot/memory/Recent Conversations.md");

      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);
      mockVault.getAbstractFileByPath.mockReturnValue(mockMemoryFile);
      mockVault.read.mockResolvedValue("");

      // Mock LLM response with JSON in unmarked code blocks
      const mockResponse = new AIMessageChunk({
        content: `\`\`\`
{
  "title": "Unmarked Block Test",
  "summary": "This tests JSON extraction from unmarked code blocks."
}
\`\`\``,
      });
      mockChatModel.invoke.mockResolvedValueOnce(mockResponse);

      await (userMemoryManager as any).updateMemory(messages, mockChatModel);

      // Should successfully extract JSON from unmarked code block
      const modifyCall = mockVault.modify.mock.calls[0];
      const actualContent = modifyCall[1];

      expect(actualContent).toContain("## Unmarked Block Test");
      expect(actualContent).toContain(
        "**Summary:** This tests JSON extraction from unmarked code blocks."
      );
    });
  });

  describe("extractJsonFromResponse", () => {
    it("should extract JSON from markdown code blocks with json language tag", () => {
      const content = `Here's the response:

\`\`\`json
{
  "title": "Test Title",
  "summary": "Test Summary"
}
\`\`\`

That's the JSON data.`;

      const result = (userMemoryManager as any).extractJsonFromResponse(content);
      expect(result).toBe('{\n  "title": "Test Title",\n  "summary": "Test Summary"\n}');
    });

    it("should extract JSON from unmarked code blocks", () => {
      const content = `\`\`\`
{
  "title": "Unmarked Block",
  "summary": "No language specified"
}
\`\`\``;

      const result = (userMemoryManager as any).extractJsonFromResponse(content);
      expect(result).toBe(
        '{\n  "title": "Unmarked Block",\n  "summary": "No language specified"\n}'
      );
    });

    it("should extract JSON object when no code blocks present", () => {
      const content = `Some text before {"title": "Inline JSON", "summary": "Direct JSON"} and after`;

      const result = (userMemoryManager as any).extractJsonFromResponse(content);
      expect(result).toBe('{"title": "Inline JSON", "summary": "Direct JSON"}');
    });

    it("should return original content when no JSON patterns found", () => {
      const content = "No JSON here, just plain text";

      const result = (userMemoryManager as any).extractJsonFromResponse(content);
      expect(result).toBe(content);
    });

    it("should handle multiline JSON in code blocks", () => {
      const content = `\`\`\`json
{
  "title": "Multi-line Test",
  "summary": "This is a test with\\nmultiple lines and special characters: äöü"
}
\`\`\``;

      const result = (userMemoryManager as any).extractJsonFromResponse(content);
      expect(result).toContain('"title": "Multi-line Test"');
      expect(result).toContain("special characters: äöü");
    });
  });

  describe("getUserMemoryPrompt", () => {
    it("should return memory prompt when recent conversations exist", async () => {
      const mockFile = createMockTFile("copilot/memory/Recent Conversations.md");
      const mockContent =
        "## Test Conversation\n**Time:** 2024-01-01T10:00:00Z\n**Summary:** Test summary";

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
