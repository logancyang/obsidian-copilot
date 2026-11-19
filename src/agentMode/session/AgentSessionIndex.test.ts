import { AgentSessionIndex, type AgentSessionIndexStorage } from "./AgentSessionIndex";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const INDEX_PATH = "config/plugins/copilot/agent-chat-index.json";
const ISSUE_977 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/977";

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

    it("keeps the model a chat last ran when a later record names none (https://github.com/logancyang/obsidian-copilot/issues/4274)", async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ model: { baseModelId: "sonnet", effort: "high" } }));
      await index.recordSession(entry({ model: { baseModelId: "opus", effort: "high" } }));
      await index.recordSession(entry({ lastAccessedAtMs: 9_000 }));
      expect((await index.getEntry("opencode", "s1"))?.model).toEqual({
        baseModelId: "opus",
        effort: "high",
      });
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
    it(`removes the chat, which stays off the list after the index is reloaded from disk (${ISSUE_977})`, async () => {
      const storage = makeStorage();
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      await index.recordSession(entry());
      await index.recordSession(entry({ sessionId: "kept" }));
      await index.deleteSession("opencode", "s1");
      await index.flushOrThrow();
      expect((await index.getEntries()).map((e) => e.sessionId)).toEqual(["kept"]);

      const reloaded = new AgentSessionIndex(storage, INDEX_PATH);
      expect((await reloaded.getEntries()).map((e) => e.sessionId)).toEqual(["kept"]);
    });
  });

  describe("flush()", () => {
    it("persists entries across instances", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry());
      await first.flush();
      expect(storage.files.get(INDEX_PATH)).toContain("s1");

      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect(await second.getEntry("opencode", "s1")).toMatchObject({ sessionId: "s1" });
    });

    it("restores a user rename and its source after reload", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry());
      await first.setTitle("opencode", "s1", "My rename");
      await first.flush();
      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect(await second.getEntry("opencode", "s1")).toMatchObject({
        title: "My rename",
        titleSource: "user",
      });
    });

    it("keeps only the 500 most recently opened chats, dropping the least recently opened", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      for (let i = 1; i <= 501; i++) {
        await first.recordSession(
          entry({ sessionId: `chat-${i}`, createdAtMs: i, lastAccessedAtMs: i })
        );
      }
      await first.flush();
      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect(await second.getEntries()).toHaveLength(500);
      expect(await second.getEntry("opencode", "chat-1")).toBeNull();
      expect(await second.getEntry("opencode", "chat-2")).not.toBeNull();
      expect(await second.getEntry("opencode", "chat-501")).not.toBeNull();
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

    it("restores each chat's recorded model after reload and drops a malformed one (https://github.com/logancyang/obsidian-copilot/issues/4274)", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry({ model: { baseModelId: "opus", effort: null } }));
      await first.recordSession(
        entry({ sessionId: "bad-model", model: { effort: "high" } as never })
      );
      await first.flush();
      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect((await second.getEntry("opencode", "s1"))?.model).toEqual({
        baseModelId: "opus",
        effort: null,
      });
      expect((await second.getEntry("opencode", "bad-model"))?.model).toBeUndefined();
    });

    it("restores the custom agent a chat runs as after reload, keeps it when a later record names none, and leaves other chats without one", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry({ agent: "coco" }));
      await first.recordSession(entry({ lastAccessedAtMs: 9_000 }));
      await first.recordSession(entry({ sessionId: "plain" }));
      await first.flush();
      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect((await second.getEntry("opencode", "s1"))?.agent).toBe("coco");
      expect((await second.getEntry("opencode", "plain"))?.agent).toBeUndefined();
    });
  });

  describe("flushOrThrow()", () => {
    it("writes the pending deletion before it resolves", async () => {
      const storage = makeStorage();
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      await index.recordSession(entry());
      await index.deleteSession("opencode", "s1");
      await index.flushOrThrow();
      expect(JSON.parse(storage.files.get(INDEX_PATH)!)).toEqual({ version: 1, entries: [] });
    });

    it("rejects with the storage error when the write fails", async () => {
      const storage = makeStorage();
      storage.write = async () => {
        throw new Error("disk full");
      };
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      await index.deleteSession("opencode", "s1");
      await expect(index.flushOrThrow()).rejects.toThrow("disk full");
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
        }),
      });
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      expect(await index.getEntries()).toHaveLength(1);
    });

    it(`lists the chats of an index file that still holds deleted-chat markers, and drops the markers on the next write (${ISSUE_977})`, async () => {
      const storage = makeStorage({
        [INDEX_PATH]: JSON.stringify(
          {
            version: 1,
            entries: [
              {
                backendId: "opencode",
                sessionId: "ses_1f2e3d4c5b6aFFeeDdCcBbAa99",
                title: "Plan the garden beds",
                titleSource: "agent",
                createdAtMs: 1_763_500_000_000,
                lastAccessedAtMs: 1_763_500_600_000,
                model: { baseModelId: "opencode/deepseek-v4.1-flash-free", effort: null },
              },
              {
                backendId: "claude",
                sessionId: "0b8f6c1e-4d2a-4f7e-9c3b-2a1d5e6f7a8b",
                title: "Summarize the reading list",
                createdAtMs: 1_763_400_000_000,
                lastAccessedAtMs: 1_763_400_300_000,
                projectId: "reading",
                agent: "maya",
              },
            ],
            tombstones: {
              "opencode:ses_0a9b8c7d6e5fAAbbCcDdEeFf11": 1_763_500_100_000,
              "opencode:ses_1f2e3d4c5b6aFFeeDdCcBbAa99": 1_763_400_100_000,
            },
          },
          null,
          2
        ),
      });
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      expect((await index.getEntries()).map((e) => [e.sessionId, e.title])).toEqual([
        ["ses_1f2e3d4c5b6aFFeeDdCcBbAa99", "Plan the garden beds"],
        ["0b8f6c1e-4d2a-4f7e-9c3b-2a1d5e6f7a8b", "Summarize the reading list"],
      ]);

      await index.touch("claude", "0b8f6c1e-4d2a-4f7e-9c3b-2a1d5e6f7a8b");
      await index.flushOrThrow();
      const written = JSON.parse(storage.files.get(INDEX_PATH)!);
      expect(written).not.toHaveProperty("tombstones");
      expect(written.entries).toHaveLength(2);
    });
  });
});
