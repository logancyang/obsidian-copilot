import { CopilotPlusUsageReader, planUsageFromCopilotPlusUsage } from "./copilotPlusUsage";
import type { CopilotPlusCatalogSnapshot } from "@/modelManagement";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockGetUsage = jest.fn();
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      getUsage: (...args: unknown[]) => mockGetUsage(...args),
    }),
  },
}));

describe("copilotPlusUsage", () => {
  beforeEach(() => {
    mockGetUsage.mockReset();
  });

  describe("planUsageFromCopilotPlusUsage()", () => {
    it("normalizes both windows, converting resetsAt from epoch seconds to milliseconds", () => {
      const reading = planUsageFromCopilotPlusUsage(
        {
          used: {
            five_hour: { usedPercent: 12, resetsAt: 1_755_300_000 },
            weekly: { usedPercent: 34, resetsAt: 1_755_700_000 },
          },
        },
        9_000
      );

      expect(reading).toEqual({
        kind: "usage",
        planUsage: {
          windows: [
            { id: "five_hour", label: "5h", percent: 12, resetsAt: 1_755_300_000_000 },
            { id: "weekly", label: "Weekly", percent: 34, resetsAt: 1_755_700_000_000 },
          ],
          updatedAt: 9_000,
        },
      });
    });

    it("keeps a window whose reset time is missing, without one of its own", () => {
      const reading = planUsageFromCopilotPlusUsage({ used: { weekly: { usedPercent: 5 } } }, 1);

      expect(reading).toEqual({
        kind: "usage",
        planUsage: {
          windows: [{ id: "weekly", label: "Weekly", percent: 5, resetsAt: undefined }],
          updatedAt: 1,
        },
      });
    });

    it("passes a percentage above 100 through unclamped — the account is genuinely over", () => {
      const reading = planUsageFromCopilotPlusUsage({ used: { weekly: { usedPercent: 137 } } }, 1);

      expect(reading).toMatchObject({
        kind: "usage",
        planUsage: { windows: [expect.objectContaining({ percent: 137 })] },
      });
    });

    it.each([
      ["a null snapshot", null],
      ["a snapshot with no used block", {}],
      ["windows the normalizer does not recognize", { used: { daily: { usedPercent: 3 } } }],
      ["windows without a readable percent", { used: { weekly: { usedPercent: "12" } } }],
    ])(
      "reports %s unusable rather than clearing the meters (https://github.com/logancyang/obsidian-copilot-preview/issues/193)",
      (_label, snapshot) => {
        // The endpoint omits a window both when the plan does not cap it and when the
        // counters cannot be read. The two are indistinguishable, so neither may clear
        // a meter the user is looking at.
        expect(planUsageFromCopilotPlusUsage(snapshot as never)).toEqual({ kind: "unavailable" });
      }
    );
  });

  describe("CopilotPlusUsageReader", () => {
    it("reads plan usage through the Brevilabs client", async () => {
      mockGetUsage.mockResolvedValue({ used: { weekly: { usedPercent: 21 } } });

      const reading = await new CopilotPlusUsageReader(() => undefined).readPlanUsage();

      expect(reading).toMatchObject({
        kind: "usage",
        planUsage: { windows: [expect.objectContaining({ id: "weekly", percent: 21 })] },
      });
    });

    it("answers context windows from the plugin lifecycle catalog (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const catalog: CopilotPlusCatalogSnapshot = {
        status: "ready",
        models: [
          { id: "gemini-3-pro", displayName: "Gemini", limits: { context: 1_048_576 } },
          { id: "kimi-k2", displayName: "Kimi", limits: { context: 262_144 } },
          { id: "no-window-published", displayName: "No window" },
        ],
      };
      const getCatalog = jest.fn(() => catalog);
      const reader = new CopilotPlusUsageReader(getCatalog);

      await expect(reader.readContextWindow("gemini-3-pro")).resolves.toBe(1_048_576);
      await expect(reader.readContextWindow("kimi-k2")).resolves.toBe(262_144);
      await expect(reader.readContextWindow("no-window-published")).resolves.toBeNull();
      await expect(reader.readContextWindow("not-in-catalog")).resolves.toBeNull();
      expect(getCatalog).toHaveBeenCalledTimes(4);
    });

    it("answers null for a null model id without reading the catalog", async () => {
      // Null is the caller saying "not a Copilot Plus model" — its backend-specific
      // prefix did not match — so there is nothing to look up.
      const getCatalog = jest.fn((): CopilotPlusCatalogSnapshot | undefined => undefined);
      await expect(
        new CopilotPlusUsageReader(getCatalog).readContextWindow(null)
      ).resolves.toBeNull();
      expect(getCatalog).not.toHaveBeenCalled();
    });

    it("answers null while the one lifecycle catalog is unavailable (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const reader = new CopilotPlusUsageReader(() => ({ status: "error", models: [] }));

      await expect(reader.readContextWindow("gemini-3-pro")).resolves.toBeNull();
    });
  });
});
