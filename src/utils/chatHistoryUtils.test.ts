/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
import { extractChatTitle, fileToHistoryItem, parseChatTimestamp } from "@/utils/chatHistoryUtils";
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

  describe("extractChatTitle()", () => {
    function noteNamed(basename: string): TFile {
      return { path: `test-folder/${basename}.md`, basename } as unknown as TFile;
    }

    it("uses the note's topic as the title", () => {
      const app = makeApp({ topic: " Planning ", projectId: "proj-123" });
      expect(extractChatTitle(app, noteNamed("agent__20260101_120000__Write_a_poem"))).toBe(
        "Planning"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/815 uses the agentLabel of an Agent Mode note saved with no topic", () => {
      const app = makeApp({ agentLabel: "Garden planting schedule" });
      expect(extractChatTitle(app, noteNamed("agent__20260101_120000__Plan_the_garden"))).toBe(
        "Garden planting schedule"
      );
    });

    it("derives a global chat's title from its filename without the agent prefix, date and time", () => {
      const app = makeApp({});
      expect(extractChatTitle(app, noteNamed("agent__20260101_120000__Write_a_poem"))).toBe(
        "Write a poem"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/809 derives an untitled Agent Mode project chat's title without the agent prefix", () => {
      const app = makeApp({ projectId: "proj-123" });
      expect(extractChatTitle(app, noteNamed("agent__20260101_120000__Write_a_poem"))).toBe(
        "Write a poem"
      );
    });

    it("derives a legacy project chat's title without its project id prefix", () => {
      const app = makeApp({ projectId: "My project" });
      expect(extractChatTitle(app, noteNamed("My project__20260101_120000__Write_a_poem"))).toBe(
        "Write a poem"
      );
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
