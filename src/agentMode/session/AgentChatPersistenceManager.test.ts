/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import { AI_SENDER, USER_SENDER } from "@/constants";
import { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage } from "./types";
import type { App, TFile } from "obsidian";

jest.mock("obsidian", () => ({
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

/**
 * Build a minimal in-memory `app` mock that records files written via
 * `vault.create` / `vault.adapter.write` so a round-trip save/load test can
 * read what the previous step wrote without wiring real disk I/O.
 */
function makeApp() {
  const files = new Map<string, FakeFile>();
  return {
    files,
    vault: {
      getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
      create: jest.fn(async (path: string, content: string) => {
        const basename = path.split("/").pop()!.replace(/\.md$/, "");
        const file = { path, basename, contents: content };
        files.set(path, file);
        return file;
      }),
      modify: jest.fn(async (file: FakeFile, content: string) => {
        file.contents = content;
      }),
      read: jest.fn(async (file: FakeFile) => file.contents ?? ""),
      delete: jest.fn(async (file: FakeFile) => {
        files.delete(file.path);
      }),
      adapter: {
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

  it("serializes a mid-stream fan-out turn so an interrupted autosave isn't blank", async () => {
    // A long fan-out turn whose composite body has NOT been written to `message`
    // yet (still streaming), saved mid-turn (reload/close/crash). The live fanout
    // must be serialized so the streamed per-agent text survives, not a blank bubble.
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
    // The label line must remain a single key:value entry.
    const labelLines = raw.split("\n").filter((l) => l.startsWith("agentLabel:"));
    expect(labelLines).toHaveLength(1);
    const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
    expect(loaded.label).toBe("first second third");
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
    // The key contract: same file + same content → same ids across reloads.
    expect(loadedA.messages.map((m) => m.id)).toEqual(loadedB.messages.map((m) => m.id));
    expect(loadedA.messages[0].id.startsWith("loaded-0-")).toBe(true);
  });

  it("returns null when given zero messages instead of writing an empty file", async () => {
    const result = await manager.saveSession([], "opencode");
    expect(result).toBeNull();
    expect(app.files.size).toBe(0);
  });

  describe("projectId scope round-trip", () => {
    it("round-trips a real projectId for a project-scoped chat", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "claude", { projectId: "proj-123" });
      expect(saved).not.toBeNull();

      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain('projectId: "proj-123"');

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe("proj-123");
    });

    it("defaults an unscoped chat to GLOBAL_SCOPE and writes no projectId (hard contract)", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "claude");
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).not.toContain("projectId:");

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe(GLOBAL_SCOPE);
    });

    it("treats an explicit GLOBAL_SCOPE like an unscoped chat (no projectId frontmatter)", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "claude", { projectId: GLOBAL_SCOPE });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).not.toContain("projectId:");

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe(GLOBAL_SCOPE);
    });

    it("treats a blank projectId option like an unscoped chat", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "claude", { projectId: "   " });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).not.toContain("projectId:");

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe(GLOBAL_SCOPE);
    });

    it("normalizes a padded projectId option before writing frontmatter", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "claude", { projectId: " proj-123 " });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain('projectId: "proj-123"');
      expect(raw).not.toContain('projectId: " proj-123 "');

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe("proj-123");
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
      // Reason: the stored file carries `contents`, so loadFile's vault.read
      // path returns the frontmatter (a bare {path} fixture would read empty).
      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.projectId).toBe(GLOBAL_SCOPE);
    });
  });
});
