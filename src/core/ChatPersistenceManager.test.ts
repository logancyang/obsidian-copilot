import { ChatMessage } from "@/types/message";
import { Notice, TFile } from "obsidian";
import { ChatPersistenceManager } from "./ChatPersistenceManager";

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
    defaultConversationNoteName: "{$topic}@{$date}_{$time}",
    generateAIChatTitleOnSave: true,
  }),
}));
jest.mock("@/aiParams", () => ({
  getCurrentProject: jest.fn().mockReturnValue(null),
}));
jest.mock("@/utils", () => ({
  extractTextFromChunk: jest.fn((content) => {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((item) => item?.type === "text")
        .map((item) => item?.text || "")
        .join("");
    }
    if (content && typeof content === "object" && "text" in content) {
      return String((content as { text?: unknown }).text ?? "");
    }
    return String(content ?? "");
  }),
  formatDateTime: jest.fn((date) => ({
    fileName: "20240923_221800",
    display: "2024/09/23 22:18:00",
  })),
  ensureFolderExists: jest.fn(async () => {}),
  getUtf8ByteLength: jest.fn((str: string) => {
    return new TextEncoder().encode(str).length;
  }),
  truncateToByteLimit: jest.fn((str: string, byteLimit: number) => {
    if (byteLimit <= 0) {
      return "";
    }

    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    if (bytes.length <= byteLimit) {
      return str;
    }

    let low = 0;
    let high = str.length;
    let result = "";

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = str.substring(0, mid);
      const candidateBytes = encoder.encode(candidate);

      if (candidateBytes.length <= byteLimit) {
        result = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }),
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
        getAbstractFileByPath: jest.fn().mockReturnValue(null), // Default: file not found
        createFolder: jest.fn(),
        create: jest.fn(),
        modify: jest.fn(),
        read: jest.fn(),
        getMarkdownFiles: jest.fn().mockReturnValue([]), // Default: no files
        adapter: {
          exists: jest.fn().mockResolvedValue(false),
          read: jest.fn().mockResolvedValue(""),
          write: jest.fn().mockResolvedValue(undefined),
          list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
          stat: jest.fn().mockResolvedValue({ ctime: Date.now(), mtime: Date.now(), size: 0 }),
        },
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
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
        "test-folder/Hello@20240923_221800.md",
        expect.stringContaining("**user**: Hello")
      );
      const savedContent = mockApp.vault.create.mock.calls[0][1];
      expect(savedContent).not.toContain("topic:");
    });

    it("should use AI topic text from structured responses without object artifacts", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Summarize weather data",
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
          message: "Here is the summary...",
          sender: AI_SENDER,
          timestamp: {
            epoch: 1695513481000,
            display: "2024/09/23 22:18:01",
            fileName: "2024_09_23_221801",
          },
          isVisible: true,
        },
      ];

      const invoke = jest.fn().mockResolvedValue({
        content: [
          { type: "text", text: "Forecast Insights" },
          { type: "tool_call", id: "ignored", name: "analysis" },
        ],
      });

      const chainManager = {
        chatModelManager: {
          getChatModel: jest.fn().mockReturnValue({ invoke }),
        },
      } as any;

      persistenceManager = new ChatPersistenceManager(mockApp, mockMessageRepo, chainManager);
      const mockFile = {
        path: "test-folder/Summarize_weather_data@20240923_221800.md",
      } as unknown as TFile;
      mockApp.vault.create.mockResolvedValue(mockFile);
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      const frontmatterState: Record<string, unknown> = {};
      mockApp.fileManager.processFrontMatter.mockImplementation(
        async (file: TFile, updater: (frontmatter: Record<string, unknown>) => void) => {
          void file;
          updater(frontmatterState);
        }
      );

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.create).toHaveBeenCalledWith(
        "test-folder/Summarize_weather_data@20240923_221800.md",
        expect.stringContaining("Summarize weather data")
      );
      const savedContent = mockApp.vault.create.mock.calls[0][1];
      expect(savedContent).not.toContain("topic:");
      await Promise.resolve();
      await Promise.resolve();

      expect(invoke).toHaveBeenCalled();
      expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
        mockFile,
        expect.any(Function)
      );
      expect(frontmatterState.topic).toBe("Forecast Insights");
    });

    it("should not save when there are no messages", async () => {
      mockMessageRepo.getDisplayMessages.mockReturnValue([]);

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.create).not.toHaveBeenCalled();
      // Notice constructor should have been called
      expect(jest.mocked(Notice)).toHaveBeenCalled();
    });

    it("should sanitize wiki link brackets and illegal characters in filename", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Check [[My Note]] and path [ref] :: test \\\u0000",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("gpt-4");

      // Expect [[My Note]] -> My Note, [ref] -> ref, illegal chars removed, spaces -> underscores
      expect(mockApp.vault.create).toHaveBeenCalledWith(
        "test-folder/Check_My_Note_and_path_ref_test@20240923_221800.md",
        expect.any(String)
      );
    });

    it("should fallback to 'Untitled Chat' when sanitized topic is empty", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "[[]] [] {} :: :: \\",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.create).toHaveBeenCalledWith(
        "test-folder/Untitled_Chat@20240923_221800.md",
        expect.any(String)
      );
    });

    it("should handle very long ASCII filenames by truncating to byte limit", async () => {
      const longMessage =
        "This is a very long message that contains many many words and should be truncated to fit within the filesystem byte limit to prevent ENAMETOOLONG errors";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: longMessage,
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("gpt-4");

      const createdPath = mockApp.vault.create.mock.calls[0][0] as string;
      const basename = createdPath.split("/").pop() || "";
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(basename).length;

      // Verify the filename is within safe limits (100 bytes)
      expect(byteLength).toBeLessThanOrEqual(100);
    });

    it("should handle Cyrillic text filenames by truncating to byte limit", async () => {
      const cyrillicMessage =
        "используй словарь уже установленных терминов Словарь перевода Songs of Syx придерживайся правил перевода Правила перевода Songs of Syx сделай перевод для слова";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: cyrillicMessage,
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("gpt-4");

      const createdPath = mockApp.vault.create.mock.calls[0][0] as string;
      const basename = createdPath.split("/").pop() || "";
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(basename).length;

      // Verify the filename is within safe limits (100 bytes)
      expect(byteLength).toBeLessThanOrEqual(100);
      // Verify the filename contains some Cyrillic text (not completely truncated)
      expect(basename.length).toBeGreaterThan(20);
    });

    it("should handle emoji filenames by truncating to byte limit", async () => {
      const emojiMessage = "🚀 Launch the rocket 🌟 to the stars ✨ with amazing features 🎉🎊🎈";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: emojiMessage,
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("gpt-4");

      const createdPath = mockApp.vault.create.mock.calls[0][0] as string;
      const basename = createdPath.split("/").pop() || "";
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(basename).length;

      // Verify the filename is within safe limits (100 bytes)
      expect(byteLength).toBeLessThanOrEqual(100);
    });

    it("should handle mixed Unicode text (Chinese, Japanese, Korean) by truncating to byte limit", async () => {
      const mixedUnicodeMessage =
        "你好世界 こんにちは世界 안녕하세요 세계 Hello World Привет мир مرحبا بالعالم";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: mixedUnicodeMessage,
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("gpt-4");

      const createdPath = mockApp.vault.create.mock.calls[0][0] as string;
      const basename = createdPath.split("/").pop() || "";
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(basename).length;

      // Verify the filename is within safe limits (100 bytes)
      expect(byteLength).toBeLessThanOrEqual(100);
    });

    it("should handle filenames with project prefix within byte limit", async () => {
      const longMessage =
        "This is a very long message that should be truncated when combined with a project prefix";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: longMessage,
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      // Mock getCurrentProject to return a project
      const getCurrentProject = jest.requireMock("@/aiParams").getCurrentProject;
      getCurrentProject.mockReturnValue({ id: "project-123", name: "Test Project" });

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("gpt-4");

      const createdPath = mockApp.vault.create.mock.calls[0][0] as string;
      const basename = createdPath.split("/").pop() || "";
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(basename).length;

      // Verify the filename is within safe limits (100 bytes)
      expect(byteLength).toBeLessThanOrEqual(100);
      // Verify the project prefix is included
      expect(basename).toContain("project-123__");

      // Reset mock
      getCurrentProject.mockReturnValue(null);
    });

    it("should fallback to minimal filename when ENAMETOOLONG error occurs", async () => {
      // Real-world scenario from user log: very long Cyrillic message that triggers ENAMETOOLONG
      const cyrillicMessage =
        "1) используй словарь уже установленных терминов Словарь перевода Songs of Syx придерживайся правил перевода Правила перевода Songs of Syx сделай перевод для слова";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: cyrillicMessage,
          sender: USER_SENDER,
          timestamp: {
            epoch: 1729873880000,
            display: "2025/10/25 16:11:20",
            fileName: "20251025_161120",
          },
          isVisible: true,
        },
      ];

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      // Mock the vault.create to throw ENAMETOOLONG on first call, succeed on second
      let createCallCount = 0;
      mockApp.vault.create.mockImplementation((path: string, content: string) => {
        createCallCount++;
        if (createCallCount === 1) {
          // First call: throw ENAMETOOLONG error (simulating the original filename being too long)
          const error = new Error(
            "ENAMETOOLONG: name too long, open '/home/user/vault/copilot/copilot-conversations/1)_используй_словарь_уже_установленных_терминов_Словарь_перевода_Songs_of@20251025_161120.md'"
          );
          return Promise.reject(error);
        } else {
          // Second call: succeed with fallback filename
          return Promise.resolve({
            path,
            basename: path.split("/").pop(),
          } as TFile);
        }
      });

      await persistenceManager.saveChat("gpt-4");

      // Verify that vault.create was called twice (once failed, once succeeded)
      expect(mockApp.vault.create).toHaveBeenCalledTimes(2);

      // First call should have used the preferred (long) filename
      const firstCallPath = mockApp.vault.create.mock.calls[0][0] as string;
      expect(firstCallPath).toContain("используй_словарь");

      // Second call should have used the minimal fallback filename
      const secondCallPath = mockApp.vault.create.mock.calls[1][0] as string;
      expect(secondCallPath).toBe("test-folder/chat-1729873880000.md");

      // Verify the fallback filename is very short (should be under 30 bytes)
      const fallbackBasename = secondCallPath.split("/").pop() || "";
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(fallbackBasename).length;
      expect(byteLength).toBeLessThan(30);

      // Verify a warning was logged about using minimal filename
      expect(jest.mocked(Notice)).toHaveBeenCalledWith(
        expect.stringContaining("chat-1729873880000.md")
      );
    });

    it("should include project prefix in fallback filename for project chats", async () => {
      const cyrillicMessage =
        "1) используй словарь уже установленных терминов Словарь перевода Songs of Syx";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: cyrillicMessage,
          sender: USER_SENDER,
          timestamp: {
            epoch: 1729873880000,
            display: "2025/10/25 16:11:20",
            fileName: "20251025_161120",
          },
          isVisible: true,
        },
      ];

      // Mock getCurrentProject to return a project
      const getCurrentProject = jest.requireMock("@/aiParams").getCurrentProject;
      getCurrentProject.mockReturnValue({ id: "songs-of-syx", name: "Songs of Syx Translation" });

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      // Mock the vault.create to throw ENAMETOOLONG on first call, succeed on second
      let createCallCount = 0;
      mockApp.vault.create.mockImplementation((path: string) => {
        createCallCount++;
        if (createCallCount === 1) {
          const error = new Error("ENAMETOOLONG: name too long");
          return Promise.reject(error);
        } else {
          return Promise.resolve({
            path,
            basename: path.split("/").pop(),
          } as TFile);
        }
      });

      await persistenceManager.saveChat("gpt-4");

      // Second call should have project prefix in fallback filename
      const secondCallPath = mockApp.vault.create.mock.calls[1][0] as string;
      expect(secondCallPath).toBe("test-folder/songs-of-syx__chat-1729873880000.md");

      // Verify basename starts with project prefix (so getChatHistoryFiles will find it)
      const basename = secondCallPath.split("/").pop() || "";
      expect(basename).toMatch(/^songs-of-syx__/);

      // Reset mock
      getCurrentProject.mockReturnValue(null);
    });

    it("should handle repeated saves with fallback filename (conflict handling)", async () => {
      const cyrillicMessage =
        "1) используй словарь уже установленных терминов Словарь перевода Songs of Syx";

      const messages: ChatMessage[] = [
        {
          id: "1",
          message: cyrillicMessage,
          sender: USER_SENDER,
          timestamp: {
            epoch: 1729873880000,
            display: "2025/10/25 16:11:20",
            fileName: "20251025_161120",
          },
          isVisible: true,
        },
      ];

      const existingFallbackFile = Object.create(TFile.prototype);
      Object.assign(existingFallbackFile, {
        path: "test-folder/chat-1729873880000.md",
        basename: "chat-1729873880000",
      });

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "test-folder/chat-1729873880000.md") {
          return existingFallbackFile;
        }
        return null;
      });

      // Mock the vault.create to throw errors on both calls
      mockApp.vault.create.mockImplementation((path: string) => {
        if (path.includes("используй")) {
          // First call: ENAMETOOLONG
          return Promise.reject(new Error("ENAMETOOLONG: name too long"));
        } else {
          // Second call (fallback): File already exists
          return Promise.reject(new Error("File already exists"));
        }
      });

      await persistenceManager.saveChat("gpt-4");

      // Verify that vault.modify was called to update the existing fallback file
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        existingFallbackFile,
        expect.stringContaining("используй словарь")
      );

      // Verify the correct notices were shown
      expect(jest.mocked(Notice)).toHaveBeenCalledWith(
        "Existing chat note found - updating it now."
      );
    });

    it("should update existing file when epoch is stored as a string", async () => {
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

      const existingFile = {
        path: "test-folder/Hello@20240923_221800.md",
      } as unknown as TFile;

      const getFilesSpy = jest
        .spyOn(persistenceManager, "getChatHistoryFiles")
        .mockResolvedValue([existingFile]);

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { epoch: "1695513480000" },
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(existingFile);

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        existingFile,
        expect.stringContaining("**user**: Hello")
      );
      expect(mockApp.vault.create).not.toHaveBeenCalled();

      getFilesSpy.mockRestore();
    });

    it("should locate existing file by path when epoch frontmatter is missing", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Hello again",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      const existingFile = Object.create(TFile.prototype);
      Object.assign(existingFile, {
        path: "test-folder/Hello_again@20240923_221800.md",
        basename: "Hello_again@20240923_221800",
      });

      const getFilesSpy = jest
        .spyOn(persistenceManager, "getChatHistoryFiles")
        .mockResolvedValue([]);

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);

      // Mock vault.create to throw "already exists" error
      mockApp.vault.create.mockRejectedValue(new Error("File already exists"));

      // Mock getAbstractFileByPath to return existing file when called from catch block
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "test-folder/Hello_again@20240923_221800.md") {
          return existingFile;
        }
        return null;
      });
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { topic: "Existing Topic" },
      });

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        existingFile,
        expect.stringContaining("**user**: Hello again")
      );
      expect(mockApp.vault.create).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith("Existing chat note found - updating it now.");

      getFilesSpy.mockRestore();
    });

    it("should resolve create conflicts by updating the existing file", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Conflict message",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      const existingFile = Object.create(TFile.prototype);
      Object.assign(existingFile, {
        path: "test-folder/Conflict_message@20240923_221800.md",
        basename: "Conflict_message@20240923_221800",
      });

      const getFilesSpy = jest
        .spyOn(persistenceManager, "getChatHistoryFiles")
        .mockResolvedValue([]);

      // Mock getAbstractFileByPath to return existing file when called from catch block
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "test-folder/Conflict_message@20240923_221800.md") {
          return existingFile;
        }
        return null;
      });

      mockApp.vault.create.mockRejectedValue(new Error("File already exists"));
      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { topic: "Existing Conflict Topic" },
      });

      await persistenceManager.saveChat("gpt-4");

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        existingFile,
        expect.stringContaining("**user**: Conflict message")
      );
      expect(mockApp.vault.create).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith("Existing chat note found - updating it now.");

      getFilesSpy.mockRestore();
    });
  });

  describe("hidden directory support", () => {
    it("should save via adapter when file exists on disk but not in vault cache", async () => {
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

      const getFilesSpy = jest
        .spyOn(persistenceManager, "getChatHistoryFiles")
        .mockResolvedValue([]);

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);

      // findFileByEpoch returns null, but file exists on disk (hidden dir)
      mockApp.vault.adapter.exists.mockResolvedValue(true);

      await persistenceManager.saveChat("gpt-4");

      // Should write via adapter, not vault.create
      expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(
        expect.stringContaining("test-folder/"),
        expect.stringContaining("**user**: Hello")
      );
      expect(mockApp.vault.create).not.toHaveBeenCalled();

      getFilesSpy.mockRestore();
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

    it("should preserve context information through save and load cycle", async () => {
      // Create mock TFile for the note - must use Object.create to pass instanceof check
      const mockTFile = Object.create(TFile.prototype);
      mockTFile.basename = "typescript-guide.md";
      mockTFile.path = "docs/typescript-guide.md";
      mockTFile.extension = "md";
      mockTFile.name = "typescript-guide.md";

      // Mock vault to return the file when resolving by path
      mockApp.vault.getAbstractFileByPath = jest.fn().mockImplementation((path: string) => {
        return path === "docs/typescript-guide.md" ? mockTFile : null;
      });

      // Recreate persistence manager with the updated mock
      const testPersistenceManager = new ChatPersistenceManager(mockApp, mockMessageRepo);

      const originalMessages: ChatMessage[] = [
        {
          id: "1",
          message: "What are the files about TypeScript?",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
          context: {
            notes: [mockTFile],
            urls: ["https://typescriptlang.org"],
            tags: ["programming", "typescript"],
            folders: ["docs/"],
          },
        },
        {
          id: "2",
          message: "Here's what I found about TypeScript in your files...",
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
      const formattedContent = (testPersistenceManager as any).formatChatContent(originalMessages);

      // Verify the formatted content contains the full path (not just basename)
      expect(formattedContent).toContain("docs/typescript-guide.md");

      // Add frontmatter
      const fullContent = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

${formattedContent}`;

      // Parse it back
      const parsedMessages = (testPersistenceManager as any).parseChatContent(fullContent);

      // Verify the messages match
      expect(parsedMessages).toHaveLength(2);
      expect(parsedMessages[0].message).toBe(originalMessages[0].message);
      expect(parsedMessages[0].sender).toBe(originalMessages[0].sender);

      // Verify context is preserved
      expect(parsedMessages[0].context).toBeDefined();
      expect(parsedMessages[0].context.notes).toHaveLength(1);
      expect(parsedMessages[0].context.notes[0].basename).toBe("typescript-guide.md");
      expect(parsedMessages[0].context.notes[0].path).toBe("docs/typescript-guide.md");
      expect(parsedMessages[0].context.urls).toEqual(["https://typescriptlang.org"]);
      expect(parsedMessages[0].context.tags).toEqual(["programming", "typescript"]);
      expect(parsedMessages[0].context.folders).toHaveLength(1);
      expect(parsedMessages[0].context.folders[0]).toBe("docs/");

      // Second message should not have context
      expect(parsedMessages[1].context).toBeUndefined();
    });

    it("should resolve legacy basename-only context (backward compatibility)", async () => {
      // Create mock TFile for the note
      const mockTFile = {
        basename: "typescript-guide.md",
        path: "docs/typescript-guide.md",
        extension: "md",
        name: "typescript-guide.md",
      } as TFile;

      // Mock vault to return the file for basename resolution (legacy format)
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null); // Path lookup fails
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockTFile]); // Basename lookup succeeds

      // Old format: just basename, no path
      const content = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

**user**: What are the files about TypeScript?
[Context: Notes: typescript-guide.md]
[Timestamp: 2024/09/23 22:18:00]

**ai**: Here's what I found about TypeScript in your files...
[Timestamp: 2024/09/23 22:18:01]`;

      const parsedMessages = (persistenceManager as any).parseChatContent(content);

      expect(parsedMessages).toHaveLength(2);
      expect(parsedMessages[0].context).toBeDefined();
      expect(parsedMessages[0].context.notes).toHaveLength(1);
      expect(parsedMessages[0].context.notes[0].basename).toBe("typescript-guide.md");
      expect(parsedMessages[0].context.notes[0].path).toBe("docs/typescript-guide.md");
    });

    it("should handle ambiguous basename resolution gracefully", async () => {
      // Create two mock TFiles with the same basename
      const mockTFile1 = {
        basename: "typescript-guide.md",
        path: "docs/typescript-guide.md",
        extension: "md",
        name: "typescript-guide.md",
      } as TFile;

      const mockTFile2 = {
        basename: "typescript-guide.md",
        path: "archive/typescript-guide.md",
        extension: "md",
        name: "typescript-guide.md",
      } as TFile;

      // Mock vault to return multiple files with same basename
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockTFile1, mockTFile2]);

      // Old format: basename matches multiple files, but has other context items
      const content = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

**user**: What are the files about TypeScript?
[Context: Notes: typescript-guide.md | URLs: https://typescriptlang.org]
[Timestamp: 2024/09/23 22:18:00]`;

      const parsedMessages = (persistenceManager as any).parseChatContent(content);

      // Should skip ambiguous note (logs warning) but preserve other context
      expect(parsedMessages).toHaveLength(1);
      expect(parsedMessages[0].context).toBeDefined();
      expect(parsedMessages[0].context.notes).toHaveLength(0); // Skipped due to ambiguity
      expect(parsedMessages[0].context.urls).toEqual(["https://typescriptlang.org"]); // Other context preserved
    });

    it("should handle deleted notes gracefully", async () => {
      // Mock vault to return null (file not found)
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.getMarkdownFiles.mockReturnValue([]); // No files match basename

      // Note path that doesn't exist, but has other context items
      const content = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

**user**: What are the files about TypeScript?
[Context: Notes: docs/deleted-file.md | Tags: typescript, programming]
[Timestamp: 2024/09/23 22:18:00]`;

      const parsedMessages = (persistenceManager as any).parseChatContent(content);

      // Should skip missing note (logs warning) but preserve other context
      expect(parsedMessages).toHaveLength(1);
      expect(parsedMessages[0].context).toBeDefined();
      expect(parsedMessages[0].context.notes).toHaveLength(0); // Skipped - not found
      expect(parsedMessages[0].context.tags).toEqual(["typescript", "programming"]); // Other context preserved
    });

    it("should handle messages without context (backward compatibility)", async () => {
      const content = `---
epoch: 1695513480000
modelKey: gpt-4
tags:
  - copilot-conversation
---

**user**: Hello without context
[Timestamp: 2024/09/23 22:18:00]

**ai**: Hi there!
[Timestamp: 2024/09/23 22:18:01]`;

      const parsedMessages = (persistenceManager as any).parseChatContent(content);

      expect(parsedMessages).toHaveLength(2);
      expect(parsedMessages[0].context).toBeUndefined();
      expect(parsedMessages[1].context).toBeUndefined();
    });
  });

  describe("modelKey escaping in frontmatter", () => {
    it("should properly escape modelKey with special YAML characters", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      // Test with user-defined display name containing special characters
      await persistenceManager.saveChat("[芥兰]Gemini-2.5-pro|3rd party");

      const savedContent = mockApp.vault.create.mock.calls[0][1];
      expect(savedContent).toContain('modelKey: "[芥兰]Gemini-2.5-pro|3rd party"');
    });

    it("should properly escape modelKey with slashes", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("x-ai/grok-4-fast");

      const savedContent = mockApp.vault.create.mock.calls[0][1];
      expect(savedContent).toContain('modelKey: "x-ai/grok-4-fast"');
    });

    it("should properly escape modelKey with pipe characters", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("copilot-plus-flash|copilot-plus");

      const savedContent = mockApp.vault.create.mock.calls[0][1];
      expect(savedContent).toContain('modelKey: "copilot-plus-flash|copilot-plus"');
    });

    it("should properly escape modelKey with embedded quotes", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat('model"with"quotes|provider');

      const savedContent = mockApp.vault.create.mock.calls[0][1];
      expect(savedContent).toContain('modelKey: "model\\"with\\"quotes|provider"');
    });

    it("should properly escape modelKey with embedded backslashes", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);

      await persistenceManager.saveChat("model\\with\\backslash|provider");

      const savedContent = mockApp.vault.create.mock.calls[0][1];
      expect(savedContent).toContain('modelKey: "model\\\\with\\\\backslash|provider"');
    });

    it("should preserve modelKey through save-load round trip with special characters", async () => {
      const testModelKey = "[芥兰]Gemini-2.5-pro|3rd party";
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      // Generate the note content
      const chatContent = (persistenceManager as any).formatChatContent(messages);
      const noteContent = (persistenceManager as any).generateNoteContent(
        chatContent,
        messages[0].timestamp!.epoch,
        testModelKey
      );

      // Verify the content contains properly quoted modelKey
      expect(noteContent).toContain(`modelKey: "${testModelKey}"`);

      // Parse the content back and check frontmatter
      const lines = noteContent.split("\n");
      const modelKeyLine = lines.find((line: string) => line.startsWith("modelKey:"));
      expect(modelKeyLine).toBe(`modelKey: "${testModelKey}"`);
    });

    it("should preserve modelKey with quotes through save-load round trip", async () => {
      const testModelKey = 'model"with"quotes|provider';
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      // Generate the note content
      const chatContent = (persistenceManager as any).formatChatContent(messages);
      const noteContent = (persistenceManager as any).generateNoteContent(
        chatContent,
        messages[0].timestamp!.epoch,
        testModelKey
      );

      // Verify the content contains properly escaped quotes
      expect(noteContent).toContain('modelKey: "model\\"with\\"quotes|provider"');

      // Parse the content back and check frontmatter
      const lines = noteContent.split("\n");
      const modelKeyLine = lines.find((line: string) => line.startsWith("modelKey:"));
      expect(modelKeyLine).toBe('modelKey: "model\\"with\\"quotes|provider"');
    });

    it("should preserve modelKey with backslashes through save-load round trip", async () => {
      const testModelKey = "model\\with\\backslash|provider";
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Test message",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      // Generate the note content
      const chatContent = (persistenceManager as any).formatChatContent(messages);
      const noteContent = (persistenceManager as any).generateNoteContent(
        chatContent,
        messages[0].timestamp!.epoch,
        testModelKey
      );

      // Verify the content contains properly escaped backslashes
      expect(noteContent).toContain('modelKey: "model\\\\with\\\\backslash|provider"');

      // Parse the content back and check frontmatter
      const lines = noteContent.split("\n");
      const modelKeyLine = lines.find((line: string) => line.startsWith("modelKey:"));
      expect(modelKeyLine).toBe('modelKey: "model\\\\with\\\\backslash|provider"');
    });
  });

  describe("lastAccessedAt preservation", () => {
    it("should preserve lastAccessedAt when updating existing file", async () => {
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

      const existingFile = {
        path: "test-folder/Hello@20240923_221800.md",
      } as unknown as TFile;

      const getFilesSpy = jest
        .spyOn(persistenceManager, "getChatHistoryFiles")
        .mockResolvedValue([existingFile]);

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          epoch: 1695513480000,
          topic: "Existing Topic",
          lastAccessedAt: 1700000000000, // Existing lastAccessedAt
        },
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(existingFile);

      await persistenceManager.saveChat("gpt-4");

      // Verify that modify was called with content containing lastAccessedAt
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        existingFile,
        expect.stringContaining("lastAccessedAt: 1700000000000")
      );

      getFilesSpy.mockRestore();
    });

    it("should not include lastAccessedAt when it does not exist", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "New chat",
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(true);
      mockApp.vault.create.mockResolvedValue({
        path: "test-folder/New_chat@20240923_221800.md",
      } as TFile);

      await persistenceManager.saveChat("gpt-4");

      // Verify that create was called with content NOT containing lastAccessedAt
      const createCall = mockApp.vault.create.mock.calls[0];
      const content = createCall[1] as string;
      expect(content).not.toContain("lastAccessedAt:");
    });

    it("should preserve lastAccessedAt during conflict resolution", async () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          message: "Conflict test",
          sender: USER_SENDER,
          timestamp: {
            epoch: 1695513480000,
            display: "2024/09/23 22:18:00",
            fileName: "2024_09_23_221800",
          },
          isVisible: true,
        },
      ];

      const existingFile = Object.create(TFile.prototype);
      Object.assign(existingFile, {
        path: "test-folder/Conflict_test@20240923_221800.md",
        basename: "Conflict_test@20240923_221800",
      });

      const getFilesSpy = jest
        .spyOn(persistenceManager, "getChatHistoryFiles")
        .mockResolvedValue([]);

      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      mockApp.vault.create.mockRejectedValue(new Error("File already exists"));
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "test-folder/Conflict_test@20240923_221800.md") {
          return existingFile;
        }
        return null;
      });
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          topic: "Conflict Topic",
          lastAccessedAt: 1700000000000,
        },
      });

      await persistenceManager.saveChat("gpt-4");

      // Verify that modify was called with content containing lastAccessedAt
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        existingFile,
        expect.stringContaining("lastAccessedAt: 1700000000000")
      );

      getFilesSpy.mockRestore();
    });
  });
});
