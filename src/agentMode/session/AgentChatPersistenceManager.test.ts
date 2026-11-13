/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import { AI_SENDER, USER_SENDER } from "@/constants";
import { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage } from "./types";
import { buildConversationHistoryBlock, SAVED_HISTORY_MAX_CHARS } from "./conversationHistory";
import type { MessageContext } from "@/types/message";
import { TFile } from "obsidian";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { App } from "obsidian";
import { getSettings } from "@/settings/model";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";

jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
  Notice: jest.fn(),
  TFile: jest.fn(),
}));
jest.mock("@/logger");
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({
    defaultSaveFolder: "test-folder",
    defaultConversationTag: "copilot-conversation",
    defaultConversationNoteName: "{$date}_{$time}__{$topic}",
  }),
}));
jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveConversationsFolder: jest.fn(() => "test-folder"),
  deriveConversationAttachmentsFolder: jest.fn((folder: string) => `${folder}/attachments`),
}));
jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(async () => {}),
  formatDateTime: jest.fn(() => ({
    fileName: "20260101_120000",
    display: "2026/01/01 12:00:00",
  })),
  getUtf8ByteLength: jest.fn((s: string) => new TextEncoder().encode(s).length),
  truncateToByteLimit: jest.fn((s: string, n: number) => {
    const bytes = new TextEncoder().encode(s);
    if (bytes.length <= n) return s;
    return new TextDecoder().decode(bytes.slice(0, n));
  }),
}));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  isFileAlreadyExistsError: jest.requireActual("@/utils/vaultAdapterUtils")
    .isFileAlreadyExistsError,
  listMarkdownFiles: jest.fn().mockReturnValue([]),
  patchFrontmatter: jest.requireActual("@/utils/vaultAdapterUtils").patchFrontmatter,
}));

interface FakeFile {
  path: string;
  basename: string;
  contents?: string;
}

function makeApp() {
  const files = new Map<string, FakeFile>();
  const cacheListeners = new Set<(file: FakeFile) => void>();
  return {
    files,
    vault: {
      createBinary: jest.fn(async (path: string, bytes: ArrayBuffer) => ({ path })),
      getConfig: jest.fn(() => "attachments"),
      createFolder: jest.fn(),
      getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
      create: jest.fn(async (path: string, content: string) => {
        if (files.has(path)) throw new Error("File already exists.");
        const basename = path.split("/").pop()!.replace(/\.md$/, "");
        const file: FakeFile = Object.assign(Object.create(TFile.prototype), {
          path,
          basename,
          contents: content,
        });
        files.set(path, file);
        return file;
      }),
      process: jest.fn(async (file: FakeFile, update: (content: string) => string) => {
        file.contents = update(file.contents ?? "");
        return file.contents;
      }),
      modify: jest.fn(async (file: FakeFile, content: string) => {
        file.contents = content;
      }),
      read: jest.fn(async (file: FakeFile) => file.contents ?? ""),
      delete: jest.fn(async (file: FakeFile) => {
        files.delete(file.path);
      }),
      adapter: {
        list: jest.fn(async () => ({ files: [], folders: [] })),
        readBinary: jest.fn(),
        mkdir: jest.fn(),
        exists: jest.fn(async (path: string) => files.has(path)),
        read: jest.fn(async (path: string) => files.get(path)?.contents ?? ""),
        write: jest.fn(async (path: string, content: string) => {
          const existing = files.get(path);
          if (existing) {
            existing.contents = content;
          } else {
            const basename = path.split("/").pop()!.replace(/\.md$/, "");
            files.set(path, { path, basename, contents: content });
          }
        }),
        remove: jest.fn(async (path: string) => {
          files.delete(path);
        }),
      },
    },
    metadataCache: {
      getFileCache: jest.fn((_file: FakeFile): unknown => undefined),
      listeners: cacheListeners,
      on: (_name: "changed", listener: (file: FakeFile) => void) => {
        cacheListeners.add(listener);
        return listener;
      },
      offref: (ref: (file: FakeFile) => void) => cacheListeners.delete(ref),
      trigger: (_name: "changed", file: FakeFile) => {
        for (const listener of Array.from(cacheListeners)) listener(file);
      },
    },
    fileManager: {
      processFrontMatter: jest.fn(
        async (file: FakeFile, update: (frontmatter: Record<string, unknown>) => void) => {
          const contents = file.contents ?? "";
          const match = /^---\n([\s\S]*?)\n---\n/.exec(contents);
          const frontmatter = (match ? parseYaml(match[1]) : {}) as Record<string, unknown>;
          update(frontmatter);
          const body = match ? contents.slice(match[0].length) : contents;
          file.contents = `---\n${stringifyYaml(frontmatter)}---\n${body}`;
        }
      ),
    },
  };
}

const CONTEXT_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/920";

function addNote(app: ReturnType<typeof makeApp>, path: string): TFile {
  const basename = path.split("/").pop()!.replace(/\.md$/, "");
  const file = Object.assign(Object.create(TFile.prototype), { path, basename });
  app.files.set(path, file);
  return file;
}

function makeMessage(sender: string, message: string, epoch = 1735732800000): AgentChatMessage {
  return {
    id: `msg-${epoch}`,
    sender,
    message,
    isVisible: true,
    timestamp: { epoch, display: "2026/01/01 12:00:00", fileName: "20260101_120000" },
  };
}

