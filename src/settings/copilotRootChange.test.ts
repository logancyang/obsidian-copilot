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

const garbageCollectVectorStore = jest.fn<Promise<number>, []>();
jest.mock("@/search/vectorStoreManager", () => ({
  __esModule: true,
  default: { getInstance: () => ({ garbageCollectVectorStore }) },
}));

// Persistence transaction surface. The transaction runner executes its task
// inline so the persist→activate ordering under test is preserved; the durable
// write and suppression are captured so tests can assert order and simulate a
// save failure.
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

/** Minimal App; the plugin lookup is mocked away via getCopilotSaveData. */
const app = { vault: { configDir: ".vault-config" } } as unknown as App;

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
      // "ai-adjacent" must not match the "ai" prefix at a segment boundary.
      expect(copilotRootContainsNotes(app, "ai")).toBe(false);
    });

    it("returns false for an empty candidate root", () => {
      const app = appWithMarkdown(["a.md"]);
      expect(copilotRootContainsNotes(app, "")).toBe(false);
    });

    it("catches a differently-cased folder where the filesystem is case-insensitive", () => {
      // This scan has to agree with the exclusion matcher, which folds case on
      // these platforms. Comparing exact-case would clear `Notes`, and the real
      // `notes/` — the user's own notes — would then be excluded from search:
      // exactly what the warning must disclose.
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
      // On Linux `Notes/` and `notes/` really are two folders, so the candidate
      // holds no notes and must be accepted.
      const app = appWithMarkdown(["notes/private.md"]);
      expect(copilotRootContainsNotes(app, "Notes")).toBe(false);
    });
  });

  describe("findCopilotRootFileConflict()", () => {
    /** Minimal App whose vault cache holds the given file/folder entries. */
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
    it("commits the new root and its protection history in one settings snapshot", async () => {
      seedSettings({ copilotFolder: "ai", copilotRootHistory: ["copilot", "ai"] });

      await applyCopilotRootChange(app, "team-ai");

      const after = getSettings();
      expect(after.copilotFolder).toBe("team-ai");
      // Old + new + legacy roots all survive in the append-only history.
      expect(new Set(after.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("durably persists the new root before activating it in memory", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      // Capture the in-memory root as seen at persist time to prove the durable
      // write happens BEFORE the memory flip.
      let rootWhenPersisted: string | undefined;
      const persistedSnapshots: string[] = [];
      persistSettingsWithinTransaction.mockImplementation((next: unknown) => {
        rootWhenPersisted = getSettings().copilotFolder;
        persistedSnapshots.push((next as CopilotSettings).copilotFolder);
        return Promise.resolve();
      });

      await applyCopilotRootChange(app, "ai");

      expect(rootWhenPersisted).toBe("copilot"); // memory still old at persist time
      expect(persistedSnapshots).toEqual(["ai"]); // durable snapshot carries the new root
      expect(getSettings().copilotFolder).toBe("ai"); // memory flipped only after
      expect(suppressNextPersistOnce).toHaveBeenCalledTimes(1);
    });

    it("preserves a concurrent settings edit in memory across the reconcile", async () => {
      // Reproduces the two-window race: a non-root edit lands during the first
      // persist (triggering reconcile), and another during the second persist.
      // The functional activation update must keep both in memory rather than
      // reverting them to the snapshot captured before they arrived.
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      persistSettingsWithinTransaction
        .mockImplementationOnce(() => {
          // Edit A during the first persist → makes `fresh` differ → reconcile.
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            userSystemPromptsFolder: "edit-A",
          });
          return Promise.resolve();
        })
        .mockImplementationOnce(() => {
          // Edit B during the second (reconcile) persist.
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            defaultSaveFolder: "edit-B",
          });
          return Promise.resolve();
        });

      await applyCopilotRootChange(app, "ai");

      const after = getSettings();
      expect(after.copilotFolder).toBe("ai"); // root change landed
      expect(after.userSystemPromptsFolder).toBe("edit-A"); // first-window edit kept
      expect(after.defaultSaveFolder).toBe("edit-B"); // second-window edit not clobbered
    });

    it("completes the root change even when the reconcile save fails", async () => {
      // The first persist made the root durable — the user-visible operation
      // succeeded. A failing reconcile (which only carries a concurrent edit to
      // disk) must not fail the whole change; the edit stays in memory and
      // lands with the next save.
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      persistSettingsWithinTransaction
        .mockImplementationOnce(() => {
          // Concurrent edit during the first persist → reconcile triggers.
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            userSystemPromptsFolder: "edit-A",
          });
          return Promise.resolve();
        })
        .mockRejectedValueOnce(new Error("reconcile disk full"));

      await expect(applyCopilotRootChange(app, "ai")).resolves.toBeUndefined();

      expect(getSettings().copilotFolder).toBe("ai"); // change completed
      expect(getSettings().userSystemPromptsFolder).toBe("edit-A"); // edit kept in memory
      expect(garbageCollectVectorStore).toHaveBeenCalledTimes(1); // follow-ups ran
    });

    it("keeps the old root and skips GC when the durable save fails", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });
      persistSettingsWithinTransaction.mockRejectedValueOnce(new Error("disk full"));

      await expect(applyCopilotRootChange(app, "ai")).rejects.toThrow("disk full");

      // Save failed before activation, so the in-memory root is untouched and no
      // GC ran — the session keeps writing under the protected old root.
      expect(getSettings().copilotFolder).toBe("copilot");
      expect(getSettings().copilotRootHistory).toEqual(["copilot"]);
      expect(suppressNextPersistOnce).not.toHaveBeenCalled();
      expect(garbageCollectVectorStore).not.toHaveBeenCalled();
    });

    it("triggers a best-effort garbage-collection pass after activating", async () => {
      seedSettings({ copilotFolder: "copilot" });
      await applyCopilotRootChange(app, "ai");
      expect(garbageCollectVectorStore).toHaveBeenCalledTimes(1);
    });

    it("still activates the new root when garbage collection fails", async () => {
      seedSettings({ copilotFolder: "copilot" });
      garbageCollectVectorStore.mockRejectedValueOnce(new Error("index offline"));

      await expect(applyCopilotRootChange(app, "ai")).resolves.toBeUndefined();
      expect(getSettings().copilotFolder).toBe("ai");
    });

    it("does not activate an invalid root or run garbage collection", async () => {
      seedSettings({ copilotFolder: "copilot", copilotRootHistory: ["copilot"] });

      await applyCopilotRootChange(app, "../escape");

      expect(getSettings().copilotFolder).toBe("copilot");
      expect(getSettings().copilotRootHistory).toEqual(["copilot"]);
      expect(persistSettingsWithinTransaction).not.toHaveBeenCalled();
      expect(garbageCollectVectorStore).not.toHaveBeenCalled();
    });
  });
});
