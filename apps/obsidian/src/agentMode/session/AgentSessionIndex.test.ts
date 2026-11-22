import {
  AgentSessionIndex,
  type AgentSessionIndexStorage,
  type AskedConversation,
} from "./AgentSessionIndex";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const INDEX_PATH = "config/plugins/copilot/agent-chat-index.json";
const ISSUE_977 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/977";
const ISSUE_980 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/980";

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

function asked(overrides: Partial<AskedConversation> = {}): AskedConversation {
  return {
    backendId: "claude",
    sessionId: "maya-hidden-1",
    model: { baseModelId: "haiku", effort: null },
    agent: "maya",
    askedBy: "coco",
    askedIn: { backendId: "claude", sessionId: "coco-chat-1" },
    firstAtMs: 1_000,
    lastAtMs: 2_000,
    asks: 1,
    firstAsk: "Is $8k right for the launch?",
    latestAnswer: "Yes, if the video stays under two minutes.",
    ending: "finished",
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

    it(`removes the conversations the deleted chat asked agents into and keeps the ones other chats asked (${ISSUE_980})`, async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ backendId: "claude", sessionId: "coco-chat-1" }));
      await index.updateAskedConversation("claude", "maya-hidden-1", () => asked());
      await index.updateAskedConversation("claude", "maya-hidden-2", () =>
        asked({
          sessionId: "maya-hidden-2",
          askedIn: { backendId: "claude", sessionId: "copilot-chat" },
        })
      );

      await index.deleteSession("claude", "coco-chat-1");

      expect((await index.getAskedConversations()).map((c) => c.sessionId)).toEqual([
        "maya-hidden-2",
      ]);
    });
  });

  describe("updateAskedConversation()", () => {
    it(`records a conversation an agent was asked into in the file's own section, apart from the chats (${ISSUE_980})`, async () => {
      const storage = makeStorage();
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      await index.recordSession(entry());

      await index.updateAskedConversation("claude", "maya-hidden-1", () => asked());
      await index.flushOrThrow();

      expect(await index.getAskedConversations()).toEqual([asked()]);
      expect((await index.getEntries()).map((e) => e.sessionId)).toEqual(["s1"]);
      const written = JSON.parse(storage.files.get(INDEX_PATH)!);
      expect(written.entries).toHaveLength(1);
      const { agent, ...savedFields } = asked();
      expect(written.askedConversations).toEqual([{ ...savedFields, teammate: agent }]);
    });

    it(`hands the change the conversation already recorded, and records nothing when the change keeps none (${ISSUE_980})`, async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.updateAskedConversation("claude", "maya-hidden-1", () => asked());

      await index.updateAskedConversation("claude", "maya-hidden-1", (known) =>
        known ? { ...known, asks: known.asks + 1 } : undefined
      );
      await index.updateAskedConversation("claude", "unknown", (known) => known);

      expect(await index.getAskedConversations()).toEqual([asked({ asks: 2 })]);
    });
  });

  describe("deleteAskedConversations()", () => {
    it(`removes only the asked conversations that match, and leaves the chats (${ISSUE_980})`, async () => {
      const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
      await index.recordSession(entry({ teammate: "maya" }));
      await index.updateAskedConversation("claude", "maya-hidden-1", () => asked());
      await index.updateAskedConversation("claude", "leo-hidden-1", () =>
        asked({ sessionId: "leo-hidden-1", agent: "leo" })
      );

      await index.deleteAskedConversations((conversation) => conversation.agent === "maya");

      expect((await index.getAskedConversations()).map((c) => c.agent)).toEqual(["leo"]);
      expect(await index.getEntries()).toHaveLength(1);
    });
  });

  describe("getAskedConversations()", () => {
    it(`has none for an index file written before asked conversations were recorded (${ISSUE_980})`, async () => {
      const index = new AgentSessionIndex(
        makeStorage({ [INDEX_PATH]: JSON.stringify({ version: 1, entries: [entry()] }) }),
        INDEX_PATH
      );

      expect(await index.getAskedConversations()).toEqual([]);
      expect(await index.getEntries()).toHaveLength(1);
    });

    it(`restores asked conversations after a reload and drops malformed ones (${ISSUE_980})`, async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.updateAskedConversation("claude", "maya-hidden-1", () => asked());
      await first.updateAskedConversation("codex", "copilot-asked", () =>
        asked({
          backendId: "codex",
          sessionId: "copilot-asked",
          askedBy: undefined,
          model: undefined,
          latestAnswer: undefined,
          ending: undefined,
        })
      );
      await first.flushOrThrow();
      const written = JSON.parse(storage.files.get(INDEX_PATH)!);
      written.askedConversations.push(
        { ...asked(), sessionId: "no-asking-chat", askedIn: null },
        { ...asked(), sessionId: "no-ask", firstAsk: 7 },
        "garbage"
      );
      storage.files.set(INDEX_PATH, JSON.stringify(written));

      const second = new AgentSessionIndex(storage, INDEX_PATH);

      expect(await second.getAskedConversations()).toEqual([
        asked(),
        {
          backendId: "codex",
          sessionId: "copilot-asked",
          agent: "maya",
          askedIn: { backendId: "claude", sessionId: "coco-chat-1" },
          firstAtMs: 1_000,
          lastAtMs: 2_000,
          asks: 1,
          firstAsk: "Is $8k right for the launch?",
        },
      ]);
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

    it(`keeps only the 100 asked conversations asked or answered last, beside all 500 chats (${ISSUE_980})`, async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      for (let i = 1; i <= 500; i++) {
        await first.recordSession(
          entry({ sessionId: `chat-${i}`, createdAtMs: i, lastAccessedAtMs: i })
        );
      }
      for (let i = 1; i <= 101; i++) {
        await first.updateAskedConversation("claude", `hidden-${i}`, () =>
          asked({ sessionId: `hidden-${i}`, lastAtMs: i === 1 ? 5_000 : 1_000 + i })
        );
      }
      await first.flush();

      const second = new AgentSessionIndex(storage, INDEX_PATH);
      const kept = (await second.getAskedConversations()).map((c) => c.sessionId);
      expect(await second.getEntries()).toHaveLength(500);
      expect(kept).toHaveLength(100);
      expect(kept).toContain("hidden-1");
      expect(kept).not.toContain("hidden-2");
      expect(kept).toContain("hidden-3");
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

    it("restores the teammate a chat runs as after reload, keeps it when a later record names none, and leaves other chats without one", async () => {
      const storage = makeStorage();
      const first = new AgentSessionIndex(storage, INDEX_PATH);
      await first.recordSession(entry({ teammate: "coco" }));
      await first.recordSession(entry({ lastAccessedAtMs: 9_000 }));
      await first.recordSession(entry({ sessionId: "plain" }));
      await first.flush();
      expect(JSON.parse(storage.files.get(INDEX_PATH)!).entries[0]).toMatchObject({
        teammate: "coco",
      });
      const second = new AgentSessionIndex(storage, INDEX_PATH);
      expect((await second.getEntry("opencode", "s1"))?.teammate).toBe("coco");
      expect((await second.getEntry("opencode", "plain"))?.teammate).toBeUndefined();
    });
  });

  describe("flushOrThrow()", () => {
    it("writes the pending deletion before it resolves", async () => {
      const storage = makeStorage();
      const index = new AgentSessionIndex(storage, INDEX_PATH);
      await index.recordSession(entry());
      await index.deleteSession("opencode", "s1");
      await index.flushOrThrow();
      expect(JSON.parse(storage.files.get(INDEX_PATH)!)).toEqual({
        version: 1,
        entries: [],
        askedConversations: [],
      });
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

    it(`lists the chats of an index file that holds a full section of asked conversations exactly as without it, and never one of the conversations (${ISSUE_980})`, async () => {
      const chats = [entry(), entry({ backendId: "claude", sessionId: "s2", teammate: "coco" })];
      const conversations = Array.from({ length: 100 }, (_, i) => ({
        backendId: "claude",
        sessionId: `maya-hidden-${i}`,
        agent: "maya",
        askedIn: { backendId: "claude", sessionId: "s2" },
        firstAtMs: 1_000 + i,
        lastAtMs: 2_000 + i,
        asks: 1,
        firstAsk: "Is $8k right for the launch?",
      }));
      const withSection = new AgentSessionIndex(
        makeStorage({
          [INDEX_PATH]: JSON.stringify({
            version: 1,
            entries: chats,
            askedConversations: conversations,
          }),
        }),
        INDEX_PATH
      );
      const without = new AgentSessionIndex(
        makeStorage({ [INDEX_PATH]: JSON.stringify({ version: 1, entries: chats }) }),
        INDEX_PATH
      );

      expect(await withSection.getEntries()).toEqual(await without.getEntries());
      expect((await withSection.getEntries()).map((e) => e.sessionId)).toEqual(["s1", "s2"]);
    });
  });
});
