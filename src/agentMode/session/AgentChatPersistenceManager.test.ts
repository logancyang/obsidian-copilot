import { TFile, TFolder } from "obsidian";
import { AGENT_CHAT_FILE_PREFIX, AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import { AI_SENDER, USER_SENDER } from "@/constants";
import type { AgentChatMessage } from "./types";

const SAVE_FOLDER = "copilot-conversations";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    defaultSaveFolder: "copilot-conversations",
    defaultConversationTag: "conversation",
    defaultConversationNoteName: "{$date}_{$time}__{$topic}",
  }),
}));

jest.mock("@/utils", () => {
  const actual = jest.requireActual("@/utils");
  return {
    ...actual,
    ensureFolderExists: jest.fn().mockResolvedValue(undefined),
  };
});

interface FakeFile {
  path: string;
  basename: string;
  body: string;
  frontmatter: Record<string, any>;
  ctime: number;
}

/**
 * Minimal in-memory `App` shim that captures vault writes and lets the test
 * inspect what landed on "disk". Keeps the test free of jest mocks for every
 * vault method by routing the persistence manager's calls through a small
 * map.
 */
function toTFile(f: FakeFile): TFile {
  // The obsidian mock's TFile is a constructable function — `instanceof TFile`
  // checks downstream rely on this prototype chain.
  const tfile = new (TFile as any)(f.path);
  tfile.stat = { ctime: f.ctime, mtime: f.ctime, size: f.body.length };
  return tfile;
}

function makeApp(initialFiles: FakeFile[] = []) {
  const files = new Map<string, FakeFile>();
  for (const f of initialFiles) files.set(f.path, f);

  const folder = new (TFolder as any)(SAVE_FOLDER);

  const vault = {
    getAbstractFileByPath: (path: string) => {
      if (path === SAVE_FOLDER) return folder;
      const f = files.get(path);
      return f ? toTFile(f) : null;
    },
    create: jest.fn(async (path: string, content: string) => {
      if (files.has(path)) {
        const err = new Error("File already exists.");
        throw err;
      }
      const basename = path.split("/").pop()!.replace(/\.md$/, "");
      const file: FakeFile = { path, basename, body: content, frontmatter: {}, ctime: Date.now() };
      files.set(path, file);
      return toTFile(file);
    }),
    modify: jest.fn(async (file: TFile, content: string) => {
      const f = files.get(file.path);
      if (f) f.body = content;
    }),
    read: jest.fn(async (file: TFile) => files.get(file.path)?.body ?? ""),
    delete: jest.fn(async (file: TFile) => {
      files.delete(file.path);
    }),
    getMarkdownFiles: () => Array.from(files.values()).map(toTFile),
    adapter: {
      exists: jest.fn(async (path: string) => path === SAVE_FOLDER || files.has(path)),
      read: jest.fn(async (path: string) => files.get(path)?.body ?? ""),
      write: jest.fn(async (path: string, content: string) => {
        const f = files.get(path);
        if (f) f.body = content;
      }),
      remove: jest.fn(async (path: string) => {
        files.delete(path);
      }),
      list: jest.fn(async (path: string) => ({
        files:
          path === SAVE_FOLDER
            ? Array.from(files.keys()).filter((p) => p.startsWith(`${SAVE_FOLDER}/`))
            : [],
        folders: [],
      })),
      stat: jest.fn(),
      mkdir: jest.fn(),
    },
  };

  const metadataCache = {
    getFileCache: (file: TFile) => {
      const f = files.get(file.path);
      return f ? { frontmatter: f.frontmatter } : null;
    },
  };

  const fileManager = {
    processFrontMatter: jest.fn(async (file: TFile, mutator: (fm: any) => void) => {
      const f = files.get(file.path);
      if (!f) return;
      mutator(f.frontmatter);
    }),
  };

  return {
    app: { vault, metadataCache, fileManager } as any,
    files,
  };
}

function makeMessages(): AgentChatMessage[] {
  return [
    {
      id: "u1",
      sender: USER_SENDER,
      message: "Hello agent",
      isVisible: true,
      timestamp: {
        epoch: 1700000000000,
        display: "2023/11/14 22:13:20",
        fileName: "20231114_221320",
      },
    },
    {
      id: "a1",
      sender: AI_SENDER,
      message: "Hi there!",
      isVisible: true,
      timestamp: {
        epoch: 1700000005000,
        display: "2023/11/14 22:13:25",
        fileName: "20231114_221325",
      },
    },
  ];
}

