// Mock dependencies first to avoid circular dependencies
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
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
import { logInfo, logError, logWarn } from "@/logger";
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
      enableRecentConversations: true,
      enableSavedMemory: true,
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

  describe("addRecentConversation", () => {
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
      mockSettings.enableRecentConversations = false;
      const messages = [createMockMessage("1", "test message")];

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      expect(logWarn).toHaveBeenCalledWith(
        "[UserMemoryManager] Recent history referencing is disabled, skipping analysis"
      );
    });

    it("should skip memory update when no messages provided", () => {
      userMemoryManager.addRecentConversation([], mockChatModel);

      expect(logWarn).toHaveBeenCalledWith(
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
**Time:** 2024-01-01 09:00
**Summary:** User asked about plugin installation and learned that plugins enhance Obsidian functionality.

## Another Conversation
**Time:** 2024-01-01 10:00
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
      expect(actualContent).toMatch(/\*\*Time:\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
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

  describe("parseExistingConversations", () => {
    it("should return empty array for empty string", () => {
      const result = (userMemoryManager as any).parseExistingConversations("");
      expect(result).toEqual([]);
    });

    it("should return empty array for content with no H2 sections", () => {
      const content = `This is some content without H2 headers.
It has multiple lines but no conversations.
# This is H1, not H2
### This is H3, not H2`;

      const result = (userMemoryManager as any).parseExistingConversations(content);
      expect(result).toEqual([]);
    });

    it("should extract single conversation section", () => {
      const content = `## Daily Note Template Setup
**Time:** 2024-01-01 10:00
**Summary:** User asked about creating daily note templates with automatic date formatting.`;

      const result = (userMemoryManager as any).parseExistingConversations(content);
      expect(result).toEqual([
        `## Daily Note Template Setup
**Time:** 2024-01-01 10:00
**Summary:** User asked about creating daily note templates with automatic date formatting.`,
      ]);
    });

    it("should extract multiple conversation sections", () => {
      const content = `## First Conversation
**Time:** 2024-01-01 09:00
**Summary:** User asked about plugin installation.

## Second Conversation
**Time:** 2024-01-01 10:00
**Summary:** User inquired about linking notes.

## Third Conversation
**Time:** 2024-01-01 11:00
**Summary:** User learned about backlinks.`;

      const result = (userMemoryManager as any).parseExistingConversations(content);
      expect(result).toEqual([
        `## First Conversation
**Time:** 2024-01-01 09:00
**Summary:** User asked about plugin installation.`,
        `## Second Conversation
**Time:** 2024-01-01 10:00
**Summary:** User inquired about linking notes.`,
        `## Third Conversation
**Time:** 2024-01-01 11:00
**Summary:** User learned about backlinks.`,
      ]);
    });

    it("should ignore content before the first H2 section", () => {
      const content = `This is some introductory text that should be ignored.
It might contain important information, but it's before the first conversation.

## First Conversation
**Time:** 2024-01-01 09:00
**Summary:** This conversation should be included.

## Second Conversation
**Time:** 2024-01-01 10:00
**Summary:** This conversation should also be included.`;

      const result = (userMemoryManager as any).parseExistingConversations(content);
      expect(result).toEqual([
        `## First Conversation
**Time:** 2024-01-01 09:00
**Summary:** This conversation should be included.`,
        `## Second Conversation
**Time:** 2024-01-01 10:00
**Summary:** This conversation should also be included.`,
      ]);
    });

    it("should handle conversations with extra whitespace and trim them", () => {
      const content = `  ## First Conversation  
**Time:** 2024-01-01 09:00
**Summary:** User asked about plugin installation.  

  ## Second Conversation  
**Time:** 2024-01-01 10:00
**Summary:** User inquired about linking notes.  `;

      const result = (userMemoryManager as any).parseExistingConversations(content);
      expect(result).toEqual([
        `## First Conversation  
**Time:** 2024-01-01 09:00
**Summary:** User asked about plugin installation.`,
        `## Second Conversation  
**Time:** 2024-01-01 10:00
**Summary:** User inquired about linking notes.`,
      ]);
    });

    it("should handle conversation sections with complex multi-line content", () => {
      const content = `## Complex Conversation
**Time:** 2024-01-01 09:00
**Summary:** User asked about multiple topics including:
- How to create templates
- How to use variables
- How to set up automation

The conversation covered advanced features and included code examples.

## Another Conversation
**Time:** 2024-01-01 10:00
**Summary:** Short summary.`;

      const result = (userMemoryManager as any).parseExistingConversations(content);
      expect(result).toEqual([
        `## Complex Conversation
**Time:** 2024-01-01 09:00
**Summary:** User asked about multiple topics including:
- How to create templates
- How to use variables
- How to set up automation

The conversation covered advanced features and included code examples.`,
        `## Another Conversation
**Time:** 2024-01-01 10:00
**Summary:** Short summary.`,
      ]);
    });

    it("should handle conversation at end of file without trailing newlines", () => {
      const content = `## Only Conversation
**Time:** 2024-01-01 09:00
**Summary:** This is the only conversation and it's at the end.`;

      const result = (userMemoryManager as any).parseExistingConversations(content);
      expect(result).toEqual([
        `## Only Conversation
**Time:** 2024-01-01 09:00
**Summary:** This is the only conversation and it's at the end.`,
      ]);
    });
  });

  describe("getUserMemoryPrompt", () => {
    it("should return memory prompt when recent conversations exist", async () => {
      const mockFile = createMockTFile("copilot/memory/Recent Conversations.md");
      const mockContent =
        "## Test Conversation\n**Time:** 2024-01-01 10:00\n**Summary:** Test summary";

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue(mockContent);

      const result = await userMemoryManager.getUserMemoryPrompt();

      expect(result).toContain(mockContent);
      expect(result).toContain("<recent_conversations>");
      expect(result).toContain("</recent_conversations>");
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
        "[UserMemoryManager] Error reading memory files:",
        expect.any(Error)
      );
    });
  });

  describe("addSavedMemory", () => {
    it("should skip saving when saved memory is disabled", async () => {
      mockSettings.enableSavedMemory = false;

      const result = await userMemoryManager.updateSavedMemory(
        "Test memory content",
        mockChatModel
      );

      expect(result).toEqual({ success: false, content: "" });
      expect(logWarn).toHaveBeenCalledWith(
        "[UserMemoryManager] Saved memory is disabled, skipping save"
      );
    });

    it("should skip saving when no content provided", async () => {
      mockSettings.enableSavedMemory = true;

      const result = await userMemoryManager.updateSavedMemory("", mockChatModel);

      expect(result).toEqual({ success: false, content: "" });
      expect(logWarn).toHaveBeenCalledWith(
        "[UserMemoryManager] No content provided for saved memory"
      );
    });

    it("should save memory content to Saved Memories file", async () => {
      mockSettings.enableSavedMemory = true;

      // Mock ensureFolderExists to resolve successfully
      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);

      // Mock no existing file (new file creation)
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      // Mock file creation
      const mockNewFile = createMockTFile("copilot/memory/Saved Memories.md");
      mockVault.create.mockResolvedValue(mockNewFile);

      // Mock LLM merge result content
      const llmMergedContent = `- The user prefers concise responses`;
      (mockChatModel.invoke as jest.Mock).mockResolvedValue(
        new AIMessageChunk({ content: llmMergedContent })
      );

      const result = await userMemoryManager.updateSavedMemory(
        "I prefer concise responses",
        mockChatModel
      );

      // Verify folder creation was called
      expect(ensureFolderExists).toHaveBeenCalledWith("copilot/memory");

      // Verify file creation was called with proper content
      expect(mockVault.create).toHaveBeenCalledWith(
        "copilot/memory/Saved Memories.md",
        expect.stringContaining("- The user prefers concise responses")
      );

      const createdContent = mockVault.create.mock.calls[0][1];
      expect(createdContent).not.toContain("**");

      expect(result).toEqual({ success: true, content: llmMergedContent });
      expect(logInfo).toHaveBeenCalledWith("[UserMemoryManager] Saved memory added successfully");
    });

    it("should append to existing Saved Memories file", async () => {
      mockSettings.enableSavedMemory = true;

      const existingContent = `- Previous memory content
- Another important fact
`;

      const mockMemoryFile = createMockTFile("copilot/memory/Saved Memories.md");

      // Mock ensureFolderExists to resolve successfully
      (ensureFolderExists as jest.Mock).mockResolvedValue(undefined);

      // Mock existing file
      mockVault.getAbstractFileByPath.mockReturnValue(mockMemoryFile);
      mockVault.read.mockResolvedValue(existingContent);

      // Mock LLM to return merged full list
      const mergedContent = `- Previous memory content\n- Another important fact\n- New important information`;
      (mockChatModel.invoke as jest.Mock).mockResolvedValue(
        new AIMessageChunk({ content: mergedContent })
      );

      const result = await userMemoryManager.updateSavedMemory(
        "New important information",
        mockChatModel
      );

      // Verify file modification was called with appended content
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockMemoryFile,
        expect.stringContaining("- Previous memory content")
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockMemoryFile,
        expect.stringContaining("- New important information")
      );

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).not.toContain("**");

      expect(result).toEqual({ success: true, content: mergedContent });
      expect(logInfo).toHaveBeenCalledWith("[UserMemoryManager] Saved memory added successfully");
    });

    it("should handle errors during save operation", async () => {
      mockSettings.enableSavedMemory = true;

      // Mock ensureFolderExists to reject
      (ensureFolderExists as jest.Mock).mockRejectedValue(new Error("Folder creation failed"));

      const result = await userMemoryManager.updateSavedMemory("Test content", mockChatModel);

      expect(result).toEqual({ success: false, content: "" });
      expect(logError).toHaveBeenCalledWith(
        "[UserMemoryManager] Error saving memory:",
        expect.any(Error)
      );
    });
  });
});
