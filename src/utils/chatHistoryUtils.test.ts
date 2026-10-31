/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import { fileToHistoryItem, parseChatTimestamp } from "@/utils/chatHistoryUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import type { App, TFile } from "obsidian";

function makeApp(frontmatter: Record<string, unknown>) {
  return {
    metadataCache: {
      getFileCache: jest.fn(() => ({ frontmatter })),
    },
  } as unknown as App;
}

function makeFile(): TFile {
  return {
    path: "test-folder/agent__chat.md",
    basename: "agent__chat",
    stat: { ctime: 1735732800000, mtime: 1735732800000 },
  } as unknown as TFile;
}

describe("chatHistoryUtils", () => {
  describe("fileToHistoryItem()", () => {
    it("builds a history item from the note path and its frontmatter topic, epoch, last access and backend", () => {
      const app = makeApp({
        epoch: 1735732800000,
        topic: "Planning",
        lastAccessedAt: 1735732900000,
        backendId: " codex ",
      });

      const item = fileToHistoryItem(app, makeFile(), new RecentUsageManager<string>());

      expect(item).toEqual({
        id: "test-folder/agent__chat.md",
        title: "Planning",
        createdAt: new Date(1735732800000),
        lastAccessedAt: new Date(1735732900000),
        backendId: "codex",
        projectId: undefined,
      });
    });

    it("extracts a string projectId from frontmatter", () => {
      const app = makeApp({ epoch: 1735732800000, projectId: "proj-123" });
      const item = fileToHistoryItem(app, makeFile(), new RecentUsageManager<string>());
      expect(item.projectId).toBe("proj-123");
    });

    it("coerces a numeric projectId (unquoted YAML) to a string", () => {
      const app = makeApp({ epoch: 1735732800000, projectId: 123 });
      const item = fileToHistoryItem(app, makeFile(), new RecentUsageManager<string>());
      expect(item.projectId).toBe("123");
    });

    it("leaves projectId undefined when absent (no GLOBAL_SCOPE default in this layer)", () => {
      const app = makeApp({ epoch: 1735732800000 });
      const item = fileToHistoryItem(app, makeFile(), new RecentUsageManager<string>());
      expect(item.projectId).toBeUndefined();
    });

    it("treats a blank projectId as undefined", () => {
      const app = makeApp({ epoch: 1735732800000, projectId: "   " });
      const item = fileToHistoryItem(app, makeFile(), new RecentUsageManager<string>());
      expect(item.projectId).toBeUndefined();
    });
  });

  describe("parseChatTimestamp()", () => {
    it("accepts a pin time written as a YAML number", () => {
      expect(parseChatTimestamp(1735733000000)).toBe(1735733000000);
    });

    it("accepts a pin time read back as text from a note outside the metadata cache", () => {
      expect(parseChatTimestamp("1735733000000")).toBe(1735733000000);
    });

    it("treats a missing, non-numeric, zero, or negative value as not pinned", () => {
      expect(parseChatTimestamp(undefined)).toBeUndefined();
      expect(parseChatTimestamp("yesterday")).toBeUndefined();
      expect(parseChatTimestamp(0)).toBeUndefined();
      expect(parseChatTimestamp(-5)).toBeUndefined();
      expect(parseChatTimestamp(true)).toBeUndefined();
    });
  });
});
