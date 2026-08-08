import { buildNativeChatId, isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
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

describe("native chat id helpers", () => {
  it("round-trips backendId and sessionId, including separators in the session id", () => {
    const id = buildNativeChatId("codex", "abc/def:ghi");
    expect(isNativeChatId(id)).toBe(true);
    expect(parseNativeChatId(id)).toEqual({ backendId: "codex", sessionId: "abc/def:ghi" });
  });

  it("rejects non-native and malformed ids", () => {
    expect(isNativeChatId("chats/agent__foo.md")).toBe(false);
    expect(parseNativeChatId("chats/agent__foo.md")).toBeNull();
    expect(parseNativeChatId("copilot-agent-session://no-separator")).toBeNull();
    expect(parseNativeChatId("copilot-agent-session://backend/")).toBeNull();
  });
});

describe("AgentSessionIndex", () => {
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

  it("recordSession keeps earliest createdAt, latest lastAccessed, and known title", async () => {
    const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
    await index.recordSession(entry({ createdAtMs: 1_000, lastAccessedAtMs: 5_000 }));
    await index.recordSession(entry({ title: null, createdAtMs: 3_000, lastAccessedAtMs: 4_000 }));
    expect(await index.getEntry("opencode", "s1")).toMatchObject({
      title: "Refactor the daily template",
      createdAtMs: 1_000,
      lastAccessedAtMs: 5_000,
    });
  });

  it("deleteSession tombstones the key so discovered sessions stay suppressed", async () => {
    const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
    await index.recordSession(entry());
    await index.deleteSession("opencode", "s1");
    expect(await index.getEntries()).toHaveLength(0);
    expect(await index.isTombstoned("opencode", "s1")).toBe(true);

    await index.mergeDiscoveredSessions([entry()]);
    expect(await index.getEntries()).toHaveLength(0);
  });

  it("recordSession clears a tombstone — live activity reflects fresh intent", async () => {
    const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
    await index.deleteSession("opencode", "s1");
    await index.recordSession(entry());
    expect(await index.isTombstoned("opencode", "s1")).toBe(false);
    expect(await index.getEntries()).toHaveLength(1);
  });

  it("mergeDiscoveredSessions never moves lastAccessed backwards", async () => {
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

  it("setTitle renames an entry and touch bumps recency", async () => {
    const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
    await index.recordSession(entry({ lastAccessedAtMs: 1 }));
    await index.setTitle("opencode", "s1", "Renamed");
    await index.touch("opencode", "s1");
    const updated = await index.getEntry("opencode", "s1");
    expect(updated?.title).toBe("Renamed");
    expect(updated?.lastAccessedAtMs).toBeGreaterThan(1);
  });

  it("a user rename survives discovered-session merges; agent titles stay refreshable", async () => {
    const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
    await index.recordSession(entry({ title: "Agent title", titleSource: "agent" }));
    await index.setTitle("opencode", "s1", "My rename");
    await index.mergeDiscoveredSessions([entry({ title: "Agent title v2" })]);
    expect(await index.getEntry("opencode", "s1")).toMatchObject({
      title: "My rename",
      titleSource: "user",
    });

    // Without a user rename the agent store's fresher title wins.
    await index.recordSession(
      entry({ sessionId: "s2", title: "Agent title", titleSource: "agent" })
    );
    await index.mergeDiscoveredSessions([entry({ sessionId: "s2", title: "Agent title v2" })]);
    expect((await index.getEntry("opencode", "s2"))?.title).toBe("Agent title v2");
  });

  it("a user-sourced live label survives discovered-session merges via recordSession", async () => {
    const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
    // A tab rename on a live session reaches the index through the
    // write-through path (recordSession), not setTitle.
    await index.recordSession(entry({ title: "Tab rename", titleSource: "user" }));
    await index.mergeDiscoveredSessions([entry({ title: "Agent original" })]);
    expect((await index.getEntry("opencode", "s1"))?.title).toBe("Tab rename");
  });

  it("the user title marker round-trips through persistence", async () => {
    const storage = makeStorage();
    const first = new AgentSessionIndex(storage, INDEX_PATH);
    await first.recordSession(entry());
    await first.setTitle("opencode", "s1", "My rename");
    await first.flush();
    const second = new AgentSessionIndex(storage, INDEX_PATH);
    await second.mergeDiscoveredSessions([entry({ title: "Agent original" })]);
    expect((await second.getEntry("opencode", "s1"))?.title).toBe("My rename");
  });

  it("scopes entries to a project; sweeps fill a missing scope but never strip a known one", async () => {
    // Reason: project views filter native entries by the recorded projectId.
    // Write-through (live sessions) is authoritative; a `listSessions` sweep
    // re-discovering the same session arrives without (or with weaker)
    // attribution and must not detach the chat from its project.
    const index = new AgentSessionIndex(makeStorage(), INDEX_PATH);
    await index.recordSession(entry({ projectId: "proj-1" }));
    await index.mergeDiscoveredSessions([entry({ title: "Sweep title", lastAccessedAtMs: 9_000 })]);
    expect((await index.getEntry("opencode", "s1"))?.projectId).toBe("proj-1");

    // A sweep CAN attribute a session the index never saw live (CLI-created
    // inside a project folder).
    await index.mergeDiscoveredSessions([
      entry({ sessionId: "s2", projectId: "proj-2", lastAccessedAtMs: 9_000 }),
    ]);
    expect((await index.getEntry("opencode", "s2"))?.projectId).toBe("proj-2");
  });

  it("the project scope round-trips through persistence", async () => {
    const storage = makeStorage();
    const first = new AgentSessionIndex(storage, INDEX_PATH);
    await first.recordSession(entry({ projectId: "proj-1" }));
    await first.recordSession(entry({ sessionId: "global-chat" }));
    await first.flush();
    const second = new AgentSessionIndex(storage, INDEX_PATH);
    expect((await second.getEntry("opencode", "s1"))?.projectId).toBe("proj-1");
    // Absent scope (a pre-projectId or global entry) stays absent ≙ global.
    expect((await second.getEntry("opencode", "global-chat"))?.projectId).toBeUndefined();
  });

  it("persists across instances via flush and ignores corrupt files", async () => {
    const storage = makeStorage();
    const first = new AgentSessionIndex(storage, INDEX_PATH);
    await first.recordSession(entry());
    await first.deleteSession("codex", "gone");
    await first.flush();
    expect(storage.files.get(INDEX_PATH)).toContain("s1");

    const second = new AgentSessionIndex(storage, INDEX_PATH);
    expect(await second.getEntry("opencode", "s1")).toMatchObject({ sessionId: "s1" });
    expect(await second.isTombstoned("codex", "gone")).toBe(true);

    const corrupt = new AgentSessionIndex(makeStorage({ [INDEX_PATH]: "not json {" }), INDEX_PATH);
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
