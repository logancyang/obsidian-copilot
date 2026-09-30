import { AgentSessionIndex, type AgentSessionIndexStorage } from "./AgentSessionIndex";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const INDEX_PATH = "config/plugins/copilot/agent-chat-index.json";

function makeStorage(initial?: Record<string, string>): AgentSessionIndexStorage & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    files,
    exists: async (p) => files.has(p),
    read: async (p) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    write: async (p, c) => {
      files.set(p, c);
    },
  };
}

function entry(overrides: Partial<Parameters<AgentSessionIndex["recordSession"]>[0]> = {}) {
  return {
    backendId: "opencode",
    sessionId: "s1",
    title: "Refactor the daily template",
    createdAtMs: 1_000,
    lastAccessedAtMs: 2_000,
    ...overrides,
  };
}

describe("AgentSessionIndex", () => {
  describe("recordSession()", () => {
    it("records sessions and lists them", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry());
      await index.recordSession(entry({ backendId: "codex", sessionId: "s2", title: null }));
      const entries = await index.getEntries();
      expect(entries).toHaveLength(2);
      expect(await index.getEntry("opencode", "s1")).toMatchObject({
        title: "Refactor the daily template",
      });
    });

    it("keeps earliest createdAt, latest lastAccessed, and known title", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ createdAtMs: 1_000, lastAccessedAtMs: 5_000 }));
      await index.recordSession(
        entry({ title: null, createdAtMs: 3_000, lastAccessedAtMs: 4_000 })
      );
      expect(await index.getEntry("opencode", "s1")).toMatchObject({
        title: "Refactor the daily template",
        createdAtMs: 1_000,
        lastAccessedAtMs: 5_000,
      });
    });

    it("clears a tombstone — live activity reflects fresh intent", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.deleteSession("opencode", "s1");
      await index.recordSession(entry());
      expect(await index.isTombstoned("opencode", "s1")).toBe(false);
      expect(await index.getEntries()).toHaveLength(1);
    });

    it("keeps a user-sourced label across later discovered-session merges", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ title: "Tab rename", titleSource: "user" }));
      await index.mergeDiscoveredSessions([entry({ title: "Agent original" })]);
      expect((await index.getEntry("opencode", "s1"))?.title).toBe("Tab rename");
    });
  });

  describe("mergeDiscoveredSessions()", () => {
    it("never moves lastAccessed backwards", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ lastAccessedAtMs: 9_000 }));
      await index.mergeDiscoveredSessions([
        entry({ title: "Agent generated title", lastAccessedAtMs: 4_000 }),
      ]);
      expect(await index.getEntry("opencode", "s1")).toMatchObject({
        title: "Agent generated title",
        lastAccessedAtMs: 9_000,
      });
    });

    it("keeps a user rename across discovered-session merges while agent titles stay refreshable", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ title: "Agent title", titleSource: "agent" }));
      await index.setTitle("opencode", "s1", "My rename");
      await index.mergeDiscoveredSessions([entry({ title: "Agent title v2" })]);
      expect(await index.getEntry("opencode", "s1")).toMatchObject({
        title: "My rename",
        titleSource: "user",
      });

      await index.recordSession(
        entry({ sessionId: "s2", title: "Agent title", titleSource: "agent" })
      );
      await index.mergeDiscoveredSessions([entry({ sessionId: "s2", title: "Agent title v2" })]);
      expect((await index.getEntry("opencode", "s2"))?.title).toBe("Agent title v2");
    });

    it("fills a missing project scope from a sweep but never strips a known one", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ projectId: "proj-1" }));
      await index.mergeDiscoveredSessions([
        entry({ title: "Sweep title", lastAccessedAtMs: 9_000 }),
      ]);
      expect((await index.getEntry("opencode", "s1"))?.projectId).toBe("proj-1");

      await index.mergeDiscoveredSessions([
        entry({ sessionId: "s2", projectId: "proj-2", lastAccessedAtMs: 9_000 }),
      ]);
      expect((await index.getEntry("opencode", "s2"))?.projectId).toBe("proj-2");
    });
  });

  describe("setTitle()", () => {
    it("renames an entry", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry());
      await index.setTitle("opencode", "s1", "Renamed");
      expect((await index.getEntry("opencode", "s1"))?.title).toBe("Renamed");
    });
  });

  describe("touch()", () => {
    it("bumps lastAccessed to the current time", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ lastAccessedAtMs: 1 }));
      await index.touch("opencode", "s1");
      expect((await index.getEntry("opencode", "s1"))?.lastAccessedAtMs).toBeGreaterThan(1);
    });
  });

  describe("deleteSession()", () => {
    it("tombstones the key so discovered sessions stay suppressed", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry());
      await index.deleteSession("opencode", "s1");
      expect(await index.getEntries()).toHaveLength(0);
      expect(await index.isTombstoned("opencode", "s1")).toBe(true);

      await index.mergeDiscoveredSessions([entry()]);
      expect(await index.getEntries()).toHaveLength(0);
    });
  });

  describe("flush()", () => {
    it("persists entries and tombstones across instances", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry());
      await first.deleteSession("codex", "gone");
      await first.flush();
      expect(storage.files.get(INDEX_PATH)).toContain("s1");

      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect(await second.getEntry("opencode", "s1")).toMatchObject({ sessionId: "s1" });
      expect(await second.isTombstoned("codex", "gone")).toBe(true);
    });

    it("restores the user title marker after reload so later merges keep the rename", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry());
      await first.setTitle("opencode", "s1", "My rename");
      await first.flush();
      const second = new AgentSessionIndex(storage, INDEX_PATH);
      await second.mergeDiscoveredSessions([entry({ title: "Agent original" })]);
      expect((await second.getEntry("opencode", "s1"))?.title).toBe("My rename");
    });

    it("restores project scope after reload and leaves unscoped chats unscoped", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry({ projectId: "proj-1" }));
      await first.recordSession(entry({ sessionId: "global-chat" }));
      await first.flush();
      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect((await second.getEntry("opencode", "s1"))?.projectId).toBe("proj-1");
      expect((await second.getEntry("opencode", "global-chat"))?.projectId).toBeUndefined();
    });
  });

  describe("getEntries()", () => {
    it("starts empty when the index file is corrupt", async () => {
      const corrupt = new AgentSessionIndex(
        makeStorage({ [INDEX_PATH]: "not json {" }),
        INDEX_PATH
      );
      expect(await corrupt.getEntries()).toEqual([]);
    });

    it("drops malformed entries on load instead of failing the whole index", async () => {
      const storage = makeStorage({
        [INDEX_PATH]: JSON.stringify({
          version: 1,
          entries: [
            entry(),
            { backendId: "", sessionId: "x", createdAtMs: 1, lastAccessedAtMs: 1 },
            { backendId: "codex", sessionId: "y" },
            "garbage",
          ],
          tombstones: { "codex:z": "not-a-number" },
        }),
      });
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      expect(await index.getEntries()).toHaveLength(1);
      expect(await index.isTombstoned("codex", "z")).toBe(false);
    });
  });
});