describe("AgentChatPersistenceManager", () => {
  it("save() returns null when there are no messages", async () => {
    const { app } = makeApp();
    const mgr = new AgentChatPersistenceManager(app);
    const result = await mgr.save({ messages: [], backendId: "opencode" });
    expect(result).toBeNull();
    expect(app.vault.create).not.toHaveBeenCalled();
  });

  it("save() creates a file with the agent__ prefix and mode/backendId frontmatter", async () => {
    const { app, files } = makeApp();
    const mgr = new AgentChatPersistenceManager(app);
    await mgr.save({ messages: makeMessages(), backendId: "opencode", label: "My session" });

    const created = Array.from(files.values()).find((f) =>
      f.basename.startsWith(AGENT_CHAT_FILE_PREFIX)
    );
    expect(created).toBeDefined();
    expect(created!.body).toMatch(/mode: agent/);
    expect(created!.body).toMatch(/backendId: opencode/);
    expect(created!.body).toMatch(/agentLabel: "My session"/);
    expect(created!.body).toMatch(/\*\*user\*\*: Hello agent/);
    expect(created!.body).toMatch(/\*\*ai\*\*: Hi there!/);
  });

  it("save() updates the existing file in place when given its path", async () => {
    const { app, files } = makeApp();
    const mgr = new AgentChatPersistenceManager(app);
    const first = await mgr.save({ messages: makeMessages(), backendId: "opencode" });
    expect(first).not.toBeNull();
    const path = first!.path;
    const fm = files.get(path)!.frontmatter;
    fm.epoch = 1700000000000;

    const more = [
      ...makeMessages(),
      {
        id: "u2",
        sender: USER_SENDER,
        message: "Another turn",
        isVisible: true,
        timestamp: {
          epoch: 1700000010000,
          display: "2023/11/14 22:13:30",
          fileName: "20231114_221330",
        },
      },
    ] as AgentChatMessage[];

    await mgr.save({ messages: more, backendId: "opencode" }, path);
    expect(app.vault.create).toHaveBeenCalledTimes(1); // no new file
    expect(files.get(path)!.body).toMatch(/Another turn/);
  });

  it("listFiles() filters to agent__ prefix only", async () => {
    const { app } = makeApp([
      {
        path: "copilot-conversations/agent__abc.md",
        basename: "agent__abc",
        body: "",
        frontmatter: {},
        ctime: 0,
      },
      {
        path: "copilot-conversations/regular_chat.md",
        basename: "regular_chat",
        body: "",
        frontmatter: {},
        ctime: 0,
      },
      {
        path: "copilot-conversations/projectId__chat.md",
        basename: "projectId__chat",
        body: "",
        frontmatter: {},
        ctime: 0,
      },
    ]);
    const mgr = new AgentChatPersistenceManager(app);
    const result = await mgr.listFiles();
    expect(result.map((f) => f.basename)).toEqual(["agent__abc"]);
  });

  it("loadFile() round-trips a saved chat", async () => {
    const { app, files } = makeApp();
    const mgr = new AgentChatPersistenceManager(app);
    const file = await mgr.save({ messages: makeMessages(), backendId: "claude-code" });
    expect(file).not.toBeNull();

    // Mirror the frontmatter the metadataCache would have picked up after save.
    const stored = files.get(file!.path)!;
    stored.frontmatter = parseFrontmatter(stored.body);

    const loaded = await mgr.loadFile(file!);
    expect(loaded).not.toBeNull();
    expect(loaded!.backendId).toBe("claude-code");
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0].sender).toBe(USER_SENDER);
    expect(loaded!.messages[0].message).toBe("Hello agent");
    expect(loaded!.messages[1].sender).toBe(AI_SENDER);
    expect(loaded!.messages[1].message).toBe("Hi there!");
  });

  it("loadFile() rejects files whose mode is not 'agent'", async () => {
    const file: FakeFile = {
      path: "copilot-conversations/agent__legacy.md",
      basename: "agent__legacy",
      body: `---\nmode: copilot\n---\n\n**user**: not for agent`,
      frontmatter: { mode: "copilot" },
      ctime: 0,
    };
    const { app } = makeApp([file]);
    const mgr = new AgentChatPersistenceManager(app);
    const tFile = app.vault.getAbstractFileByPath(file.path);
    const loaded = await mgr.loadFile(tFile);
    expect(loaded).toBeNull();
  });

  it("updateTopic() patches frontmatter via fileManager", async () => {
    const file: FakeFile = {
      path: "copilot-conversations/agent__abc.md",
      basename: "agent__abc",
      body: `---\nmode: agent\nbackendId: opencode\n---\n\n**user**: hi`,
      frontmatter: { mode: "agent", backendId: "opencode" },
      ctime: 0,
    };
    const { app, files } = makeApp([file]);
    const mgr = new AgentChatPersistenceManager(app);
    await mgr.updateTopic(file.path, "Renamed");
    expect(files.get(file.path)!.frontmatter.topic).toBe("Renamed");
  });

  it("deleteFile() removes the file from the vault", async () => {
    const file: FakeFile = {
      path: "copilot-conversations/agent__abc.md",
      basename: "agent__abc",
      body: "",
      frontmatter: {},
      ctime: 0,
    };
    const { app, files } = makeApp([file]);
    const mgr = new AgentChatPersistenceManager(app);
    await mgr.deleteFile(file.path);
    expect(files.has(file.path)).toBe(false);
  });
});

/** Tiny YAML extractor — just enough to feed the round-trip test. */
function parseFrontmatter(body: string): Record<string, any> {
  const match = body.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, any> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) result[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return result;
}
