import { DEFAULT_SETTINGS } from "@/constants";
import {
  applyCopilotRootChange,
  copilotRootContainsNotes,
  findCopilotRootFileConflict,
} from "@/settings/copilotRootChange";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import { getSettings, settingsAtom, settingsStore, type CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";
import * as obsidian from "obsidian";

const persistSettingsWithinTransaction = jest.fn<Promise<void>, unknown[]>();
const suppressNextPersistOnce = jest.fn<void, []>();
jest.mock("@/services/settingsPersistence", () => ({
  runPersistenceTransaction: (task: () => Promise<void>) => task(),
  persistSettingsWithinTransaction: async (...args: unknown[]) => {
    await persistSettingsWithinTransaction(...args);
  },
  suppressNextPersistOnce: () => suppressNextPersistOnce(),
}));

const saveData = jest.fn<Promise<void>, unknown[]>();
jest.mock("@/settings/copilotSaveData", () => ({
  getCopilotSaveData: () => saveData,
}));

const app = { vault: { configDir: ".vault-config" } } as unknown as App;

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
    persistSettingsWithinTransaction.mockResolvedValue(undefined);
    saveData.mockResolvedValue(undefined);
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
      expect(copilotRootContainsNotes(app, "ai")).toBe(false);
    });

    it("returns false for an empty candidate root", () => {
      const app = appWithMarkdown(["a.md"]);
      expect(copilotRootContainsNotes(app, "")).toBe(false);
    });

    it("catches a differently-cased folder where the filesystem is case-insensitive", () => {
      const platform = obsidian.Platform as { isMacOS: boolean };
      const previous = platform.isMacOS;
      platform.isMacOS = true;
      try {
        const app = appWithMarkdown(["notes/private.md"]);
        expect(copilotRootContainsNotes(app, "Notes")).toBe(true);
      } finally {
        platform.isMacOS = previous;
      }
    });

    it("treats a differently-cased folder as distinct where the filesystem is case-sensitive", () => {
      const app = appWithMarkdown(["notes/private.md"]);
      expect(copilotRootContainsNotes(app, "Notes")).toBe(false);
    });
  });

  describe("findCopilotRootFileConflict()", () => {
    function appWithEntries(entries: Record<string, "file" | "folder">): App {
      return {
        vault: {
          getAbstractFileByPath: (path: string) => {
            const kind = entries[path];
            if (kind === "file") return mockTFile({ path });
            if (kind === "folder") return mockTFolder({ path });
            return null;
          },
        },
      } as unknown as App;
    }

    it("returns the root itself when it exists as a file", () => {
      const app = appWithEntries({ "ai.txt": "file" });
      expect(findCopilotRootFileConflict(app, "ai.txt")).toBe("ai.txt");
    });

    it("returns the first ancestor that exists as a file", () => {
      const app = appWithEntries({ team: "file" });
      expect(findCopilotRootFileConflict(app, "team/ai")).toBe("team");
    });

    it("returns null when every existing prefix is a folder", () => {
      const app = appWithEntries({ team: "folder", "team/ai": "folder" });
      expect(findCopilotRootFileConflict(app, "team/ai")).toBeNull();
    });

    it("returns null when nothing exists at any prefix yet", () => {
      const app = appWithEntries({});
      expect(findCopilotRootFileConflict(app, "brand/new/root")).toBeNull();
    });

    it("returns null for an empty candidate root", () => {
      const app = appWithEntries({});
      expect(findCopilotRootFileConflict(app, "")).toBeNull();
    });
  });

  describe("applyCopilotRootChange()", () => {
    it("commits the new root and appends it to the root history", async () => {
      seedSettings({
        enableMiyo: true,
        copilotFolder: "ai",
        copilotRootHistory: ["copilot", "ai"],
      });

      await applyCopilotRootChange(app, "team-ai");

      const after = getSettings();
      expect(after.copilotFolder).toBe("team-ai");
      expect(new Set(after.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("durably persists the new root before activating it in memory", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      let rootWhenPersisted: string | undefined;
      const persistedSnapshots: string[] = [];
      persistSettingsWithinTransaction.mockImplementation((next: unknown) => {
        rootWhenPersisted = getSettings().copilotFolder;
        persistedSnapshots.push((next as CopilotSettings).copilotFolder);
        return Promise.resolve();
      });

      await applyCopilotRootChange(app, "ai");

      expect(rootWhenPersisted).toBe("copilot");
      expect(persistedSnapshots).toEqual(["ai"]);
      expect(getSettings().copilotFolder).toBe("ai");
      expect(suppressNextPersistOnce).toHaveBeenCalledTimes(1);
    });

    it("preserves a concurrent settings edit in memory across the reconcile", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      persistSettingsWithinTransaction
        .mockImplementationOnce(() => {
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            userSystemPromptsFolder: "edit-A",
          });
          return Promise.resolve();
        })
        .mockImplementationOnce(() => {
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            defaultSaveFolder: "edit-B",
          });
          return Promise.resolve();
        });

      await applyCopilotRootChange(app, "ai");

      const after = getSettings();
      expect(after.copilotFolder).toBe("ai");
      expect(after.userSystemPromptsFolder).toBe("edit-A");
      expect(after.defaultSaveFolder).toBe("edit-B");
    });

    it("completes the root change even when the reconcile save fails", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      persistSettingsWithinTransaction
        .mockImplementationOnce(() => {
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            userSystemPromptsFolder: "edit-A",
          });
          return Promise.resolve();
        })
        .mockRejectedValueOnce(new Error("reconcile disk full"));

      await expect(applyCopilotRootChange(app, "ai")).resolves.toBeUndefined();

      expect(getSettings().copilotFolder).toBe("ai");
      expect(getSettings().userSystemPromptsFolder).toBe("edit-A");
    });

    it("keeps the old root when the durable save fails", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      persistSettingsWithinTransaction.mockRejectedValueOnce(new Error("disk full"));

      await expect(applyCopilotRootChange(app, "ai")).rejects.toThrow("disk full");

      expect(getSettings().copilotFolder).toBe("copilot");
      expect(getSettings().copilotRootHistory).toEqual(["copilot"]);
      expect(suppressNextPersistOnce).not.toHaveBeenCalled();
    });

    it("does not activate an invalid root", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });

      await applyCopilotRootChange(app, "../escape");

      expect(getSettings().copilotFolder).toBe("copilot");
      expect(getSettings().copilotRootHistory).toEqual(["copilot"]);
      expect(persistSettingsWithinTransaction).not.toHaveBeenCalled();
    });
  });
});
