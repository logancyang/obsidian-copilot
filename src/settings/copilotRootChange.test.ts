import { DEFAULT_SETTINGS } from "@/constants";
import {
  applyCopilotRootChange,
  copilotRootContainsNotes,
  isKnownCopilotRoot,
} from "@/settings/copilotRootChange";
import { getSettings, settingsAtom, settingsStore, type CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";

const garbageCollectVectorStore = jest.fn<Promise<number>, []>();
jest.mock("@/search/vectorStoreManager", () => ({
  __esModule: true,
  default: { getInstance: () => ({ garbageCollectVectorStore }) },
}));

/** Minimal App whose vault reports the given Markdown file paths. */
function appWithMarkdown(paths: string[]): App {
  return {
    vault: { getMarkdownFiles: () => paths.map((path) => ({ path })) },
  } as unknown as App;
}

function seedSettings(partial: Partial<CopilotSettings>): void {
  settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, ...partial });
}

describe("copilotRootChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    garbageCollectVectorStore.mockResolvedValue(0);
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS });
  });

  describe("copilotRootContainsNotes()", () => {
    it("returns true when a Markdown file lives directly under the target root", () => {
      const app = appWithMarkdown(["ai/note.md", "other/x.md"]);
      expect(copilotRootContainsNotes(app, "ai")).toBe(true);
    });

    it("returns true for a nested Markdown file under the target root", () => {
      const app = appWithMarkdown(["ai/sub/deep.md"]);
      expect(copilotRootContainsNotes(app, "ai")).toBe(true);
    });

    it("returns false when no Markdown file is at or under the target root", () => {
      const app = appWithMarkdown(["notes/a.md", "ai-adjacent/b.md"]);
      // "ai-adjacent" must not match the "ai" prefix at a segment boundary.
      expect(copilotRootContainsNotes(app, "ai")).toBe(false);
    });

    it("returns false for an empty candidate root", () => {
      const app = appWithMarkdown(["a.md"]);
      expect(copilotRootContainsNotes(app, "")).toBe(false);
    });
  });

  describe("isKnownCopilotRoot()", () => {
    it("returns true for a root recorded in the history", () => {
      expect(isKnownCopilotRoot("ai", ["copilot", "ai"])).toBe(true);
    });

    it("matches a root against the history in canonical form despite trailing slashes", () => {
      expect(isKnownCopilotRoot("ai/", ["copilot", "ai"])).toBe(true);
    });

    it("returns false for a root absent from the history", () => {
      expect(isKnownCopilotRoot("new-root", ["copilot", "ai"])).toBe(false);
    });

    it("returns false for an empty candidate root", () => {
      expect(isKnownCopilotRoot("", ["copilot", "ai"])).toBe(false);
    });

    it("returns false against an empty history", () => {
      expect(isKnownCopilotRoot("ai", [])).toBe(false);
    });
  });

  describe("applyCopilotRootChange()", () => {
    it("commits the new root and its protection history in one settings snapshot", async () => {
      seedSettings({ copilotFolder: "ai", copilotRootHistory: ["copilot", "ai"] });

      await applyCopilotRootChange("team-ai");

      const after = getSettings();
      expect(after.copilotFolder).toBe("team-ai");
      // Old + new + legacy roots all survive in the append-only history.
      expect(new Set(after.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("triggers a best-effort garbage-collection pass after activating", async () => {
      seedSettings({ copilotFolder: "copilot" });
      await applyCopilotRootChange("ai");
      expect(garbageCollectVectorStore).toHaveBeenCalledTimes(1);
    });

    it("still activates the new root when garbage collection fails", async () => {
      seedSettings({ copilotFolder: "copilot" });
      garbageCollectVectorStore.mockRejectedValueOnce(new Error("index offline"));

      await expect(applyCopilotRootChange("ai")).resolves.toBeUndefined();
      expect(getSettings().copilotFolder).toBe("ai");
    });

    it("does not activate an invalid root or run garbage collection", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });

      await applyCopilotRootChange("../escape");

      expect(getSettings().copilotFolder).toBe("copilot");
      expect(getSettings().copilotRootHistory).toEqual(["copilot"]);
      expect(garbageCollectVectorStore).not.toHaveBeenCalled();
    });
  });
});
