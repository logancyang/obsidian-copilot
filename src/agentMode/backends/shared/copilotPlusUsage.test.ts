import { resetSettings, setSettings } from "@/settings/model";
import { CopilotPlusUsageReader, planUsageFromCopilotPlusUsage } from "./copilotPlusUsage";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockGetUsage = jest.fn();
const mockGetModels = jest.fn();
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      getUsage: (...args: unknown[]) => mockGetUsage(...args),
      getModels: (...args: unknown[]) => mockGetModels(...args),
    }),
  },
}));

describe("copilotPlusUsage", () => {
  beforeEach(() => {
    mockGetUsage.mockReset();
    mockGetModels.mockReset();
    resetSettings();
    // `resetSettings` deliberately preserves this cache in production.
    setSettings({ copilotPlusCatalog: { models: [], defaultEnabledIds: [] } });
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
    describe("readPlanUsage()", () => {
      it("reads plan usage through the Brevilabs client", async () => {
        // Caps change as the account is used, so unlike context windows they
        // cannot come from a cache.
        mockGetUsage.mockResolvedValue({ used: { weekly: { usedPercent: 21 } } });

        const reading = await new CopilotPlusUsageReader().readPlanUsage();

        expect(reading).toMatchObject({
          kind: "usage",
          planUsage: { windows: [expect.objectContaining({ id: "weekly", percent: 21 })] },
        });
      });
    });

    describe("readContextWindow()", () => {
      beforeEach(() => {
        setSettings({
          copilotPlusCatalog: {
            models: [
              { id: "gemini-3-pro", displayName: "Gemini 3 Pro", limits: { context: 1_048_576 } },
              { id: "kimi-k2", displayName: "Kimi K2", limits: { context: 262_144 } },
              { id: "no-window-published", displayName: "No Window" },
            ],
            defaultEnabledIds: [],
          },
        });
      });

      it("answers from the cached lineup without touching the network (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
        // Sizing a meter must not spend a request, and the window reported has
        // to agree with the model row the agent was configured from.
        const reader = new CopilotPlusUsageReader();

        await expect(reader.readContextWindow("gemini-3-pro")).resolves.toBe(1_048_576);
        await expect(reader.readContextWindow("kimi-k2")).resolves.toBe(262_144);
        expect(mockGetModels).not.toHaveBeenCalled();
      });

      it.each([
        ["a model the lineup publishes no window for", "no-window-published"],
        ["a model absent from the lineup", "not-in-catalog"],
        ["a null id, meaning the caller's prefix did not match", null],
      ])("answers null for %s", async (_case, modelId) => {
        await expect(new CopilotPlusUsageReader().readContextWindow(modelId)).resolves.toBeNull();
      });

      it("answers null for every model before the first lineup has been cached", async () => {
        setSettings({ copilotPlusCatalog: { models: [], defaultEnabledIds: [] } });

        await expect(
          new CopilotPlusUsageReader().readContextWindow("gemini-3-pro")
        ).resolves.toBeNull();
      });
    });
  });
});
