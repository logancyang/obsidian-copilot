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
    it("previews only the default Copilot model, so the offer costs one picker row", () => {
      // Every extra row pushes the checkmark on the user's own model toward the
      // fold of a 288px picker, and one row makes the offer just as well.
      expect(lockedCopilotEntries(CATALOG).map((entry) => entry.name)).toEqual([
        "copilot-plus-flash",
      ]);
    });

    it("advertises nothing before the first lineup has been cached (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      // Better an absent preview than one naming models the service may have
      // withdrawn, which is what a client-side lineup would give.
      expect(lockedCopilotEntries(EMPTY_CATALOG)).toEqual([]);
    });

    it("falls back to the first model a license switches on when the lineup no longer carries the default (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      const withdrawn: CopilotSettings["copilotPlusCatalog"] = {
        models: CATALOG.models.filter((model) => model.id !== "copilot-plus-flash"),
        defaultEnabledIds: CATALOG.defaultEnabledIds,
      };

      expect(lockedCopilotEntries(withdrawn).map((entry) => entry.name)).toEqual(["glm-5.2"]);
    });

    it("never previews a model a license leaves switched off", () => {
      const noneEnabled: CopilotSettings["copilotPlusCatalog"] = {
        models: CATALOG.models,
        defaultEnabledIds: [],
      };

      expect(lockedCopilotEntries(noneEnabled)).toEqual([]);
    });

    it("marks the row as needing a license and as non-selectable", () => {
      const [row] = lockedCopilotEntries(CATALOG);

      expect(row._needsLicense).toBe(true);
      // `_disabledReason` is what actually disables the row; the lock explains it.
      expect(row._disabledReason).toBe("Copilot license required");
      expect(row.enabled).toBe(true);
    });

    it("carries the model's display name and description so the row says what it is for", () => {
      const [row] = lockedCopilotEntries(CATALOG);

      expect(row.displayName).toBe("Copilot Plus Flash");
      expect(row._subtitle).toBe("The default.");
    });

    it("files the row under a group and backend when one is given, and leaves it flat otherwise", () => {
      const [grouped] = lockedCopilotEntries(CATALOG, {
        group: "OpenCode",
        backendId: "opencode",
      });
      const [flat] = lockedCopilotEntries(CATALOG);

      expect(grouped._group).toBe("OpenCode");
      expect(grouped._backendId).toBe("opencode");
      expect(flat._group).toBeUndefined();
      expect(flat._backendId).toBeUndefined();
    });
  });
});
