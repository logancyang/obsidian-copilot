import type ChainManager from "@/LLMProviders/chainManager";
import { ChatMessage } from "@/types/message";
import { App, Notice, TFile } from "obsidian";
import type { MessageRepository } from "./MessageRepository";
import { ChatPersistenceManager } from "./ChatPersistenceManager";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import { getSettings } from "@/settings/model";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { ensureFolderExists } from "@/utils";
import { AI_SENDER, USER_SENDER } from "@/constants";

jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
  Notice: jest.fn(),
  TFile: jest.fn(),
  TFolder: jest.fn(),
  parseYaml: (content: string): unknown =>
    jest.requireActual<typeof import("yaml")>("yaml").parse(content),
}));
jest.mock("@/logger");
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({
    defaultSaveFolder: "test-folder",
    defaultConversationTag: "copilot-conversation",
    defaultConversationNoteName: "{$topic}@{$date}_{$time}",
  }),
}));
jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveConversationsFolder: jest.fn(() => "test-folder"),
  deriveConversationAttachmentsFolder: jest.fn((folder: string) => `${folder}/attachments`),
}));
jest.mock("@/aiParams", () => ({}));
jest.mock("@/utils", () => ({
  ...jest.requireActual<typeof import("@/utils")>("@/utils"),
  formatDateTime: jest.fn(() => ({
    fileName: "20240923_221800",
    display: "2024/09/23 22:18:00",
  })),
  ensureFolderExists: jest.fn(async () => {}),
}));

type MockApp = {
  vault: {
    getAbstractFileByPath: jest.Mock;
    createFolder: jest.Mock;
    createBinary: jest.Mock;
    getConfig: jest.Mock;
    create: jest.Mock;
    modify: jest.Mock;
    process: jest.Mock;
    read: jest.Mock;
    getMarkdownFiles: jest.Mock;
    adapter: {
      exists: jest.Mock;
      read: jest.Mock;
      readBinary: jest.Mock;
      mkdir: jest.Mock;
      write: jest.Mock;
      list: jest.Mock;
      stat: jest.Mock;
    };
  };
  metadataCache: { getFileCache: jest.Mock };
  fileManager: { processFrontMatter: jest.Mock; renameFile: jest.Mock };
};

type MockMessageRepo = { getDisplayMessages: jest.Mock };

const FIRST_EPOCH = 1695513480000;
const FIRST_TIMESTAMP = {
  epoch: FIRST_EPOCH,
  display: "2024/09/23 22:18:00",
  fileName: "2024_09_23_221800",
};
const EXISTING_NOTE_TOPIC_PATH = "test-folder/Conflict_message@20240923_221800.md";

function chatMessage(
  message: string,
  sender: string = USER_SENDER,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return { id: "1", message, sender, timestamp: FIRST_TIMESTAMP, isVisible: true, ...overrides };
}

function savedFrontmatter(content: string): string {
  return content.slice(0, content.indexOf("\n---\n", 4));
}

const noteWithBody = (body: string) =>
  `---\nepoch: ${FIRST_EPOCH}\nmodelKey: gpt-4\ntags:\n  - copilot-conversation\n---\n\n${body}`;

