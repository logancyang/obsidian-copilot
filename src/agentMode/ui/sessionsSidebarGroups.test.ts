import {
  filterChatsByTitle,
  groupSessionsSidebarChats,
  pinnedAtAfterMove,
} from "@/agentMode/ui/sessionsSidebarGroups";
import type { ProjectConfig } from "@/aiParams";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/802";
const REORDER_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/811";

// Last use runs opposite to creation, so a list ordered by recency would fail these expectations.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
function chat(
  id: string,
  createdMs: number,
  extra: Partial<ChatHistoryItem> = {}
): ChatHistoryItem {
  return {
    id,
    title: `Title of ${id}`,
    createdAt: new Date(createdMs),
    lastAccessedAt: new Date(100_000 - createdMs),
    ...extra,
  };
}

function project(id: string, created = 1_000): ProjectConfig {
  return { id, name: `Project ${id}`, created } as ProjectConfig;
}

describe("sessionsSidebarGroups", () => {
  describe("groupSessionsSidebarChats()", () => {
    it(`puts chats without a project into Recents, newest created first even when an older chat was used more recently (${ISSUE})`, () => {
      const groups = groupSessionsSidebarChats(
        [chat("old", 1_000), chat("new", 3_000), chat("mid", 2_000)],
        []
      );

      expect(groups.recents.map((item) => item.id)).toEqual(["new", "mid", "old"]);
      expect(groups.pinned).toEqual([]);
      expect(groups.projects).toEqual([]);
    });

    it(`groups project chats under their project, newest created first, with projects newest created first (${ISSUE})`, () => {
      const groups = groupSessionsSidebarChats(
        [
          chat("a-old", 1_000, { projectId: "a" }),
          chat("b-1", 2_000, { projectId: "b" }),
          chat("a-new", 3_000, { projectId: "a" }),
        ],
        [project("a", 1_000), project("b", 2_000)]
      );

      expect(
        groups.projects.map((group) => [group.project.id, group.chats.map((c) => c.id)])
      ).toEqual([
        ["b", ["b-1"]],
        ["a", ["a-new", "a-old"]],
      ]);
      expect(groups.recents).toEqual([]);
    });

    it("keeps a project that has no chats yet", () => {
      const groups = groupSessionsSidebarChats([], [project("empty")]);

      expect(groups.projects).toEqual([{ project: project("empty"), chats: [] }]);
    });

    it(`lists a pinned project chat only in Pinned, not under its project (${ISSUE})`, () => {
      const groups = groupSessionsSidebarChats(
        [
          chat("pinned-project-chat", 1_000, { projectId: "a", pinnedAt: 10 }),
          chat("other", 2_000, { projectId: "a" }),
        ],
        [project("a")]
      );

      expect(groups.pinned.map((item) => item.id)).toEqual(["pinned-project-chat"]);
      expect(groups.projects[0].chats.map((item) => item.id)).toEqual(["other"]);
    });

    it("orders Pinned by pin time, most recently pinned first", () => {
      const groups = groupSessionsSidebarChats(
        [
          chat("pinned-first", 9_000, { pinnedAt: 10 }),
          chat("pinned-last", 1_000, { pinnedAt: 20 }),
          chat("unpinned", 5_000),
        ],
        []
      );

      expect(groups.pinned.map((item) => item.id)).toEqual(["pinned-last", "pinned-first"]);
      expect(groups.recents.map((item) => item.id)).toEqual(["unpinned"]);
    });

    it(`orders projects by the stored drag order instead of creation time (${REORDER_ISSUE})`, () => {
      const groups = groupSessionsSidebarChats(
        [],
        [project("a", 1_000), project("b", 2_000), project("c", 3_000)],
        ["a", "c", "b"]
      );

      expect(groups.projects.map((group) => group.project.id)).toEqual(["a", "c", "b"]);
    });

    it(`puts projects missing from the stored order first, newest created first, and ignores stored ids of deleted projects (${REORDER_ISSUE})`, () => {
      const groups = groupSessionsSidebarChats(
        [],
        [project("placed", 1_000), project("new-old", 2_000), project("new-new", 3_000)],
        ["deleted", "placed"]
      );

      expect(groups.projects.map((group) => group.project.id)).toEqual([
        "new-new",
        "new-old",
        "placed",
      ]);
    });

    it(`lists a chat of a project that no longer exists in Recents so it stays reachable (${ISSUE})`, () => {
      const groups = groupSessionsSidebarChats(
        [chat("orphan", 1_000, { projectId: "deleted" })],
        [project("a")]
      );

      expect(groups.recents.map((item) => item.id)).toEqual(["orphan"]);
    });
  });

  describe("pinnedAtAfterMove()", () => {
    const pinned = [
      chat("top", 1_000, { pinnedAt: 400 }),
      chat("middle", 1_000, { pinnedAt: 300 }),
      chat("bottom", 1_000, { pinnedAt: 100 }),
    ];

    it(`returns a pin time between the new neighbours of a chat moved inside the list (${REORDER_ISSUE})`, () => {
      expect(pinnedAtAfterMove(pinned, 0, 1)).toBe(200);
    });

    it(`returns a pin time just above the first chat for a chat moved to the top (${REORDER_ISSUE})`, () => {
      expect(pinnedAtAfterMove(pinned, 2, 0)).toBe(401);
    });

    it(`returns a pin time just below the last chat for a chat moved to the bottom (${REORDER_ISSUE})`, () => {
      expect(pinnedAtAfterMove(pinned, 0, 2)).toBe(99);
    });

    it(`places the moved chat at its drop position once Pinned is sorted by the returned time (${REORDER_ISSUE})`, () => {
      const moved = pinned.map((item) =>
        item.id === "bottom" ? { ...item, pinnedAt: pinnedAtAfterMove(pinned, 2, 1) } : item
      );

      expect(groupSessionsSidebarChats(moved, []).pinned.map((item) => item.id)).toEqual([
        "top",
        "bottom",
        "middle",
      ]);
    });
  });

  describe("filterChatsByTitle()", () => {
    const items = [
      chat("one", 1_000, { title: "Plan the fall launch" }),
      chat("two", 3_000, { title: "Refactor importer", projectId: "a" }),
      chat("three", 2_000, { title: "Launch checklist", pinnedAt: 5 }),
    ];

    it("returns the chats whose title contains the query, ignoring case, newest created first", () => {
      expect(filterChatsByTitle(items, "LAUNCH").map((item) => item.id)).toEqual(["three", "one"]);
    });

    it("matches across pinned, project and recent chats alike", () => {
      expect(filterChatsByTitle(items, "a").map((item) => item.id)).toEqual([
        "two",
        "three",
        "one",
      ]);
    });

    it("returns nothing when no title matches", () => {
      expect(filterChatsByTitle(items, "zebra")).toEqual([]);
    });

    it("ignores surrounding whitespace in the query", () => {
      expect(filterChatsByTitle(items, "  importer ").map((item) => item.id)).toEqual(["two"]);
    });
  });
});
