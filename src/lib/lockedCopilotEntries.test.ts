import { COPILOT_PLUS_DEFAULT_ENABLED_MODELS, COPILOT_PLUS_MODELS } from "@/modelManagement";
import { lockedCopilotEntries, shouldPreviewCopilotModels } from "./lockedCopilotEntries";

import type { CopilotSettings } from "@/settings/model";

function providerRows(providers: Record<string, unknown>): CopilotSettings["providers"] {
  return providers as unknown as CopilotSettings["providers"];
}

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
      const previewed = lockedCopilotEntries().map((entry) => entry.name);

      expect(previewed).toEqual(
        COPILOT_PLUS_MODELS.filter((model) =>
          COPILOT_PLUS_DEFAULT_ENABLED_MODELS.includes(model.id)
        ).map((model) => model.id)
      );
      // The cap is the point: a full lineup would push the user's own models
      // past the fold of a 288px picker.
      expect(previewed.length).toBeLessThan(COPILOT_PLUS_MODELS.length);
    });

    it("marks every row as needing a license and as non-selectable", () => {
      const entries = lockedCopilotEntries();

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry._needsLicense).toBe(true);
        // `_disabledReason` is what actually disables the row; the lock explains it.
        expect(entry._disabledReason).toBe("Copilot license required");
        expect(entry.enabled).toBe(true);
      }
    });

    it("carries each model's display name and description so the row says what it is for", () => {
      const flash = lockedCopilotEntries()[0];
      const source = COPILOT_PLUS_MODELS.find((model) => model.id === flash.name);

      expect(flash.displayName).toBe(source?.displayName);
      expect(flash._subtitle).toBe(source?.description);
    });

    it("files rows under a group and backend when one is given, and leaves them flat otherwise", () => {
      const grouped = lockedCopilotEntries({ group: "OpenCode", backendId: "opencode" });
      const flat = lockedCopilotEntries();

      expect(grouped.every((entry) => entry._group === "OpenCode")).toBe(true);
      expect(grouped.every((entry) => entry._backendId === "opencode")).toBe(true);
      expect(flat.every((entry) => entry._group === undefined)).toBe(true);
      expect(flat.every((entry) => entry._backendId === undefined)).toBe(true);
    });
  });
});