describe("ChatPersistenceManager", () => {
  describe("ChatPersistenceManager", () => {
    let mockApp: MockApp;
    let mockMessageRepo: MockMessageRepo;
    let persistenceManager: ChatPersistenceManager;

    const createdPath = (callIndex = 0) => mockApp.vault.create.mock.calls[callIndex][0] as string;
    const createdContent = (callIndex = 0) =>
      mockApp.vault.create.mock.calls[callIndex][1] as string;
    const basenameBytes = (path: string) =>
      new TextEncoder().encode(path.split("/").pop() ?? "").length;

    const saveMessages = (messages: ChatMessage[], modelKey = "gpt-4") => {
      mockMessageRepo.getDisplayMessages.mockReturnValue(messages);
      return persistenceManager.saveChat(modelKey);
    };

    const loadNote = (content: string) => {
      mockApp.vault.read.mockResolvedValue(content);
      return persistenceManager.loadChat(mockTFile({ path: "chat.md" }));
    };

    beforeEach(() => {
      jest.clearAllMocks();

      mockApp = {
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(null),
          createFolder: jest.fn(),
          createBinary: jest.fn(),
          getConfig: jest.fn(() => "attachments"),
          create: jest.fn(),
          modify: jest.fn(),
          process: jest.fn(async (file: TFile, update: (content: string) => string) => {
            const current = (await mockApp.vault.adapter.read(file.path)) as string | undefined;
            const next = update(current ?? "");
            await mockApp.vault.modify(file, next);
            return next;
          }),
          read: jest.fn(),
          getMarkdownFiles: jest.fn().mockReturnValue([]),
          adapter: {
            exists: jest.fn().mockResolvedValue(false),
            read: jest.fn().mockResolvedValue(""),
            readBinary: jest.fn(),
            mkdir: jest.fn(),
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
          renameFile: jest.fn(),
        },
      };

      mockMessageRepo = {
        getDisplayMessages: jest.fn(),
      };

      persistenceManager = new ChatPersistenceManager(
        mockApp as unknown as App,
        mockMessageRepo as unknown as MessageRepository
      );
    });

    describe("saveChat()", () => {
      it("creates a note named after the first user message that transcribes every message with its timestamp", async () => {
        const saved = await saveMessages([
          chatMessage("my name is logan, what's your name"),
          chatMessage("I don't have a name. I am a large language model.", AI_SENDER, {
            timestamp: { ...FIRST_TIMESTAMP, display: "2024/09/23 22:18:01" },
          }),
          chatMessage("what's my name", USER_SENDER, {
            timestamp: { ...FIRST_TIMESTAMP, display: "2024/09/23 22:56:20" },
          }),
        ]);

        expect(saved?.path).toBe(
          "test-folder/my_name_is_logan,_what's_your_name@20240923_221800.md"
        );
        const content = createdContent();
        expect(savedFrontmatter(content)).toContain(`epoch: ${FIRST_EPOCH}`);
        expect(savedFrontmatter(content)).toContain('modelKey: "gpt-4"');
        expect(savedFrontmatter(content)).toContain("tags:\n  - copilot-conversation");
        expect(savedFrontmatter(content)).not.toContain("topic:");
        expect(savedFrontmatter(content)).not.toContain("lastAccessedAt:");
        expect(
          content.endsWith(
            `**user**: my name is logan, what's your name
[Timestamp: 2024/09/23 22:18:00]

**ai**: I don't have a name. I am a large language model.
[Timestamp: 2024/09/23 22:18:01]

**user**: what's my name
[Timestamp: 2024/09/23 22:56:20]`
          )
        ).toBe(true);
      });

      it("writes Unknown time for messages without a timestamp", async () => {
        await saveMessages([chatMessage("Hello", USER_SENDER, { timestamp: null })]);

        expect(createdContent()).toContain("**user**: Hello\n[Timestamp: Unknown time]");
      });

      it("does not write a note and shows a notice when there are no messages", async () => {
        await saveMessages([]);

        expect(mockApp.vault.create).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("No messages to save.");
      });

      it("returns the live created file so its renamed path remains observable https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
        const file = mockTFile({ path: "chat/Saved.md" });
        mockApp.vault.create.mockResolvedValue(file);

        const saved = await saveMessages([chatMessage("Hello")]);

        expect(saved).toBe(file);
        file.path = "archive/Saved.md";
        expect(saved?.path).toBe(file.path);
      });

      it("returns no source when a write fails https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
        mockApp.vault.create.mockRejectedValue(new Error("write failed"));

        expect(await saveMessages([chatMessage("Hello")])).toBeNull();
        expect(Notice).toHaveBeenCalledWith(
          "Failed to save chat as note. Check console for details."
        );
      });

      it("writes under the folder captured at entry, not one a mid-save root change swaps in", async () => {
        jest.mocked(getEffectiveConversationsFolder).mockReturnValueOnce("old-folder");

        await saveMessages([chatMessage("Hello")]);

        expect(createdPath().startsWith("old-folder/")).toBe(true);
        expect(ensureFolderExists).toHaveBeenCalledWith(expect.anything(), "old-folder");
      });

      it("strips wiki link brackets and illegal characters from the filename", async () => {
        await saveMessages([chatMessage("Check [[My Note]] and path [ref] :: test \\\u0000")]);

        expect(createdPath()).toBe(
          "test-folder/Check_My_Note_and_path_ref_test@20240923_221800.md"
        );
      });

      it("names the note Untitled Chat when the first message sanitizes to nothing", async () => {
        await saveMessages([chatMessage("[[]] [] {} :: :: \\")]);

        expect(createdPath()).toBe("test-folder/Untitled_Chat@20240923_221800.md");
      });

      it.each([
        [
          "ASCII",
          "This is a very long message that contains many many words and should be truncated to fit within the filesystem byte limit to prevent ENAMETOOLONG errors",
        ],
        [
          "Cyrillic",
          "используй словарь уже установленных терминов Словарь перевода Songs of Syx придерживайся правил перевода Правила перевода Songs of Syx сделай перевод для слова",
        ],
        ["emoji", "🚀 Launch the rocket 🌟 to the stars ✨ with amazing features 🎉🎊🎈"],
        [
          "mixed CJK, Cyrillic and Arabic",
          "你好世界 こんにちは世界 안녕하세요 세계 Hello World Привет мир مرحبا بالعالم",
        ],
      ])("keeps a %s filename within 100 bytes", async (_script, text) => {
        await saveMessages([chatMessage(text)]);

        expect(basenameBytes(createdPath())).toBeLessThanOrEqual(100);
        expect(createdPath().endsWith("@20240923_221800.md")).toBe(true);
      });

      it("falls back to a minimal chat-epoch filename when the filesystem rejects the name as too long", async () => {
        mockApp.vault.create
          .mockRejectedValueOnce(new Error("ENAMETOOLONG: name too long, open '/vault/x.md'"))
          .mockImplementationOnce(async (path: string) => mockTFile({ path }));

        await saveMessages([chatMessage("1) используй словарь уже установленных терминов")]);

        expect(mockApp.vault.create).toHaveBeenCalledTimes(2);
        expect(createdPath(0)).toContain("используй_словарь");
        expect(createdPath(1)).toBe(`test-folder/chat-${FIRST_EPOCH}.md`);
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining(`chat-${FIRST_EPOCH}.md`));
      });

      it("updates the existing minimal-name note when a repeated save hits both the long-name limit and an existing fallback file", async () => {
        const fallbackPath = `test-folder/chat-${FIRST_EPOCH}.md`;
        const existingFallbackFile = mockTFile({
          path: fallbackPath,
          basename: `chat-${FIRST_EPOCH}`,
        });
        mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
          path === fallbackPath ? existingFallbackFile : null
        );
        mockApp.vault.create.mockImplementation(async (path: string) => {
          throw new Error(
            path.includes("используй") ? "ENAMETOOLONG: name too long" : "File already exists"
          );
        });

        const saved = await saveMessages([chatMessage("1) используй словарь уже установленных")]);

        expect(saved).toBe(existingFallbackFile);
        expect(mockApp.vault.modify).toHaveBeenCalledWith(
          existingFallbackFile,
          expect.stringContaining("используй словарь")
        );
        expect(Notice).toHaveBeenCalledWith("Existing chat note found - updating it now.");
      });

      it("updates the note whose frontmatter epoch matches the first message, even when the epoch is stored as a string", async () => {
        const existingFile = mockTFile({ path: "test-folder/Hello@20240923_221800.md" });
        jest.spyOn(persistenceManager, "getChatHistoryFiles").mockResolvedValue([existingFile]);
        mockApp.metadataCache.getFileCache.mockReturnValue({
          frontmatter: { epoch: String(FIRST_EPOCH) },
        });
        mockApp.vault.getAbstractFileByPath.mockReturnValue(existingFile);

        await saveMessages([chatMessage("Hello")]);

        expect(mockApp.vault.modify).toHaveBeenCalledWith(
          existingFile,
          expect.stringContaining("**user**: Hello")
        );
        expect(mockApp.vault.create).not.toHaveBeenCalled();
      });

      it("keeps the existing note's lastAccessedAt and topic when updating it", async () => {
        const existingFile = mockTFile({ path: "test-folder/Hello@20240923_221800.md" });
        jest.spyOn(persistenceManager, "getChatHistoryFiles").mockResolvedValue([existingFile]);
        mockApp.metadataCache.getFileCache.mockReturnValue({
          frontmatter: {
            epoch: FIRST_EPOCH,
            topic: "Existing Topic",
            lastAccessedAt: 1700000000000,
          },
        });
        mockApp.vault.getAbstractFileByPath.mockReturnValue(existingFile);

        await saveMessages([chatMessage("Hello")]);

        const updated = mockApp.vault.modify.mock.calls[0][1] as string;
        expect(updated).toContain("lastAccessedAt: 1700000000000");
        expect(updated).toContain('topic: "Existing Topic"');
      });

      it("resolves a create conflict by updating the existing note and keeping its topic and lastAccessedAt", async () => {
        const existingFile = mockTFile({
          path: EXISTING_NOTE_TOPIC_PATH,
          basename: "Conflict_message@20240923_221800",
        });
        mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
          path === EXISTING_NOTE_TOPIC_PATH ? existingFile : null
        );
        mockApp.vault.create.mockRejectedValue(new Error("File already exists"));
        mockApp.metadataCache.getFileCache.mockReturnValue({
          frontmatter: { topic: "Existing Conflict Topic", lastAccessedAt: 1700000000000 },
        });

        await saveMessages([chatMessage("Conflict message")]);

        expect(mockApp.vault.create).toHaveBeenCalledTimes(1);
        const updated = mockApp.vault.modify.mock.calls[0][1] as string;
        expect(mockApp.vault.modify.mock.calls[0][0]).toBe(existingFile);
        expect(updated).toContain("**user**: Conflict message");
        expect(updated).toContain("lastAccessedAt: 1700000000000");
        expect(updated).toContain('topic: "Existing Conflict Topic"');
        expect(Notice).toHaveBeenCalledWith("Existing chat note found - updating it now.");
      });

      it("writes through the adapter when the note exists on disk but not in the vault cache", async () => {
        jest.spyOn(persistenceManager, "getChatHistoryFiles").mockResolvedValue([]);
        mockApp.vault.adapter.exists.mockResolvedValue(true);

        const saved = await saveMessages([chatMessage("Hello")]);

        expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(
          expect.stringContaining("test-folder/"),
          expect.stringContaining("**user**: Hello")
        );
        expect(saved?.path).toBe(mockApp.vault.adapter.write.mock.calls[0][0]);
        expect(mockApp.vault.create).not.toHaveBeenCalled();
      });

      it.each([
        [
          "special characters",
          "[芥兰]Gemini-2.5-pro|3rd party",
          '"[芥兰]Gemini-2.5-pro|3rd party"',
        ],
        ["slashes", "x-ai/grok-4-fast", '"x-ai/grok-4-fast"'],
        ["pipes", "copilot-plus-flash|copilot-plus", '"copilot-plus-flash|copilot-plus"'],
        ["embedded quotes", 'model"with"quotes|provider', '"model\\"with\\"quotes|provider"'],
        [
          "embedded backslashes",
          "model\\with\\backslash|provider",
          '"model\\\\with\\\\backslash|provider"',
        ],
      ])("writes a modelKey with %s as a quoted YAML string", async (_kind, modelKey, yaml) => {
        await saveMessages([chatMessage("Test message")], modelKey);

        expect(createdContent()).toContain(`modelKey: ${yaml}`);
      });

      it("writes the built-in conversation tag regardless of the persisted defaultConversationTag", async () => {
        (getSettings as jest.Mock).mockReturnValue({
          defaultSaveFolder: "test-folder",
          defaultConversationTag: "user-custom-tag",
          defaultConversationNoteName: "{$topic}@{$date}_{$time}",
        });

        await saveMessages([chatMessage("hi")]);

        expect(createdContent()).toContain("tags:\n  - copilot-conversation");
        expect(createdContent()).not.toContain("user-custom-tag");
      });

      it("applies an AI-generated topic from a structured model response to the note frontmatter", async () => {
        const invoke = jest.fn().mockResolvedValue({
          content: [
            { type: "text", text: "Forecast Insights" },
            { type: "tool_call", id: "ignored", name: "analysis" },
          ],
        });
        const chainManager = {
          chatModelManager: { getChatModel: jest.fn().mockReturnValue({ invoke }) },
        } as unknown as ChainManager;
        persistenceManager = new ChatPersistenceManager(
          mockApp as unknown as App,
          mockMessageRepo as unknown as MessageRepository,
          chainManager
        );
        const mockFile = mockTFile({
          path: "test-folder/Summarize_weather_data@20240923_221800.md",
        });
        mockApp.vault.create.mockResolvedValue(mockFile);
        mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
        const frontmatterState: Record<string, unknown> = {};
        mockApp.fileManager.processFrontMatter.mockImplementation(
          async (_file: TFile, updater: (frontmatter: Record<string, unknown>) => void) => {
            updater(frontmatterState);
          }
        );

        await saveMessages([
          chatMessage("Summarize weather data"),
          chatMessage("Here is the summary...", AI_SENDER, { id: "2" }),
        ]);

        expect(savedFrontmatter(createdContent())).not.toContain("topic:");
        for (let i = 0; i < 12; i++) {
          await Promise.resolve();
        }
        expect(invoke).toHaveBeenCalled();
        expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
          mockFile,
          expect.any(Function)
        );
        expect(frontmatterState.topic).toBe("Forecast Insights");
      });

      it("preserves host links after reopening a saved upload and a legacy transcript (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
        const file = mockTFile({ path: "test-folder/existing.md" });
        const message: ChatMessage = chatMessage("image", USER_SENDER, {
          id: "image",
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
        });
        let disk = "";
        mockApp.vault.create.mockImplementation(async (_path: string, content: string) => {
          disk = content;
          return file;
        });
        await saveMessages([message]);
        const original = disk;
        jest.spyOn(persistenceManager, "getChatHistoryFiles").mockResolvedValue([file]);
        mockApp.metadataCache.getFileCache.mockReturnValue({
          frontmatter: { epoch: message.timestamp!.epoch },
        });
        mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
        mockApp.vault.adapter.exists.mockResolvedValue(true);
        mockApp.vault.adapter.read.mockImplementation(async () => disk);
        mockApp.vault.read.mockImplementation(async () => disk);
        mockApp.vault.modify.mockImplementation(async (_file: TFile, content: string) => {
          disk = content;
        });
        for (const legacy of [false, true]) {
          disk = legacy
            ? original
                .replace(/<!-- copilot-image:[\w-]+ -->\n/g, "")
                .replace(/\n<!-- \/copilot-image -->/g, "")
            : original.replace(/\n/g, "\r\n");
          const loaded = await persistenceManager.loadChat(file);
          expect(loaded[0].message).not.toContain("copilot-image:");
          expect(loaded[0].timestamp?.epoch).toBe(message.timestamp!.epoch);
          if (legacy) file.path = "test-folder/renamed-chat.md";
          else loaded[0].message = loaded[0].message.replace("image", "edited text");
          disk = disk.replace(/!\[\]\([^)]+\)/, "![[moved.png]]");
          mockMessageRepo.getDisplayMessages.mockReturnValue(loaded);
          await persistenceManager.saveChat("gpt-4");
          expect(disk).toContain("![[moved.png]]");
          await persistenceManager.saveChat("gpt-4");
          expect(disk).toContain("![[moved.png]]");
          if (legacy) {
            loaded[0].message = loaded[0].message.replace(/!\[\]\([^)]+\)/, "![[intentional.png]]");
            await persistenceManager.saveChat("gpt-4");
            expect(disk).toContain("![[intentional.png]]");
            disk = disk.replace("intentional.png", "organized-edit.png");
            await persistenceManager.saveChat("gpt-4");
            await persistenceManager.saveChat("gpt-4");
            expect(disk).toContain("![[organized-edit.png]]");
          }
        }
        expect(mockApp.vault.createBinary).toHaveBeenCalledTimes(1);
      });

      it("saves uploaded images with their message before context and timestamp metadata (https://github.com/logancyang/obsidian-copilot/issues/2900)", async () => {
        const message = chatMessage("Look at this", USER_SENDER, {
          id: "image",
          context: { notes: [], urls: ["https://example.com"] },
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
        });
        mockApp.vault.createBinary.mockImplementation(async () => {
          expect(mockApp.vault.create).not.toHaveBeenCalled();
        });

        await saveMessages([message]);

        const imagePath = mockApp.vault.createBinary.mock.calls[0][0] as string;
        expect(createdContent()).toContain(
          `![](/${imagePath})\n<!-- /copilot-image -->\n[Context: URLs: https://example.com]\n[Timestamp:`
        );
        expect(message.message).toBe("Look at this");
        const [reloaded] = await loadNote(createdContent());
        expect(reloaded.message).toContain(`![](/${imagePath})`);
      });

      it("preserves an existing transcript when an uploaded image cannot be saved (https://github.com/logancyang/obsidian-copilot/issues/2900)", async () => {
        const existingFile = mockTFile({ path: "test-folder/existing.md" });
        jest.spyOn(persistenceManager, "getChatHistoryFiles").mockResolvedValue([existingFile]);
        mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: { epoch: FIRST_EPOCH } });
        mockApp.vault.getAbstractFileByPath.mockReturnValue(existingFile);
        mockApp.vault.createBinary.mockRejectedValueOnce(new Error("disk full"));

        await saveMessages([
          chatMessage("New image", USER_SENDER, {
            id: "image",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
          }),
        ]);

        expect(mockApp.vault.modify).not.toHaveBeenCalled();
        expect(mockApp.vault.create).not.toHaveBeenCalled();
        expect(mockApp.vault.adapter.write).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
          "Failed to save chat as note. Check console for details."
        );
      });
    });

    describe("loadChat()", () => {
      it("parses user and AI messages with their display timestamps, including consecutive user messages", async () => {
        const messages = await loadNote(
          noteWithBody(`**user**: my name is logan, what's your name
[Timestamp: 2024/09/23 22:18:00]

**ai**: I don't have a name.
[Timestamp: 2024/09/23 22:18:01]

**user**: what is your creator
[Timestamp: 2024/09/23 22:39:27]

**user**: what's my name
[Timestamp: 2024/09/23 22:56:20]`)
        );

        expect(messages.map((m) => [m.sender, m.message])).toEqual([
          [USER_SENDER, "my name is logan, what's your name"],
          [AI_SENDER, "I don't have a name."],
          [USER_SENDER, "what is your creator"],
          [USER_SENDER, "what's my name"],
        ]);
        expect(messages[0]).toMatchObject({
          isVisible: true,
          timestamp: { display: "2024/09/23 22:18:00" },
        });
      });

      it("keeps the line breaks of a multi-line AI message", async () => {
        const messages = await loadNote(
          noteWithBody(`**user**: Can you write a haiku?
[Timestamp: 2024/09/23 22:18:00]

**ai**: Here's a haiku for you:

Autumn leaves falling
Gentle breeze whispers secrets
Nature's quiet song
[Timestamp: 2024/09/23 22:18:01]`)
        );

        expect(messages[1].message).toBe(`Here's a haiku for you:

Autumn leaves falling
Gentle breeze whispers secrets
Nature's quiet song`);
      });

      it("loads messages marked Unknown time with a null timestamp", async () => {
        const messages = await loadNote(
          `**user**: Hello\n[Timestamp: Unknown time]\n\n**ai**: Hi there!\n[Timestamp: Unknown time]`
        );

        expect(messages.map((m) => m.timestamp)).toEqual([null, null]);
      });

      it("restores the contexts written by saveChat: notes, URLs, tags, folders and web tabs", async () => {
        const noteFile = mockTFile({
          basename: "typescript-guide.md",
          path: "docs/typescript-guide.md",
          extension: "md",
          name: "typescript-guide.md",
        });
        mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
          path === "docs/typescript-guide.md" ? noteFile : null
        );
        await saveMessages([
          chatMessage("What are the files about TypeScript?", USER_SENDER, {
            context: {
              notes: [noteFile],
              urls: ["https://typescriptlang.org"],
              tags: ["programming", "typescript"],
              folders: ["docs/"],
              webTabs: [
                { url: "https://example.com/", title: "Example Domain", isLoaded: true },
                { url: "https://lucide.dev/", title: "Lucide", isActive: true },
              ],
            },
          }),
          chatMessage("Here's what I found...", AI_SENDER),
        ]);

        const reloaded = await loadNote(createdContent());

        expect(reloaded[0].context).toEqual({
          notes: [noteFile],
          urls: ["https://typescriptlang.org"],
          tags: ["programming", "typescript"],
          folders: ["docs/"],
          webTabs: [{ url: "https://example.com/" }, { url: "https://lucide.dev/" }],
        });
        expect(reloaded[1].context).toBeUndefined();
      });

      it("resolves a legacy basename-only note reference to the single matching vault note", async () => {
        const file = mockTFile({
          basename: "typescript-guide.md",
          path: "docs/typescript-guide.md",
          extension: "md",
          name: "typescript-guide.md",
        });
        mockApp.vault.getMarkdownFiles.mockReturnValue([file]);

        const messages = await loadNote(
          noteWithBody(
            "**user**: What are the files about TypeScript?\n[Context: Notes: typescript-guide.md]\n[Timestamp: 2024/09/23 22:18:00]"
          )
        );

        expect(messages[0].context?.notes).toEqual([file]);
      });

      it("skips a basename-only note reference that matches several vault notes but keeps the rest of the context", async () => {
        mockApp.vault.getMarkdownFiles.mockReturnValue([
          mockTFile({ basename: "typescript-guide.md", path: "docs/typescript-guide.md" }),
          mockTFile({ basename: "typescript-guide.md", path: "archive/typescript-guide.md" }),
        ]);

        const messages = await loadNote(
          noteWithBody(
            "**user**: What are the files about TypeScript?\n[Context: Notes: typescript-guide.md | URLs: https://typescriptlang.org]\n[Timestamp: 2024/09/23 22:18:00]"
          )
        );

        expect(messages[0].context?.notes).toEqual([]);
        expect(messages[0].context?.urls).toEqual(["https://typescriptlang.org"]);
      });

      it("drops a referenced note that no longer exists but keeps the rest of the context", async () => {
        const messages = await loadNote(
          noteWithBody(
            "**user**: What are the files about TypeScript?\n[Context: Notes: docs/deleted-file.md | Tags: typescript, programming]\n[Timestamp: 2024/09/23 22:18:00]"
          )
        );

        expect(messages[0].context?.notes).toEqual([]);
        expect(messages[0].context?.tags).toEqual(["typescript", "programming"]);
      });

      it("loads messages without a context line as having no context", async () => {
        const messages = await loadNote(
          noteWithBody(
            "**user**: Hello without context\n[Timestamp: 2024/09/23 22:18:00]\n\n**ai**: Hi there!\n[Timestamp: 2024/09/23 22:18:01]"
          )
        );

        expect(messages.map((m) => m.context)).toEqual([undefined, undefined]);
      });

      it("reads through the adapter when the vault cannot read the file", async () => {
        mockApp.vault.read.mockRejectedValue(new Error("not cached"));
        mockApp.vault.adapter.read.mockResolvedValue("**user**: Hello\n[Timestamp: Unknown time]");

        const messages = await persistenceManager.loadChat(mockTFile({ path: "hidden/chat.md" }));

        expect(messages.map((m) => m.message)).toEqual(["Hello"]);
      });

      it("returns no messages and shows a notice when the file cannot be read", async () => {
        mockApp.vault.read.mockRejectedValue(new Error("not cached"));
        mockApp.vault.adapter.read.mockRejectedValue(new Error("missing"));

        expect(await persistenceManager.loadChat(mockTFile({ path: "gone.md" }))).toEqual([]);
        expect(Notice).toHaveBeenCalledWith(
          "Failed to load chat history. Check console for details."
        );
      });

      it("keeps appended turns in the topic-renamed note after reload for https://github.com/logancyang/obsidian-copilot/issues/2886", async () => {
        const display = "2024/09/23 22:18:00";
        const epoch = new Date(display).getTime() + 865;
        const firstMessage = chatMessage("testing1", USER_SENDER, {
          id: undefined,
          timestamp: { epoch, display, fileName: "20240923_221800" },
        });
        const file = mockTFile({ path: "test-folder/Generated_topic@20240923_221800.md" });
        let savedContent = "";
        mockApp.vault.create.mockImplementation(async (_path: string, content: string) => {
          savedContent = content;
          return file;
        });
        mockApp.vault.read.mockImplementation(async () => savedContent);
        mockApp.vault.modify.mockImplementation(async (_file: TFile, content: string) => {
          savedContent = content;
        });
        await saveMessages([firstMessage]);
        expect(mockApp.vault.create).toHaveBeenCalledTimes(1);

        mockApp.vault.getMarkdownFiles.mockReturnValue([file]);
        const folder = mockTFolder({ path: "test-folder" });
        mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
          path === file.path ? file : path === folder.path ? folder : null
        );
        mockApp.metadataCache.getFileCache.mockReturnValue({
          frontmatter: { epoch, topic: "Generated topic" },
        });
        const loaded = await persistenceManager.loadChat(file);
        const appended = {
          ...firstMessage,
          message: "testing3",
          timestamp: { ...firstMessage.timestamp!, epoch: epoch + 3000 },
        };
        await saveMessages([...loaded, appended]);

        expect(mockApp.vault.create).toHaveBeenCalledTimes(1);
        expect(mockApp.vault.modify).toHaveBeenCalledWith(
          file,
          expect.stringContaining("**user**: testing3")
        );
        expect(loaded[0].timestamp).toMatchObject({ epoch, display });
        expect(savedContent).toContain(`epoch: ${epoch}`);
        expect((await persistenceManager.loadChat(file)).map((message) => message.message)).toEqual(
          ["testing1", "testing3"]
        );
      });

      it.each(["1788916607865", '"1788916607865"'])(
        "restores numeric or quoted identity %s only on the first message for https://github.com/logancyang/obsidian-copilot/issues/2886",
        async (epoch) => {
          const messages = await loadNote(
            `---\nepoch: ${epoch}\n---\n\n**user**: testing1\n[Timestamp: 2026/09/08 18:16:47]\n\n**ai**: OK\n[Timestamp: 2026/09/08 18:16:48]`
          );

          expect(messages[0].timestamp).toMatchObject({
            epoch: 1788916607865,
            display: "2026/09/08 18:16:47",
          });
          expect(messages[1].timestamp?.epoch).toBe(new Date("2026/09/08 18:16:48").getTime());
        }
      );

      it.each([
        "",
        "---\ntopic: Legacy\n---\n",
        "---\nepoch: nope\n---\n",
        "---\nepoch: .inf\n---\n",
        "---\nepoch: true\n---\n",
        "---\nepoch: 0\n---\n",
        "---\nepoch: -1\n---\n",
        "---\nepoch: [broken\n---\n",
      ])(
        "loads legacy message timestamps when identity is absent or invalid (%s) for https://github.com/logancyang/obsidian-copilot/issues/2886",
        async (frontmatter) => {
          const display = "2024/09/23 22:18:00";

          const messages = await loadNote(
            `${frontmatter}\n**user**: Hello\n[Timestamp: ${display}]`
          );

          expect(messages[0].timestamp).toMatchObject({
            epoch: new Date(display).getTime(),
            display,
          });
        }
      );

      it("restores identity even without a display timestamp for https://github.com/logancyang/obsidian-copilot/issues/2886", async () => {
        const messages = await loadNote("---\nepoch: 1788916607865\n---\n**user**: Hello");

        expect(messages[0].timestamp).toMatchObject({
          epoch: 1788916607865,
          display: "Unknown time",
        });
      });
    });

    describe("getChatHistoryFiles()", () => {
      it("lists the markdown files of a folder and leaves out chats that belong to a project", async () => {
        const folder = mockTFolder({ path: "test-folder" });
        const plainChat = mockTFile({ path: "test-folder/plain.md", basename: "plain" });
        const projectChat = mockTFile({
          path: "test-folder/project-chat.md",
          basename: "project-chat",
        });
        mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
          path === "test-folder" ? folder : null
        );
        mockApp.vault.getMarkdownFiles.mockReturnValue([plainChat, projectChat]);
        mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => ({
          frontmatter: file === projectChat ? { projectId: "project-1" } : {},
        }));

        expect(await persistenceManager.getChatHistoryFiles("test-folder")).toEqual([plainChat]);
      });
    });

    describe("renameFileToMatchTopic()", () => {
      beforeEach(() => {
        mockMessageRepo.getDisplayMessages.mockReturnValue([]);
        jest
          .mocked(getEffectiveConversationsFolder)
          .mockReturnValue("live-root/copilot-conversations");
      });

      it("renames the note to a name built from the topic and its epoch", async () => {
        const file = mockTFile({ path: "test-folder/chat.md" });
        mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: { epoch: FIRST_EPOCH } });

        await persistenceManager.renameFileToMatchTopic(file, "New Topic");

        expect(mockApp.fileManager.renameFile).toHaveBeenCalledWith(
          file,
          "test-folder/New_Topic@20240923_221800.md"
        );
      });

      it("does not rename a note that has no epoch", async () => {
        const file = mockTFile({ path: "test-folder/chat.md" });
        mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

        await persistenceManager.renameFileToMatchTopic(file, "New Topic");

        expect(mockApp.fileManager.renameFile).not.toHaveBeenCalled();
      });

      it("keeps a nested chat in its own folder, ignoring the live root", async () => {
        const file = mockTFile({ path: "old-root/copilot-conversations/chat.md" });
        mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: { epoch: FIRST_EPOCH } });

        await persistenceManager.renameFileToMatchTopic(file, "New Topic");

        const newPath = mockApp.fileManager.renameFile.mock.calls[0][1] as string;
        expect(newPath.startsWith("old-root/copilot-conversations/")).toBe(true);
        expect(newPath).not.toContain("live-root");
      });

      it("does not produce a leading slash when renaming a vault-root file", async () => {
        const file = mockTFile({ path: "chat.md" });
        mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: { epoch: FIRST_EPOCH } });

        await persistenceManager.renameFileToMatchTopic(file, "New Topic");

        const newPath = mockApp.fileManager.renameFile.mock.calls[0][1] as string;
        expect(newPath.startsWith("/")).toBe(false);
      });
    });
  });
});
