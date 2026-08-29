import type { ModelInfo } from "@/modelManagement";
import {
  findCopilotPlusModel,
  lockedCopilotEntries,
  shouldPreviewCopilotModels,
} from "./lockedCopilotEntries";

import type { CopilotSettings } from "@/settings/model";

function providerRows(providers: Record<string, unknown>): CopilotSettings["providers"] {
  return providers as unknown as CopilotSettings["providers"];
}

const LIVE_MODELS: readonly ModelInfo[] = Object.freeze([
  { id: "tomorrow-one", displayName: "Tomorrow One", description: "First live model" },
  { id: "tomorrow-two", displayName: "Tomorrow Two", description: "Second live model" },
  { id: "tomorrow-three", displayName: "Tomorrow Three" },
  { id: "tomorrow-four", displayName: "Tomorrow Four" },
]);

describe("lockedCopilotEntries", () => {
  describe("findCopilotPlusModel()", () => {
    it("resolves raw and agent-routed Plus ids without matching unrelated models (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      expect(findCopilotPlusModel("tomorrow-one", LIVE_MODELS)?.displayName).toBe("Tomorrow One");
      expect(findCopilotPlusModel("copilot-plus/tomorrow-one", LIVE_MODELS)?.displayName).toBe(
        "Tomorrow One"
      );
      expect(findCopilotPlusModel("openai/tomorrow-one-like", LIVE_MODELS)).toBeUndefined();
      expect(findCopilotPlusModel("openrouter/tomorrow-one", LIVE_MODELS)).toBeUndefined();
    });
  });

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
    it("previews the first three live endpoint models in server order (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      const previewed = lockedCopilotEntries(LIVE_MODELS).map((entry) => entry.name);

      expect(previewed).toEqual(["tomorrow-one", "tomorrow-two", "tomorrow-three"]);
      // The cap is the point: a full lineup would push the user's own models
      // past the fold of a 288px picker.
      expect(previewed.length).toBeLessThan(LIVE_MODELS.length);
    });

    it("marks every row as needing a license and as non-selectable", () => {
      const entries = lockedCopilotEntries(LIVE_MODELS);

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry._needsLicense).toBe(true);
        // `_disabledReason` is what actually disables the row; the lock explains it.
        expect(entry._disabledReason).toBe("Copilot license required");
        expect(entry.enabled).toBe(true);
      }
    });

    it("carries each model's display name and description so the row says what it is for", () => {
      const first = lockedCopilotEntries(LIVE_MODELS)[0];
      const source = LIVE_MODELS.find((model) => model.id === first.name);

      expect(first.displayName).toBe(source?.displayName);
      expect(first._subtitle).toBe(source?.description);
    });

    it("files rows under a group and backend when one is given, and leaves them flat otherwise", () => {
      const grouped = lockedCopilotEntries(LIVE_MODELS, {
        group: "OpenCode",
        backendId: "opencode",
      });
      const flat = lockedCopilotEntries(LIVE_MODELS);

      expect(grouped.every((entry) => entry._group === "OpenCode")).toBe(true);
      expect(grouped.every((entry) => entry._backendId === "opencode")).toBe(true);
      expect(flat.every((entry) => entry._group === undefined)).toBe(true);
      expect(flat.every((entry) => entry._backendId === undefined)).toBe(true);
    });
  });
});
