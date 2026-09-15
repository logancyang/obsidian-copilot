import { lockedCopilotEntries, shouldPreviewCopilotModels } from "./lockedCopilotEntries";

import type { CopilotSettings } from "@/settings/model";

function providerRows(providers: Record<string, unknown>): CopilotSettings["providers"] {
  return providers as unknown as CopilotSettings["providers"];
}

/** A cached lineup where only some models are switched on by a license. */
const CATALOG: CopilotSettings["copilotPlusCatalog"] = {
  models: [
    { id: "copilot-plus-flash", displayName: "Copilot Plus Flash", description: "The default." },
    { id: "glm-5.2", displayName: "GLM-5.2", description: "Frontier open weights." },
    { id: "kimi-k2.6", displayName: "Kimi K2.6", description: "Long-running reasoning." },
  ],
  defaultEnabledIds: ["copilot-plus-flash", "glm-5.2"],
};

const EMPTY_CATALOG: CopilotSettings["copilotPlusCatalog"] = {
  models: [],
  defaultEnabledIds: [],
};

describe("lockedCopilotEntries", () => {
  describe("shouldPreviewCopilotModels()", () => {
    it("previews when no Copilot provider is registered", () => {
      expect(shouldPreviewCopilotModels(providerRows({}))).toBe(true);
      expect(
        shouldPreviewCopilotModels(
          providerRows({ "byok-1": { providerId: "byok-1", origin: { kind: "byok" } } })
        )
      ).toBe(true);
    });

    it("stops previewing once the Copilot provider is registered, so locked copies never sit beside working models", () => {
      expect(
        shouldPreviewCopilotModels(
          providerRows({
            "plus-1": { providerId: "plus-1", origin: { kind: "copilot-plus" } },
          })
        )
      ).toBe(false);
    });
  });

  describe("lockedCopilotEntries()", () => {
    it("previews exactly the models a license switches on, in lineup order", () => {
      const previewed = lockedCopilotEntries(CATALOG).map((entry) => entry.name);

      expect(previewed).toEqual(["copilot-plus-flash", "glm-5.2"]);
      // Narrowing to that subset is the point: a full lineup would push the
      // user's own models past the fold of a 288px picker.
      expect(previewed.length).toBeLessThan(CATALOG.models.length);
    });

    it("advertises nothing before the first lineup has been cached (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      // Better an absent preview than one naming models the service may have
      // withdrawn, which is what a client-side lineup would give.
      expect(lockedCopilotEntries(EMPTY_CATALOG)).toEqual([]);
    });

    it("follows the cached lineup, so a withdrawn model stops being advertised (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      const withdrawn: CopilotSettings["copilotPlusCatalog"] = {
        models: CATALOG.models.filter((model) => model.id !== "glm-5.2"),
        defaultEnabledIds: CATALOG.defaultEnabledIds,
      };

      expect(lockedCopilotEntries(withdrawn).map((entry) => entry.name)).toEqual([
        "copilot-plus-flash",
      ]);
    });

    it("marks every row as needing a license and as non-selectable", () => {
      const entries = lockedCopilotEntries(CATALOG);

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry._needsLicense).toBe(true);
        // `_disabledReason` is what actually disables the row; the lock explains it.
        expect(entry._disabledReason).toBe("Copilot license required");
        expect(entry.enabled).toBe(true);
      }
    });

    it("carries each model's display name and description so the row says what it is for", () => {
      const flash = lockedCopilotEntries(CATALOG)[0];

      expect(flash.displayName).toBe("Copilot Plus Flash");
      expect(flash._subtitle).toBe("The default.");
    });

    it("files rows under a group and backend when one is given, and leaves them flat otherwise", () => {
      const grouped = lockedCopilotEntries(CATALOG, {
        group: "OpenCode",
        backendId: "opencode",
      });
      const flat = lockedCopilotEntries(CATALOG);

      expect(grouped.every((entry) => entry._group === "OpenCode")).toBe(true);
      expect(grouped.every((entry) => entry._backendId === "opencode")).toBe(true);
      expect(flat.every((entry) => entry._group === undefined)).toBe(true);
      expect(flat.every((entry) => entry._backendId === undefined)).toBe(true);
    });
  });
});
