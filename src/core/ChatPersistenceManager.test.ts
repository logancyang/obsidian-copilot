import { Notice, TFile } from "obsidian";
import { ChatPersistenceManager } from "./ChatPersistenceManager";
import { ChatMessage } from "@/types/message";

const USER_SENDER = "user";
const AI_SENDER = "ai";

// Mock the imports
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  TFile: jest.fn(),
  TFolder: jest.fn(),
}));
jest.mock("@/logger");
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({
    defaultSaveFolder: "test-folder",
    defaultConversationTag: "copilot-conversation",
    defaultConversationNoteName: "{$date}_{$time}__{$topic}",
  }),
}));
jest.mock("@/aiParams", () => ({
  getCurrentProject: jest.fn().mockReturnValue(null),
}));
jest.mock("@/utils", () => ({
  formatDateTime: jest.fn((date) => ({
    fileName: "20240923_221800",
    display: "2024/09/23 22:18:00",
  })),
}));

describe("ChatPersistenceManager", () => {
  let mockApp: any;
  let mockMessageRepo: any;
  let persistenceManager: ChatPersistenceManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock app
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        createFolder: jest.fn(),
        create: jest.fn(),
        modify: jest.fn(),
        read: jest.fn(),
        getMarkdownFiles: jest.fn().mockReturnValue([]),
      },
    };

    // Setup mock message repository
    mockMessageRepo = {
      getDisplayMessages: jest.fn(),
    };

    // Create persistence manager
    persistenceManager = new ChatPersistenceManager(mockApp, mockMessageRepo);
  });

  describe("formatChatContent", () => {
    it("should format messages in the correct format", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "my name is logan, what's your name",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
        {
          id: "2",
          message:
            "I don't have a name. I am a large language model. My purpose is to help users like you.",
          sender: AI_SENDER,
          timestamp: {
            epoch: 1695513481000,
            display: "2024/09/23 22:18:01",
            fileName: "2024_09_23_221801",
          },
          isVisible: true,
        },
        {
          id: "3",
          message: "what's my name",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695514580000,
            display: "2024/09/23 22:56:20",
            fileName: "2024_09_23_225620",
          },
          isVisible: true,
        },
        {
          id: "4",
          message: "Your name is Logan.",
          sender: AI_SENDER,
          timestamp: {
            epoch: 1695514580000,
            display: "2024/09/23 22:56:20",
            fileName: "2024_09_23_225620",
          },
          isVisible: true,
        },
      ];

      const result = (persistenceManager as any).formatChatContent(messages);

      const expected = `**user**: my name is logan, what's your name
[Timestamp: 2024/09/23 22:18:00]

**ai**: I don't have a name. I am a large language model. My purpose is to help users like you.
[Timestamp: 2024/09/23 22:18:01]

**user**: what's my name
[Timestamp: 2024/09/23 22:56:20]

**ai**: Your name is Logan.
[Timestamp: 2024/09/23 22:56:20]`;

      expect(result).toBe(expected);
    });

    it("should handle messages without timestamps", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Hello",
          sender: USER_SENDER,
          timestamp: null,
          isVisible: true,
        },
      ];

      const result = (persistenceManager as any).formatChatContent(messages);

      expect(result).toBe(`**user**: Hello
[Timestamp: Unknown time]`);
    });
  });

  describe("parseChatContent", () => {
    it("should parse standard format correctly", () => {
      const content = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

**user**: my name is logan, what's your name
[Timestamp: 2024/09/23 22:18:00]

**ai**: I don't have a name. I am a large language model. My purpose is to help users like you.
[Timestamp: 2024/09/23 22:18:01]

**user**: what is your creator
[Timestamp: 2024/09/23 22:39:27]

**user**: what's my name
[Timestamp: 2024/09/23 22:56:20]

**ai**: Your name is Logan.
[Timestamp: 2024/09/23 22:56:20]`;

      const result = (persistenceManager as any).parseChatContent(content);

      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({
        message: "my name is logan, what's your name",
        sender: USER_SENDER,
        isVisible: true,
        timestamp: {
          display: "2024/09/23 22:18:00",
        },
      });
      expect(result[1]).toMatchObject({
        message:
          "I don't have a name. I am a large language model. My purpose is to help users like you.",
        sender: AI_SENDER,
        isVisible: true,
        timestamp: {
          display: "2024/09/23 22:18:01",
        },
      });
      expect(result[2]).toMatchObject({
        message: "what is your creator",
        sender: USER_SENDER,
      });
      expect(result[3]).toMatchObject({
        message: "what's my name",
        sender: USER_SENDER,
      });
      expect(result[4]).toMatchObject({
        message: "Your name is Logan.",
        sender: AI_SENDER,
      });
    });

    it("should handle multi-line messages", () => {
      const content = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

**user**: Can you write a haiku?
[Timestamp: 2024/09/23 22:18:00]

**ai**: Here's a haiku for you:

Autumn leaves falling
Gentle breeze whispers secrets
Nature's quiet song
[Timestamp: 2024/09/23 22:18:01]`;

      const result = (persistenceManager as any).parseChatContent(content);

      expect(result).toHaveLength(2);
      expect(result[1].message).toBe(`Here's a haiku for you:

Autumn leaves falling
Gentle breeze whispers secrets
Nature's quiet song`);
    });

    it("should handle messages without timestamps", () => {
      const content = `**user**: Hello
[Timestamp: Unknown time]

**ai**: Hi there!
[Timestamp: Unknown time]`;

      const result = (persistenceManager as any).parseChatContent(content);

      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBeNull();
      expect(result[1].timestamp).toBeNull();
    });
  });

  describe("saveChat", () => {
    it("should save chat to a markdown file", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Hello",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true); // Folder exists

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.create).toHaveBeenCalledWith(
        "test-folder/20240923_221800__Hello.md",
        expect.stringContaining("**user**: Hello")
      );
    });

    it("should not save when there are no messages", async () => {
      mockMessageRepo.getDisplayMessages.mockReturnValue([]);

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.create).not.toHaveBeenCalled();
      // Notice constructor should have been called
      expect(jest.mocked(Notice)).toHaveBeenCalled();
    });
  });

  describe("loadChat", () => {
    it("should load and parse chat from file", async () => {
      const fileContent = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

**user**: Hello
[Timestamp: 2024/09/23 22:18:00]

**ai**: Hi there!
[Timestamp: 2024/09/23 22:18:01]`;

      const mockFile = { path: "test.md" } as TFile;
      mockApp.vault.read.mockResolvedValue(fileContent);

      const result = await persistenceManager.loadChat(mockFile);

      expect(result).toHaveLength(2);
      expect(result[0].sender).toBe(USER_SENDER);
      expect(result[1].sender).toBe(AI_SENDER);
    });
  });

  describe("round-trip save and load", () => {
    it("should preserve messages through save and load cycle", async () => {
      const originalMessages: ChatMessage[] = [
        {
          id: "1",
          message: "What is TypeScript?",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
        {
          id: "2",
          message: "TypeScript is a strongly typed programming language that builds on JavaScript.",
          sender: AI_SENDER,
          timestamp: {
            epoch: 1695513481000,
            display: "2024/09/23 22:18:01",
            fileName: "2024_09_23_221801",
          },
          isVisible: true,
        },
      ];

      // Format the content
      const formattedContent = (persistenceManager as any).formatChatContent(originalMessages);

      // Add frontmatter
      const fullContent = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

${formattedContent}`;

      // Parse it back
      const parsedMessages = (persistenceManager as any).parseChatContent(fullContent);

      // Verify the messages match
      expect(parsedMessages).toHaveLength(2);
      expect(parsedMessages[0].message).toBe(originalMessages[0].message);
      expect(parsedMessages[0].sender).toBe(originalMessages[0].sender);
      expect(parsedMessages[1].message).toBe(originalMessages[1].message);
      expect(parsedMessages[1].sender).toBe(originalMessages[1].sender);
    });
  });
});
