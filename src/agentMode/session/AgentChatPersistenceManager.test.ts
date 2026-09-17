/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import { AI_SENDER, USER_SENDER } from "@/constants";
import { readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage } from "./types";
import { TFile } from "obsidian";
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
  isInVaultCache: jest.fn(() => false),
  listMarkdownFiles: jest.fn().mockResolvedValue([]),
  readFrontmatterViaAdapter: jest.fn().mockResolvedValue(null),
}));

interface FakeFile {
  path: string;
  basename: string;
  contents?: string;
}

function makeApp() {
  const files = new Map<string, FakeFile>();
  return {
    files,
    vault: {
      createBinary: jest.fn(async (path: string, bytes: ArrayBuffer) => ({ path })),
      getConfig: jest.fn(() => "attachments"),
      createFolder: jest.fn(),
      getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
      create: jest.fn(async (path: string, content: string) => {
        const basename = path.split("/").pop()!.replace(/\.md$/, "");
        const file = { path, basename, contents: content };
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
      getFileCache: jest.fn(() => undefined),
    },
    fileManager: {
      processFrontMatter: jest.fn(),
    },
  };
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

  afterEach(() => {
    (readFrontmatterViaAdapter as jest.Mock).mockResolvedValue(null);
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
      const labelLines = raw.split("\n").filter((l) => l.startsWith("agentLabel:"));
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
      (readFrontmatterViaAdapter as jest.Mock).mockImplementation(async (_app, path: string) => {
        const raw = app.files.get(path)?.contents ?? "";
        const yaml = raw.match(/^---\n([\s\S]*?)\n---/)?.[1];
        if (!yaml) return null;
        const fm: Record<string, string> = {};
        for (const line of yaml.split("\n")) {
          const m = line.match(/^([\w-]+):\s*(.+)/);
          if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
        }
        return fm;
      });
      const second = await manager.saveSession(messages, "claude", {
        existingPath: first!.path,
      });
      const loaded = await manager.loadFile(app.files.get(second!.path) as unknown as TFile);
      expect(loaded.usage).toEqual(usage);
    });

    it("leaves usage undefined for a chat saved without it", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude");
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).not.toContain("usage:");
      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.usage).toBeUndefined();
    });
  });

  describe("loadFile()", () => {
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

  describe("agentSlug frontmatter", () => {
    afterEach(() => {
      (readFrontmatterViaAdapter as jest.Mock).mockResolvedValue(null);
    });

    it("round-trips the agent a chat was held with", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        agentSlug: "jennifer",
      });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain('agentSlug: "jennifer"');

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.agentSlug).toBe("jennifer");
    });

    it("writes no field for a Copilot chat, so it matches one saved before agents existed", async () => {
      // `designdocs/CUSTOM_AGENTS.md` §8: the field is omitted for the built-in
      // assistant, which is what keeps older chats loading unchanged.
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        agentSlug: null,
      });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).not.toContain("agentSlug:");

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.agentSlug).toBeUndefined();
    });

    it("keeps the persisted slug when a later save omits it", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const first = await manager.saveSession(messages, "claude", { agentSlug: "jennifer" });
      Object.setPrototypeOf(app.files.get(first!.path)!, TFile.prototype);
      (readFrontmatterViaAdapter as jest.Mock).mockImplementation(async (_app, path: string) => {
        const raw = app.files.get(path)?.contents ?? "";
        const yaml = raw.match(/^---\n([\s\S]*?)\n---/)?.[1];
        if (!yaml) return null;
        const fm: Record<string, string> = {};
        for (const line of yaml.split("\n")) {
          const m = line.match(/^([\w-]+):\s*(.+)/);
          if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
        }
        return fm;
      });

      const second = await manager.saveSession(messages, "claude", { existingPath: first!.path });

      const loaded = await manager.loadFile(app.files.get(second!.path) as unknown as TFile);
      expect(loaded.agentSlug).toBe("jennifer");
    });

    it("loads a chat written before the field existed with no agent named", async () => {
      const path = "test-folder/agent__legacy-agentless.md";
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

      expect(loaded.agentSlug).toBeUndefined();
      expect(loaded.backendId).toBe("claude");
    });
  });

  describe("memorizedThroughTurn frontmatter", () => {
    afterEach(() => {
      (readFrontmatterViaAdapter as jest.Mock).mockResolvedValue(null);
    });

    it("round-trips how far the agent has memorized (CUSTOM_AGENTS.md §5)", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        agentSlug: "jennifer",
        memorizedThroughTurn: 4,
      });
      expect(app.files.get(saved!.path)!.contents!).toContain("memorizedThroughTurn: 4");

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.memorizedThroughTurn).toBe(4);
    });

    it("writes no field before anything is memorized (CUSTOM_AGENTS.md §8)", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "claude", {
        agentSlug: "jennifer",
        memorizedThroughTurn: 0,
      });

      expect(app.files.get(saved!.path)!.contents!).not.toContain("memorizedThroughTurn");
    });

    it("keeps the marker when a later save omits it, so memorized turns are not re-read", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const first = await manager.saveSession(messages, "claude", {
        agentSlug: "jennifer",
        memorizedThroughTurn: 2,
      });
      Object.setPrototypeOf(app.files.get(first!.path)!, TFile.prototype);
      (readFrontmatterViaAdapter as jest.Mock).mockImplementation(async (_app, path: string) => {
        const raw = app.files.get(path)?.contents ?? "";
        const yaml = raw.match(/^---\n([\s\S]*?)\n---/)?.[1];
        if (!yaml) return null;
        const fm: Record<string, string> = {};
        for (const line of yaml.split("\n")) {
          const m = line.match(/^([\w-]+):\s*(.+)/);
          if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
        }
        return fm;
      });

      const second = await manager.saveSession(messages, "claude", { existingPath: first!.path });

      const loaded = await manager.loadFile(app.files.get(second!.path) as unknown as TFile);
      expect(loaded.memorizedThroughTurn).toBe(2);
    });

    it("loads a chat written before the field existed as never memorized", async () => {
      const path = "test-folder/agent__legacy-unmemorized.md";
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

      expect(loaded.memorizedThroughTurn).toBeUndefined();
      expect(loaded.messages).toHaveLength(1);
    });

    it("ignores a hand-edited marker that is not a positive whole number", async () => {
      const path = "test-folder/agent__bad-marker.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1735732800000",
          "mode: agent",
          "backendId: claude",
          "memorizedThroughTurn: soon",
          "---",
          "",
          "**user**: hi",
        ].join("\n")
      );

      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);

      expect(loaded.memorizedThroughTurn).toBeUndefined();
    });
  });
});