describe("AgentChatPersistenceManager", () => {
  let app: ReturnType<typeof makeApp>;
  let manager: AgentChatPersistenceManager;

  beforeEach(() => {
    app = makeApp();
    manager = new AgentChatPersistenceManager(app as unknown as App);
  });

  describe("saveSession()", () => {
    it("preserves organizer links after native rehydration, reopening and later deletion (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const message = {
        ...makeMessage(USER_SENDER, "image"),
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
      };
      const saved = await manager.saveSession([message], "claude");
      const file = app.files.get(saved!.path)!;
      Object.setPrototypeOf(file, TFile.prototype);
      file.contents = file.contents!.replace(/!\[\]\([^)]+\)/, "![[organized.png]]");
      const resumed = new AgentChatPersistenceManager(app as unknown as App);
      await resumed.saveSession([JSON.parse(JSON.stringify(message))], "claude", {
        existingPath: saved!.path,
      });
      expect(file.contents).toContain("![[organized.png]]");
      file.contents = file.contents.replace(/\n/g, "\r\n");
      const loaded = await resumed.loadFile(file as unknown as TFile);
      expect(loaded.messages[0].message).not.toContain("copilot-image:");
      file.contents = file.contents.replace("organized.png", "renamed.png");
      loaded.messages[0].message = loaded.messages[0].message.replace("image", "edited text");
      await resumed.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toContain("![[renamed.png]]");
      await resumed.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toContain("![[renamed.png]]");
      expect(file.contents).toContain("edited text");
      expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it("preserves host moves of reopened legacy links while accepting intentional embed edits (https://github.com/Brevilabs/obsidian-copilot-private/issues/533)", async () => {
      const saved = await manager.saveSession(
        [makeMessage(USER_SENDER, "image\n\n![[old.png]]")],
        "claude"
      );
      const file = app.files.get(saved!.path)!;
      Object.setPrototypeOf(file, TFile.prototype);
      const loaded = await manager.loadFile(file as unknown as TFile);
      app.files.delete(file.path);
      file.path = "copilot-conversations/renamed-legacy.md";
      app.files.set(file.path, file);
      saved!.path = file.path;
      file.contents = file.contents!.replace("old.png", "moved.png");
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toContain("![[moved.png]]");
      loaded.messages[0].message = loaded.messages[0].message.replace("old.png", "intentional.png");
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toContain("![[intentional.png]]");
      file.contents = file.contents.replace("intentional.png", "organized-edit.png");
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toContain("![[organized-edit.png]]");
      expect(app.vault.createBinary).not.toHaveBeenCalled();
    });

    it("saves uploaded image embeds beside the user message and preserves them on reload (https://github.com/logancyang/obsidian-copilot/issues/2900)", async () => {
      const message = {
        ...makeMessage(USER_SENDER, "Look at this"),
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
      };
      app.vault.createBinary.mockImplementation(async (path) => {
        expect(app.vault.create).not.toHaveBeenCalled();
        return { path };
      });
      const saved = await manager.saveSession(
        [message, makeMessage(AI_SENDER, "An image")],
        "claude"
      );
      const imagePath = app.vault.createBinary.mock.calls[0][0];
      const file = app.files.get(saved!.path)!;
      expect(file.contents).toContain(`![](/${imagePath})`);
      expect(file.contents).toContain("**ai**: An image");
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[0].message).toContain(`![](/${imagePath})`);
      expect(message.message).toBe("Look at this");
    });

    it("preserves the existing transcript and reports failure when an image write fails (https://github.com/logancyang/obsidian-copilot/issues/2900)", async () => {
      const messages = [makeMessage(USER_SENDER, "Original")];
      const original = await manager.saveSession(messages, "claude");
      const content = app.files.get(original!.path)!.contents;
      app.vault.createBinary.mockRejectedValueOnce(new Error("disk full"));
      const result = await manager.saveSession(
        [
          {
            ...messages[0],
            message: "Image",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
          },
        ],
        "claude",
        { existingPath: original!.path }
      );
      expect(result).toBeNull();
      expect(app.files.get(original!.path)!.contents).toBe(content);
      expect(app.vault.modify).not.toHaveBeenCalled();
      expect(app.vault.adapter.write).not.toHaveBeenCalled();
    });

    it("round-trips messages, backendId, and label", async () => {
      const messages = [makeMessage(USER_SENDER, "hello world"), makeMessage(AI_SENDER, "hi back")];
      const saved = await manager.saveSession(messages, "claude", { label: "My chat" });
      expect(saved).not.toBeNull();

      const file = app.files.get(saved!.path)!;
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.backendId).toBe("claude");
      expect(loaded.label).toBe("My chat");
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].sender).toBe(USER_SENDER);
      expect(loaded.messages[0].message).toBe("hello world");
      expect(loaded.messages[1].sender).toBe(AI_SENDER);
      expect(loaded.messages[1].message).toBe("hi back");
    });

    it("saves a reply that starts with a code fence so the note renders it and it loads back unchanged (https://github.com/Brevilabs/obsidian-copilot-private/issues/889)", async () => {
      const reply = "```mermaid\nflowchart LR\n  A --> B\n```\n\nThat is the flow.";
      const saved = await manager.saveSession(
        [makeMessage(USER_SENDER, "Draw it"), makeMessage(AI_SENDER, reply)],
        "claude"
      );

      const file = app.files.get(saved!.path)!;
      expect(file.contents).toContain("**ai**: \n\n```mermaid\n");
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages.map((m) => m.message)).toEqual(["Draw it", reply]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/815 writes the chat title to the note's topic, the one title the chat lists read", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        label: "My chat",
      });

      const contents = app.files.get(saved!.path)!.contents!;
      expect(contents).toContain('topic: "My chat"\n');
      expect(contents).not.toContain("agentLabel");
    });

    it("writes under the folder captured at entry, not one a mid-save root change swaps in", async () => {
      const folderMock = jest.mocked(getEffectiveConversationsFolder);
      folderMock.mockReturnValueOnce("old-folder");

      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {});

      expect(saved).not.toBeNull();
      expect(saved!.path.startsWith("old-folder/")).toBe(true);
      expect(saved!.path).not.toContain("test-folder");
    });

    it("writes the built-in conversation tag independent of the persisted setting", async () => {
      (getSettings as jest.Mock).mockReturnValueOnce({
        defaultSaveFolder: "test-folder",
        defaultConversationTag: "user-custom-tag",
        defaultConversationNoteName: "{$date}_{$time}__{$topic}",
      });
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {});
      const contents = app.files.get(saved!.path)!.contents!;
      expect(contents).toContain("tags:\n  - copilot-conversation");
      expect(contents).not.toContain("user-custom-tag");
    });

    it("serializes a mid-stream fan-out turn so an interrupted autosave isn't blank", async () => {
      const fanoutMsg: AgentChatMessage = {
        id: "msg-2",
        sender: AI_SENDER,
        message: "",
        isVisible: true,
        timestamp: { epoch: 2, display: "2026/01/01 12:00:00", fileName: "20260101_120000" },
        fanout: {
          answers: {
            opencode: { backendId: "opencode", status: "running", text: "partial opencode answer" },
          },
          summary: { status: "streaming", text: "" },
        },
      };
      const saved = await manager.saveSession(
        [makeMessage(USER_SENDER, "q"), fanoutMsg],
        "claude",
        {}
      );
      const file = app.files.get(saved!.path)!;
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[1].message).toContain("partial opencode answer");
    });

    it("escapes and round-trips a label containing quotes and backslashes", async () => {
      const tricky = 'has "quotes" and \\backslashes\\';
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "opencode", { label: tricky });
      expect(saved).not.toBeNull();
      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.label).toBe(tricky);
    });

    it("strips control characters from labels so they can't break frontmatter", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "opencode", {
        label: "first\nsecond\rthird",
      });
      const raw = app.files.get(saved!.path)!.contents!;
      const labelLines = raw.split("\n").filter((l) => l.startsWith("topic:"));
      expect(labelLines).toHaveLength(1);
      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.label).toBe("first second third");
    });

    it("returns null when given zero messages instead of writing an empty file", async () => {
      const result = await manager.saveSession([], "opencode");
      expect(result).toBeNull();
      expect(app.files.size).toBe(0);
    });

    it("round-trips a real projectId for a project-scoped chat", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "claude", { projectId: "proj-123" });
      expect(saved).not.toBeNull();

      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain('projectId: "proj-123"');

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe("proj-123");
    });

    it.each([
      ["omitted", undefined],
      ["GLOBAL_SCOPE", GLOBAL_SCOPE],
      ["blank", "   "],
    ])(
      "writes no projectId frontmatter and loads as GLOBAL_SCOPE when projectId is %s",
      async (_label, projectId) => {
        const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
          projectId,
        });
        const raw = app.files.get(saved!.path)!.contents!;
        expect(raw).not.toContain("projectId:");

        const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
        expect(loaded.projectId).toBe(GLOBAL_SCOPE);
      }
    );

    it("normalizes a padded projectId option before writing frontmatter", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "claude", { projectId: " proj-123 " });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain('projectId: "proj-123"');
      expect(raw).not.toContain('projectId: " proj-123 "');

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe("proj-123");
    });

    it("round-trips a SessionUsage snapshot through save/load", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const usage = {
        usedTokens: 42_000,
        contextWindow: 200_000,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5000,
        cacheWriteTokens: 300,
        updatedAt: 1_700_000_000_000,
      };
      const saved = await manager.saveSession(messages, "claude", { usage });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain(`usage: '${JSON.stringify(usage)}'`);

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.usage).toEqual(usage);
    });

    it("round-trips the persisted usage when a later save omits it", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const usage = { usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 };
      const first = await manager.saveSession(messages, "claude", { usage });
      Object.setPrototypeOf(app.files.get(first!.path)!, TFile.prototype);
      const second = await manager.saveSession(messages, "claude", {
        existingPath: first!.path,
      });
      const loaded = await manager.loadFile(app.files.get(second!.path) as unknown as TFile);
      expect(loaded.usage).toEqual(usage);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 round-trips how many leading messages the agent got as history and the model the chat runs, and keeps both when a save omits them", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const model = { baseModelId: "sonnet", effort: "high" };
      const first = await manager.saveSession(messages, "claude", { carriedMessages: 4, model });
      Object.setPrototypeOf(app.files.get(first!.path)!, TFile.prototype);
      const saved = await manager.loadFile(app.files.get(first!.path) as unknown as TFile);

      await manager.saveSession(messages, "claude", { existingPath: first!.path });
      const kept = await manager.loadFile(app.files.get(first!.path) as unknown as TFile);

      expect([saved.carriedMessages, saved.model]).toEqual([4, model]);
      expect([kept.carriedMessages, kept.model]).toEqual([4, model]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 round-trips the notes of the chats a chat continues, and keeps them through saves that omit them or move the chat to another agent and model", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const continuedFrom = ["chats/first.md", 'chats/the "second", chat.md'];
      const first = await manager.saveSession(messages, "claude", { continuedFrom });
      Object.setPrototypeOf(app.files.get(first!.path)!, TFile.prototype);
      const saved = await manager.loadFile(app.files.get(first!.path) as unknown as TFile);

      await manager.saveSession(messages, "claude", { existingPath: first!.path });
      await manager.saveSession(messages, "opencode", {
        existingPath: first!.path,
        model: { baseModelId: "opencode/beam-free", effort: null },
      });
      const kept = await manager.loadFile(app.files.get(first!.path) as unknown as TFile);
      const plain = await manager.saveSession([makeMessage(USER_SENDER, "other", 1)], "claude");
      Object.setPrototypeOf(app.files.get(plain!.path)!, TFile.prototype);
      const ordinary = await manager.loadFile(app.files.get(plain!.path) as unknown as TFile);

      expect(saved.continuedFrom).toEqual(continuedFrom);
      expect([kept.backendId, kept.continuedFrom]).toEqual(["opencode", continuedFrom]);
      expect(ordinary.continuedFrom).toBeUndefined();
    });

    it("leaves usage undefined for a chat saved without it", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).not.toContain("usage:");
      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.usage).toBeUndefined();
    });

    it("keeps an existing note's epoch when a later save's first message carries a different time, so chat links keep working (https://github.com/Brevilabs/obsidian-copilot-private/issues/744)", async () => {
      const first = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi", 1792522547700)],
        "claude"
      );
      const note = app.files.get(first!.path)!;
      Object.setPrototypeOf(note, TFile.prototype);

      await manager.saveSession(
        [makeMessage(USER_SENDER, "hi", 1792522549569), makeMessage(AI_SENDER, "hello")],
        "claude",
        { existingPath: first!.path }
      );

      expect(note.contents).toContain("epoch: 1792522547700\n");
      expect(note.contents).not.toContain("1792522549569");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/698 keeps frontmatter properties it does not manage when it saves an existing chat again", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        sessionId: "s1",
      });
      const note = app.files.get(first!.path)!;
      Object.setPrototypeOf(note, TFile.prototype);
      note.contents = note.contents!.replace(
        "backendId: claude\n",
        'backendId: claude\ntopic: "Renamed"\nstatus: done\n'
      );

      await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "hello")],
        "claude",
        { existingPath: first!.path, usage: { usedTokens: 5, updatedAt: 1 } }
      );

      expect(note.contents).toContain(
        'backendId: claude\ntopic: "Renamed"\nstatus: done\nsessionId: "s1"\n'
      );
      expect(note.contents).toContain('usage: \'{"usedTokens":5,"updatedAt":1}\'');
      expect(note.contents).toContain("**ai**: hello");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/698 keeps a property written to the note even when the metadata cache still holds its older value", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      const note = app.files.get(first!.path)!;
      Object.setPrototypeOf(note, TFile.prototype);
      note.contents = note.contents!.replace("tags:", 'topic: "New"\ntags:');
      app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { topic: "Old" },
      });

      await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        existingPath: first!.path,
      });

      expect(note.contents).toContain('topic: "New"\n');
      expect(note.contents).not.toContain("Old");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/698 drops the projectId of a project chat that is saved again as a global chat", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        projectId: "proj-123",
      });

      await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        existingPath: first!.path,
        projectId: GLOBAL_SCOPE,
      });

      expect(app.files.get(first!.path)!.contents).not.toContain("projectId:");
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 saves a new chat whose note name another chat's note already has to a numbered note, leaving that note as it was", async () => {
      const topicOnly = {
        defaultSaveFolder: "test-folder",
        defaultConversationTag: "copilot-conversation",
        defaultConversationNoteName: "{$topic}",
      };
      (getSettings as jest.Mock)
        .mockReturnValueOnce(topicOnly)
        .mockReturnValueOnce(topicOnly)
        .mockReturnValueOnce(topicOnly);
      const first = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "a later reply", 1735732900000)],
        "claude",
        { sessionId: "old-session", label: "Old agent" }
      );
      const original = app.files.get(first!.path)!.contents;

      const second = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi", 1735733000000)],
        "claude",
        { sessionId: "new-session" }
      );
      const third = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi", 1735733100000)],
        "claude"
      );

      expect([first!.path, second!.path, third!.path]).toEqual([
        "test-folder/agent__hi.md",
        "test-folder/agent__hi 1.md",
        "test-folder/agent__hi 2.md",
      ]);
      expect(app.files.get(first!.path)!.contents).toBe(original);
      const contents = app.files.get(second!.path)!.contents!;
      expect(contents).toContain('sessionId: "new-session"\n');
      expect(contents).not.toContain("old-session");
      expect(contents).not.toContain("Old agent");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 fails a new chat's save instead of writing over a note another chat takes between the name check and the write, and saves it to a numbered note next time", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      const original = app.files.get(first!.path)!.contents;
      const second = [makeMessage(USER_SENDER, "hi", 1735733000000)];
      app.vault.adapter.exists.mockResolvedValueOnce(false);

      const raced = await manager.saveSession(second, "claude");
      const retried = await manager.saveSession(second, "claude");

      expect(raced).toBeNull();
      expect(app.files.get(first!.path)!.contents).toBe(original);
      expect(retried!.path).toBe("test-folder/agent__20260101_120000__hi 1.md");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 names a new note after the first message's text, never the image embed a chat opened from its note keeps in that text", async () => {
      const embed = `![[copilot-image-${"c".repeat(64)}.png]]`;

      const saved = await manager.saveSession(
        [makeMessage(USER_SENDER, `What is this?\n\n${embed}`)],
        "claude"
      );

      expect(saved!.path).toBe("test-folder/agent__20260101_120000__What_is_this.md");
    });

    it("rewrites a chat's own note that Obsidian does not index, as in a hidden folder, instead of saving a numbered copy", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      const hidden = app.files.get(first!.path)!;
      app.vault.getAbstractFileByPath.mockImplementation(() => null);

      const again = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "hello")],
        "claude",
        { existingPath: first!.path }
      );

      expect(again!.path).toBe(first!.path);
      expect(app.files.size).toBe(1);
      expect(hidden.contents).toContain("**ai**: hello");
    });
  });

  describe("updateTopic()", () => {
    it("writes the trimmed title to the note's topic once Obsidian holds it", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { topic: "Quarterly plan" } });

      await manager.updateTopic(saved!.path, "  Quarterly plan  ");

      expect(app.files.get(saved!.path)!.contents).toContain("topic: Quarterly plan\n");
    });

    it("waits for Obsidian to re-read the renamed note so Recent Chats lists the new title https://github.com/logancyang/obsidian-copilot/issues/3555", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      const file = app.files.get(saved!.path)!;
      let cachedTopic = "Old title";
      let reportStaleRead!: () => void;
      const staleRead = new Promise<string>((resolve) => {
        reportStaleRead = () => resolve("read the stale cache");
      });
      app.metadataCache.getFileCache.mockImplementation(() => {
        if (cachedTopic === "Old title") reportStaleRead();
        return { frontmatter: { topic: cachedTopic } };
      });

      const renaming = manager.updateTopic(saved!.path, "New title");
      const first = await Promise.race([staleRead, renaming.then(() => "resolved early")]);
      cachedTopic = "New title";
      app.metadataCache.trigger("changed", file);
      await renaming;

      expect(first).toBe("read the stale cache");
      expect(app.metadataCache.listeners.size).toBe(0);
    });
  });

  describe("setPinnedAt()", () => {
    it("pins a chat by writing the pin time to its note's frontmatter", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");

      await manager.setPinnedAt(saved!.path, 1_760_000_000_000);

      expect(app.files.get(saved!.path)!.contents).toContain("pinnedAt: 1760000000000\n");
    });

    it("unpins a chat by removing the pinnedAt key from its note's frontmatter", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      await manager.setPinnedAt(saved!.path, 1_760_000_000_000);

      await manager.setPinnedAt(saved!.path, null);

      expect(app.files.get(saved!.path)!.contents).not.toContain("pinnedAt");
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 rejects pinning a note that was moved or deleted so the row is not shown pinned", async () => {
      await expect(
        manager.setPinnedAt("test-folder/agent__gone.md", 1_760_000_000_000)
      ).rejects.toThrow("test-folder/agent__gone.md");
      expect(app.files.has("test-folder/agent__gone.md")).toBe(false);
    });

    it("keeps a chat's pin through later autosaves", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      await manager.setPinnedAt(saved!.path, 1_760_000_000_000);

      await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "hi again")],
        "claude",
        { existingPath: saved!.path }
      );

      expect(app.files.get(saved!.path)!.contents).toContain("pinnedAt: 1760000000000\n");
    });
  });

  describe("setArchivedAt()", () => {
    it("archives a chat by writing the archive time to its note's frontmatter", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");

      await manager.setArchivedAt(saved!.path, 1_760_000_000_000);

      expect(app.files.get(saved!.path)!.contents).toContain("archivedAt: 1760000000000\n");
    });

    it("changes nothing in the note except the archive field", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      const before = app.files.get(saved!.path)!.contents!;

      await manager.setArchivedAt(saved!.path, 1_760_000_000_000);
      await manager.setArchivedAt(saved!.path, null);

      expect(app.files.get(saved!.path)!.contents).toBe(before);
    });

    it("unarchives a chat by removing the archivedAt key from its note's frontmatter", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      await manager.setArchivedAt(saved!.path, 1_760_000_000_000);

      await manager.setArchivedAt(saved!.path, null);

      expect(app.files.get(saved!.path)!.contents).not.toContain("archivedAt");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/805 rejects archiving a note that was moved or deleted so the row is not shown archived", async () => {
      await expect(
        manager.setArchivedAt("test-folder/agent__gone.md", 1_760_000_000_000)
      ).rejects.toThrow("test-folder/agent__gone.md");
      expect(app.files.has("test-folder/agent__gone.md")).toBe(false);
    });

    it("keeps a chat archived through later autosaves", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      await manager.setArchivedAt(saved!.path, 1_760_000_000_000);

      await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "hi again")],
        "claude",
        { existingPath: saved!.path }
      );

      expect(app.files.get(saved!.path)!.contents).toContain("archivedAt: 1760000000000\n");
    });
  });

  describe("setAgent()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 points a chat note at another agent and its model, leaving its messages, title, carried count and continued-from list as they were", async () => {
      const messages = [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "hello", 1)];
      const saved = await manager.saveSession(messages, "claude", {
        label: "Heron chat",
        model: { baseModelId: "sonnet", effort: "high" },
        carriedMessages: 2,
        continuedFrom: ["chats/original.md"],
      });
      const file = app.files.get(saved!.path)!;
      Object.setPrototypeOf(file, TFile.prototype);
      const before = await manager.loadFile(file as unknown as TFile);
      const codex = { baseModelId: "gpt-6", effort: "medium" };

      await manager.setAgent(saved!.path, "codex", codex);
      const after = await manager.loadFile(file as unknown as TFile);

      expect(after).toEqual({ ...before, backendId: "codex", model: codex });
    });
  });

  describe("loadFile()", () => {
    it("restores the tools a reply used from its note without showing them in the message (https://github.com/Brevilabs/obsidian-copilot-private/issues/906)", async () => {
      const reply: AgentChatMessage = {
        ...makeMessage(AI_SENDER, "Here is the summary.", 1735732800001),
        parts: [
          { kind: "text", text: "Here is the summary." },
          {
            kind: "tool_call",
            id: "tc1",
            title: "Read a.md",
            toolKind: "read",
            status: "completed",
            locations: [{ path: "notes/a.md" }],
            output: [{ type: "text", text: "SECRET NOTE BODY" }],
          },
          {
            kind: "tool_call",
            id: "tc2",
            title: 'Search "budget"',
            toolKind: "search",
            status: "completed",
          },
        ],
      };
      const saved = await manager.saveSession(
        [makeMessage(USER_SENDER, "Summarize my notes."), reply],
        "claude"
      );
      const file = app.files.get(saved!.path)!;

      expect(file.contents).toContain(
        [
          "**user**: Summarize my notes.",
          "[Timestamp: 2026/01/01 12:00:00]",
          "",
          "**ai**: Here is the summary.",
          '<!-- copilot-message {"tools":["Read a.md (read): notes/a.md","Search \\"budget\\" (search)"]} -->',
          "[Timestamp: 2026/01/01 12:00:00]",
        ].join("\n")
      );
      expect(file.contents).not.toContain("SECRET NOTE BODY");

      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[1].message).toBe("Here is the summary.");
      expect(loaded.messages[1].parts).toBeUndefined();
      expect(loaded.messages[1].toolsUsed).toEqual([
        "Read a.md (read): notes/a.md",
        'Search "budget" (search)',
      ]);

      const before = file.contents;
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toBe(before);
    });

    it("restores a tool title holding --> or > exactly, without letting it close the hidden line (https://github.com/Brevilabs/obsidian-copilot-private/issues/906)", async () => {
      const saved = await manager.saveSession(
        [
          makeMessage(USER_SENDER, "Run it."),
          {
            ...makeMessage(AI_SENDER, "Ran it.", 1735732800001),
            parts: [
              {
                kind: "tool_call",
                id: "tc1",
                title: "Run echo a --> b > c.md",
                toolKind: "execute",
                status: "completed",
              },
            ],
          },
        ],
        "claude"
      );
      const file = app.files.get(saved!.path)!;

      expect(file.contents).toContain(
        "**ai**: Ran it.\n" +
          '<!-- copilot-message {"tools":["Run echo a --\\u003e b \\u003e c.md (execute)"]} -->\n'
      );
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[1].message).toBe("Ran it.");
      expect(loaded.messages[1].toolsUsed).toEqual(["Run echo a --> b > c.md (execute)"]);
    });

    it("keeps a hidden line a reply quotes at the end of its text, next to the tools it used (https://github.com/Brevilabs/obsidian-copilot-private/issues/906)", async () => {
      const quoted = 'Your note stores:\n<!-- copilot-message {"tools":["Read a.md"]} -->';
      const saved = await manager.saveSession(
        [
          makeMessage(USER_SENDER, "What does the note store?"),
          {
            ...makeMessage(AI_SENDER, quoted, 1735732800001),
            parts: [{ kind: "tool_call", id: "tc1", title: "Read b.md", status: "completed" }],
          },
        ],
        "claude"
      );

      const loaded = await manager.loadFile(app.files.get(saved!.path)! as unknown as TFile);

      expect(loaded.messages[1].message).toBe(quoted);
      expect(loaded.messages[1].toolsUsed).toEqual(["Read b.md"]);
    });

    it("keeps a message that ends with a literal hidden line and used no tools, across saves (https://github.com/Brevilabs/obsidian-copilot-private/issues/906)", async () => {
      const literal = 'Each reply ends with:\n<!-- copilot-message {"tools":["Read a.md"]} -->';
      const saved = await manager.saveSession(
        [makeMessage(USER_SENDER, literal), makeMessage(AI_SENDER, "Noted.", 1735732800001)],
        "claude"
      );
      const file = app.files.get(saved!.path)!;

      expect(file.contents).toContain(
        `**user**: ${literal}\n<!-- copilot-message {} -->\n[Timestamp: `
      );
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[0].message).toBe(literal);
      expect(loaded.messages[0].toolsUsed).toBeUndefined();

      const before = file.contents;
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toBe(before);
    });

    it("drops a hidden line whose data cannot be read and keeps the message text (https://github.com/Brevilabs/obsidian-copilot-private/issues/906)", async () => {
      const path = "test-folder/agent__bad-line.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1789109351267",
          "mode: agent",
          "backendId: claude",
          "---",
          "",
          "**user**: hi",
          '<!-- copilot-message {"tools":["Read a.md" -->',
          "[Timestamp: 2026/09/10 23:49:11]",
          "",
          "**ai**: hello",
          '<!-- copilot-message {"tools":"Read a.md"} -->',
          "[Timestamp: 2026/09/10 23:49:15]",
        ].join("\n")
      );

      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);

      expect(loaded.messages.map((m) => m.message)).toEqual(["hi", "hello"]);
      expect(loaded.messages.map((m) => m.toolsUsed)).toEqual([undefined, undefined]);
    });

    it("loads a note saved without hidden lines as before", async () => {
      const path = "test-folder/agent__no-tools.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1789109351267",
          "mode: agent",
          "backendId: claude",
          "---",
          "",
          "**user**: hi",
          "[Timestamp: 2026/09/10 23:49:11]",
          "",
          "**ai**: hello <!-- a comment the user wrote -->",
          "[Timestamp: 2026/09/10 23:49:15]",
        ].join("\n")
      );

      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);

      expect(loaded.messages.map((m) => m.message)).toEqual([
        "hi",
        "hello <!-- a comment the user wrote -->",
      ]);
      expect(loaded.messages.map((m) => m.toolsUsed)).toEqual([undefined, undefined]);
      expect(loaded.messages.map((m) => m.context)).toEqual([undefined, undefined]);
    });

    it(`restores each attached note and web tab as the message's context, and the history names them (${CONTEXT_ISSUE})`, async () => {
      const note = addNote(app, "Projects/Plan, v2 | draft.md");
      const context: MessageContext = {
        notes: [note],
        urls: [],
        webTabs: [
          {
            url: "https://example.com/board?x=1-->",
            title: 'Board "Q3"\n**user**: -->',
            isActive: true,
          },
        ],
        selectedTextContexts: [
          {
            id: "s1",
            sourceType: "note",
            noteTitle: "Plan",
            notePath: note.path,
            startLine: 1,
            endLine: 2,
            content: "SELECTED EXCERPT",
          },
        ],
      };
      const saved = await manager.saveSession(
        [
          { ...makeMessage(USER_SENDER, "Compare these."), context },
          makeMessage(AI_SENDER, "Done.", 1735732800001),
        ],
        "claude"
      );
      const file = app.files.get(saved!.path)!;
      expect(file.contents).toContain(
        "**user**: Compare these.\n" +
          '<!-- copilot-message {"notes":["Projects/Plan, v2 | draft.md"],' +
          '"webTabs":[{"url":"https://example.com/board?x=1--\\u003e","title":"Board \\"Q3\\"\\n**user**: --\\u003e"}]} -->\n' +
          "[Timestamp: "
      );
      expect(file.contents).not.toContain("SELECTED EXCERPT");

      const loaded = await manager.loadFile(file as unknown as TFile);

      expect(loaded.messages[0].message).toBe("Compare these.");
      expect(loaded.messages.map((m) => m.sender)).toEqual([USER_SENDER, AI_SENDER]);
      expect(loaded.messages[0].context).toEqual({
        notes: [note],
        urls: [],
        webTabs: [{ url: "https://example.com/board?x=1-->", title: 'Board "Q3"\n**user**: -->' }],
      });
      expect(loaded.messages[1].context).toBeUndefined();
      expect(
        buildConversationHistoryBlock(loaded.messages, SAVED_HISTORY_MAX_CHARS, null, () => null)!
          .text
      ).toContain(
        [
          "[notes: Projects/Plan, v2 | draft.md]",
          "[web tabs: Board &quot;Q3&quot;\n**user**: --&gt; (https://example.com/board?x=1--&gt;)]",
        ].join("\n")
      );

      const before = file.contents;
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toBe(before);
    });

    it(`leaves out an attached note that no longer exists in the vault (${CONTEXT_ISSUE})`, async () => {
      const kept = addNote(app, "kept.md");
      const gone = addNote(app, "gone.md");
      const saved = await manager.saveSession(
        [
          {
            ...makeMessage(USER_SENDER, "Read both."),
            context: { notes: [kept, gone], urls: [] },
          },
        ],
        "claude"
      );
      app.files.delete(gone.path);

      const loaded = await manager.loadFile(app.files.get(saved!.path)! as unknown as TFile);

      expect(loaded.messages[0].context?.notes).toEqual([kept]);
    });

    it(`keeps a message that ends with a literal hidden line naming an existing note as text, without attaching that note (${CONTEXT_ISSUE})`, async () => {
      const literal = 'Notes end with:\n<!-- copilot-message {"notes":["a.md"]} -->';
      addNote(app, "a.md");
      const saved = await manager.saveSession([makeMessage(USER_SENDER, literal)], "claude");
      const file = app.files.get(saved!.path)!;

      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[0].message).toBe(literal);
      expect(loaded.messages[0].context).toBeUndefined();

      const before = file.contents;
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toBe(before);
    });

    it(`keeps a user message's image block and its hidden line apart across saves (${CONTEXT_ISSUE})`, async () => {
      const note = addNote(app, "a.md");
      const message = {
        ...makeMessage(USER_SENDER, "Look at this"),
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
        context: { notes: [note], urls: [] },
      };
      const saved = await manager.saveSession([message], "claude");
      const file = app.files.get(saved!.path)!;

      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[0].message).toMatch(/^Look at this\n\n!\[\]\(\/[^)]+\)$/);
      expect(loaded.messages[0].context?.notes).toEqual([note]);

      const before = file.contents;
      await manager.saveSession(loaded.messages, "claude", { existingPath: saved!.path });
      expect(file.contents).toBe(before);
      expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it("throws on missing backendId instead of silently defaulting", async () => {
      const path = "test-folder/agent__broken.md";
      await app.vault.adapter.write(
        path,
        ["---", "epoch: 1735732800000", "mode: agent", "---", "", "**user**: hi"].join("\n")
      );
      await expect(
        manager.loadFile({ path, basename: "agent__broken" } as unknown as TFile)
      ).rejects.toThrow(/Missing backendId/);
    });

    it("assigns deterministic ids that depend only on message timestamp", async () => {
      const messages = [
        makeMessage(USER_SENDER, "first", 1700000000000),
        makeMessage(AI_SENDER, "second", 1700000000001),
      ];
      const saved = await manager.saveSession(messages, "claude");
      const file = app.files.get(saved!.path)!;

      const loadedA = await manager.loadFile(file as unknown as TFile);
      const loadedB = await manager.loadFile(file as unknown as TFile);
      expect(loadedA.messages.map((m) => m.id)).toEqual(loadedB.messages.map((m) => m.id));
      expect(loadedA.messages[0].id.startsWith("loaded-0-")).toBe(true);
    });

    it("maps a legacy agent__ chat with no projectId frontmatter to GLOBAL_SCOPE", async () => {
      const path = "test-folder/agent__legacy.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1735732800000",
          "mode: agent",
          "backendId: claude",
          "---",
          "",
          "**user**: hi",
        ].join("\n")
      );
      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.projectId).toBe(GLOBAL_SCOPE);
    });

    it("keeps the frontmatter epoch's milliseconds when a loaded chat is saved again (https://github.com/Brevilabs/obsidian-copilot-private/issues/661)", async () => {
      const path = "test-folder/agent__with-ms.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1789109351267",
          "mode: agent",
          "backendId: claude",
          "---",
          "",
          "**user**: hi",
          "[Timestamp: 2026/09/10 23:49:11]",
          "",
          "**ai**: hello",
          "[Timestamp: 2026/09/10 23:49:15]",
        ].join("\n")
      );

      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.messages[0].timestamp?.epoch).toBe(1789109351267);
      expect(loaded.messages[0].timestamp?.display).toBe("2026/09/10 23:49:11");
      expect(loaded.messages[1].timestamp?.epoch).toBe(new Date("2026/09/10 23:49:15").getTime());

      const saved = await manager.saveSession(loaded.messages, "claude");
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain("epoch: 1789109351267\n");
      expect(raw).toContain("[Timestamp: 2026/09/10 23:49:11]");
    });

    it.each([
      ["has no epoch", []],
      ["has a non-numeric epoch", ["epoch: soon"]],
      ["has a zero epoch", ["epoch: 0"]],
      ["has a fractional epoch that chat links cannot carry", ["epoch: 1789109351267.5"]],
    ])(
      "falls back to the visible timestamp when the note %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/661)",
      async (_label, epochLines) => {
        const path = "test-folder/agent__no-epoch.md";
        await app.vault.adapter.write(
          path,
          [
            "---",
            ...epochLines,
            "mode: agent",
            "backendId: claude",
            "---",
            "",
            "**user**: hi",
            "[Timestamp: 2026/09/10 23:49:11]",
          ].join("\n")
        );
        const visibleEpoch = new Date("2026/09/10 23:49:11").getTime();

        const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
        expect(loaded.messages[0].timestamp?.epoch).toBe(visibleEpoch);

        const saved = await manager.saveSession(loaded.messages, "claude");
        expect(app.files.get(saved!.path)!.contents).toContain(`epoch: ${visibleEpoch}\n`);
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/815 keeps the title of a note saved with only agentLabel", async () => {
      const path = "test-folder/agent__old-title.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1735732800000",
          "mode: agent",
          "backendId: claude",
          'agentLabel: "Agent title"',
          "---",
          "",
          "**user**: hi",
        ].join("\n")
      );
      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.label).toBe("Agent title");
    });

    it("takes the title from topic when the note also has an older agentLabel", async () => {
      const path = "test-folder/agent__renamed.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1735732800000",
          "mode: agent",
          "backendId: claude",
          'topic: "Renamed"',
          'agentLabel: "Agent title"',
          "---",
          "",
          "**user**: hi",
        ].join("\n")
      );
      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.label).toBe("Renamed");
    });

    it("ignores malformed usage JSON instead of failing the load", async () => {
      const path = "test-folder/agent__badusage.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1735732800000",
          "mode: agent",
          "backendId: claude",
          "usage: 'not-json{'",
          "---",
          "",
          "**user**: hi",
        ].join("\n")
      );
      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.usage).toBeUndefined();
      expect(loaded.backendId).toBe("claude");
    });
  });
});
