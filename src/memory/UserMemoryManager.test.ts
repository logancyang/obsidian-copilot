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
import { logError, logWarn } from "@/logger";
jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveMemoryFolder: jest.fn(() => "copilot/memory"),
}));
import { getEffectiveMemoryFolder } from "@/settings/copilotFolder";
const mockedMemoryFolder = getEffectiveMemoryFolder as jest.MockedFunction<
  typeof getEffectiveMemoryFolder
>;

import { CopilotSettings, getSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import { mockTFile } from "@/__tests__/mockObsidian";
import { waitFor } from "@testing-library/react";

const createMockTFile = (path: string): TFile => {
  const name = path.split("/").pop() || "";
  return mockTFile({
    path,
    name,
    basename: name.replace(/\.[^/.]+$/, ""),
    extension: path.split(".").pop() || "",
  });
};

const RECENT_PATH = "copilot/memory/Recent Conversations.md";

describe("UserMemoryManager", () => {
  let userMemoryManager: UserMemoryManager;
  let mockApp: jest.Mocked<App>;
  let mockVault: jest.Mocked<Vault>;
  let mockChatModel: jest.Mocked<BaseChatModel>;
  let mockSettings: Partial<CopilotSettings>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSettings = {
      enableRecentConversations: true,
      enableSavedMemory: true,
      memoryFolderName: "copilot/memory",
      maxRecentConversations: 30,
    };
    (getSettings as jest.Mock).mockReturnValue(mockSettings);

    mockVault = {
      getAbstractFileByPath: jest.fn(),
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      createFolder: jest.fn(),
    } as unknown as jest.Mocked<Vault>;

    mockApp = {
      vault: mockVault,
    } as unknown as jest.Mocked<App>;

    (ensureFolderExists as jest.Mock).mockReset().mockResolvedValue(undefined);

    mockChatModel = {
      invoke: jest.fn(),
    } as unknown as jest.Mocked<BaseChatModel>;

    mockedMemoryFolder.mockReturnValue("copilot/memory");
    userMemoryManager = new UserMemoryManager(mockApp);
  });

  describe("addRecentConversation()", () => {
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

    const messages = [createMockMessage("1", "How do I create a daily note template?")];

    function replyWith(content: string): void {
      mockChatModel.invoke.mockResolvedValueOnce(new AIMessageChunk({ content }));
    }

    function existingRecentFile(content: string): TFile {
      const file = createMockTFile(RECENT_PATH);
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.read.mockResolvedValue(content);
      return file;
    }

    async function writtenContent(): Promise<string> {
      await waitFor(() =>
        expect(mockVault.modify.mock.calls.length + mockVault.create.mock.calls.length).toBe(1)
      );
      const call = mockVault.modify.mock.calls[0] ?? mockVault.create.mock.calls[0];
      return call[1];
    }

    it("appends a titled, timestamped summary after the existing conversations", async () => {
      existingRecentFile(`## Previous Conversation
**Time:** 2024-01-01 09:00
**Summary:** User asked about plugin installation.

## Another Conversation
**Time:** 2024-01-01 10:00
**Summary:** User inquired about linking notes.
`);
      replyWith(
        JSON.stringify({
          title: "Daily Note Template Setup",
          summary: "User asked about creating daily note templates with automatic date formatting.",
        })
      );

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      const content = await writtenContent();
      expect(content).toMatch(
        /^## Previous Conversation\n[\s\S]*## Another Conversation\n[\s\S]*\n\n## Daily Note Template Setup\n\*\*Time:\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n\*\*Summary:\*\* User asked about creating daily note templates with automatic date formatting\.\n$/
      );
      expect(mockChatModel.invoke).toHaveBeenCalledTimes(1);
    });

    it("creates the Recent Conversations file when none exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      replyWith(JSON.stringify({ title: "First Chat", summary: "A first summary." }));

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      await waitFor(() =>
        expect(mockVault.create).toHaveBeenCalledWith(RECENT_PATH, expect.any(String))
      );
      expect(ensureFolderExists).toHaveBeenCalledWith(mockVault, "copilot/memory");
      expect(mockVault.create.mock.calls[0][1]).toContain("## First Chat\n");
    });

    it("replaces the file content when the existing file is blank", async () => {
      existingRecentFile("  \n");
      replyWith(JSON.stringify({ title: "First Chat", summary: "A first summary." }));

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      const content = await writtenContent();
      expect(content.startsWith("## First Chat\n")).toBe(true);
    });

    it.each([
      ["a json code fence", '```json\n{"title": "Fenced", "summary": "From a fence"}\n```'],
      ["an unmarked code fence", '```\n{"title": "Fenced", "summary": "From a fence"}\n```'],
      [
        "surrounding prose",
        'Here you go: {"title": "Fenced", "summary": "From a fence"} hope it helps',
      ],
    ])("reads the title and summary from a model reply wrapped in %s", async (_label, reply) => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      replyWith(reply);

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      const content = await writtenContent();
      expect(content).toContain("## Fenced\n");
      expect(content).toContain("**Summary:** From a fence\n");
    });

    it("falls back to an untitled entry and logs when the model reply is not JSON", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      replyWith("Invalid JSON response");

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      const content = await writtenContent();
      expect(content).toContain("## Untitled Conversation");
      expect(content).toContain("**Summary:** Summary generation failed");
      expect(logError).toHaveBeenCalledWith(
        "[UserMemoryManager] Failed to parse LLM response as JSON:",
        expect.any(Error)
      );
    });

    it("keeps each existing conversation as its own trimmed section and drops text before the first section", async () => {
      existingRecentFile(`Intro text that is not a conversation.

  ## First Conversation  
**Time:** 2024-01-01 09:00
**Summary:** Multi-line summary:
- point one
- point two  

## Second Conversation
**Time:** 2024-01-01 10:00
**Summary:** Short.
`);
      replyWith(JSON.stringify({ title: "Third", summary: "Third summary." }));

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      const content = await writtenContent();
      expect(content).not.toContain("Intro text");
      expect(content).toContain(
        "## First Conversation  \n**Time:** 2024-01-01 09:00\n**Summary:** Multi-line summary:\n- point one\n- point two\n\n## Second Conversation"
      );
    });

    it("drops the oldest conversations once maxRecentConversations is exceeded", async () => {
      mockSettings.maxRecentConversations = 2;
      existingRecentFile(`## Oldest
**Time:** 2024-01-01 09:00
**Summary:** One.

## Middle
**Time:** 2024-01-01 10:00
**Summary:** Two.
`);
      replyWith(JSON.stringify({ title: "Newest", summary: "Three." }));

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      const content = await writtenContent();
      expect(content).not.toContain("## Oldest");
      expect(content).toContain("## Middle");
      expect(content).toContain("## Newest");
    });

    it("writes the summary to the memory root that is current when the model returns", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockChatModel.invoke.mockImplementation(async () => {
        mockedMemoryFolder.mockReturnValue("moved/memory");
        return new AIMessageChunk({ content: '{"summary":"s","topics":[],"insights":[]}' });
      });

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      await waitFor(() =>
        expect(mockVault.create).toHaveBeenCalledWith(
          "moved/memory/Recent Conversations.md",
          expect.any(String)
        )
      );
      expect(ensureFolderExists).toHaveBeenCalledWith(mockVault, "moved/memory");
    });

    it("skips the update and warns when recent conversations are disabled", () => {
      mockSettings.enableRecentConversations = false;

      userMemoryManager.addRecentConversation(messages, mockChatModel);

      expect(logWarn).toHaveBeenCalledWith(
        "[UserMemoryManager] Recent history referencing is disabled, skipping analysis"
      );
      expect(mockChatModel.invoke).not.toHaveBeenCalled();
    });

    it("skips the update and warns when there are no messages", () => {
      userMemoryManager.addRecentConversation([], mockChatModel);

      expect(logWarn).toHaveBeenCalledWith(
        "[UserMemoryManager] No messages to analyze for user memory"
      );
      expect(mockChatModel.invoke).not.toHaveBeenCalled();
    });
  });

  describe("updateSavedMemory()", () => {
    it("creates the Saved Memories file from the model's merged list", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      const merged = "- The user prefers concise responses";
      mockChatModel.invoke.mockResolvedValue(new AIMessageChunk({ content: merged }));

      const result = await userMemoryManager.updateSavedMemory(
        "I prefer concise responses",
        mockChatModel
      );

      expect(ensureFolderExists).toHaveBeenCalledWith(mockVault, "copilot/memory");
      expect(mockVault.create).toHaveBeenCalledWith("copilot/memory/Saved Memories.md", merged);
      expect(result).toEqual({ content: merged, filePath: "copilot/memory/Saved Memories.md" });
    });

    it("overwrites an existing Saved Memories file with the model's merged list", async () => {
      const file = createMockTFile("copilot/memory/Saved Memories.md");
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockVault.read.mockResolvedValue("- Previous memory content\n- Another important fact\n");
      const merged =
        "- Previous memory content\n- Another important fact\n- New important information";
      mockChatModel.invoke.mockResolvedValue(new AIMessageChunk({ content: merged }));

      const result = await userMemoryManager.updateSavedMemory(
        "New important information",
        mockChatModel
      );

      expect(mockVault.modify).toHaveBeenCalledWith(file, merged);
      expect(result).toEqual({ content: merged, filePath: "copilot/memory/Saved Memories.md" });
    });

    it("reports the path it wrote, not one re-resolved after the root moved", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockChatModel.invoke.mockImplementation(async () => {
        mockedMemoryFolder.mockReturnValue("moved/memory");
        return new AIMessageChunk({ content: "- remembered" });
      });

      const result = await userMemoryManager.updateSavedMemory("remember this", mockChatModel);

      expect(result.filePath).toBe("copilot/memory/Saved Memories.md");
      expect(mockVault.create).toHaveBeenCalledWith(
        "copilot/memory/Saved Memories.md",
        expect.any(String)
      );
    });

    it("returns an error without calling the model when saved memory is disabled", async () => {
      mockSettings.enableSavedMemory = false;

      const result = await userMemoryManager.updateSavedMemory(
        "Test memory content",
        mockChatModel
      );

      expect(result).toEqual({ error: "Saved memory is disabled, skipping save" });
      expect(mockChatModel.invoke).not.toHaveBeenCalled();
    });

    it("returns an error when no content is provided", async () => {
      const result = await userMemoryManager.updateSavedMemory("", mockChatModel);

      expect(result).toEqual({ error: "No content provided for saved memory" });
    });

    it("returns the error message when the memory folder cannot be created", async () => {
      (ensureFolderExists as jest.Mock).mockRejectedValue(new Error("Folder creation failed"));

      const result = await userMemoryManager.updateSavedMemory("Test content", mockChatModel);

      expect(result).toEqual({ error: "Error saving memory: Folder creation failed" });
    });
  });

  describe("getUserMemoryPrompt()", () => {
    it("wraps the recent conversations in a memory prompt when they exist", async () => {
      const mockFile = createMockTFile(RECENT_PATH);
      const mockContent =
        "## Test Conversation\n**Time:** 2024-01-01 10:00\n**Summary:** Test summary";
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue(mockContent);

      const result = await userMemoryManager.getUserMemoryPrompt();

      expect(result).toContain(mockContent);
      expect(result).toContain("<recent_conversations>");
      expect(result).toContain("</recent_conversations>");
    });

    it("returns null when no memory content exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      expect(await userMemoryManager.getUserMemoryPrompt()).toBeNull();
    });

    it("returns null and logs when reading the memory file fails", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(createMockTFile(RECENT_PATH));
      mockVault.read.mockRejectedValue(new Error("Read error"));

      const result = await userMemoryManager.getUserMemoryPrompt();

      expect(result).toBeNull();
      expect(logError).toHaveBeenCalledWith(
        "[UserMemoryManager] Error reading memory files:",
        expect.any(Error)
      );
    });
  });
});
