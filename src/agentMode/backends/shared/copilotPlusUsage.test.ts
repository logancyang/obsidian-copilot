import {
  CopilotPlusUsageReader,
  parseContextLength,
  planUsageFromCopilotPlusUsage,
} from "./copilotPlusUsage";

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

  describe("parseContextLength()", () => {
    it.each([
      ["1M", 1_048_576],
      ["256K", 262_144],
      ["192k", 196_608],
      ["8192", 8_192],
      [" 64 K ", 65_536],
    ])("reads %s as %i tokens (binary suffixes, as published)", (display, tokens) => {
      expect(parseContextLength(display)).toBe(tokens);
    });

    it.each([
      ["an unknown suffix", "1G"],
      ["prose", "one million"],
      ["a zero", "0"],
      ["a negative", "-5K"],
      ["a non-string", 200_000],
      ["undefined", undefined],
    ])("returns null for %s", (_label, display) => {
      expect(parseContextLength(display)).toBeNull();
    });
  });

  describe("CopilotPlusUsageReader", () => {
    it("reads plan usage through the Brevilabs client", async () => {
      mockGetUsage.mockResolvedValue({ used: { weekly: { usedPercent: 21 } } });

      const reading = await new CopilotPlusUsageReader().readPlanUsage();

      expect(reading).toMatchObject({
        kind: "usage",
        planUsage: { windows: [expect.objectContaining({ id: "weekly", percent: 21 })] },
      });
    });

    it("answers context windows from one catalog fetch, shared across models and calls", async () => {
      mockGetModels.mockResolvedValue({
        data: [
          { id: "gemini-3-pro", context_length: "1M" },
          { id: "kimi-k2", context_length: "256K" },
          { id: "no-window-published" },
        ],
      });
      const reader = new CopilotPlusUsageReader();

      await expect(reader.readContextWindow("gemini-3-pro")).resolves.toBe(1_048_576);
      await expect(reader.readContextWindow("kimi-k2")).resolves.toBe(262_144);
      await expect(reader.readContextWindow("no-window-published")).resolves.toBeNull();
      await expect(reader.readContextWindow("not-in-catalog")).resolves.toBeNull();
      expect(mockGetModels).toHaveBeenCalledTimes(1);
    });

    it("answers null for a null model id without touching the network", async () => {
      // Null is the caller saying "not a Copilot Plus model" — its backend-specific
      // prefix did not match — so there is nothing to look up.
      await expect(new CopilotPlusUsageReader().readContextWindow(null)).resolves.toBeNull();
      expect(mockGetModels).not.toHaveBeenCalled();
    });

    it("shares one in-flight fetch between concurrent callers", async () => {
      let release!: (value: { data: { id: string; context_length: string }[] }) => void;
      mockGetModels.mockReturnValue(new Promise((resolve) => (release = resolve)));
      const reader = new CopilotPlusUsageReader();

      const first = reader.readContextWindow("gemini-3-pro");
      const second = reader.readContextWindow("kimi-k2");
      release({
        data: [
          { id: "gemini-3-pro", context_length: "1M" },
          { id: "kimi-k2", context_length: "256K" },
        ],
      });

      await expect(first).resolves.toBe(1_048_576);
      await expect(second).resolves.toBe(262_144);
      expect(mockGetModels).toHaveBeenCalledTimes(1);
    });

    it("answers the effort levels a model publishes, from the same catalog fetch", async () => {
      mockGetModels.mockResolvedValue({
        data: [
          {
            id: "reasons-three-ways",
            context_length: "1M",
            reasoning_efforts: ["none", "low", "max"],
          },
          { id: "honors-no-level", context_length: "1M", reasoning_efforts: [] },
        ],
      });
      const reader = new CopilotPlusUsageReader();

      await expect(reader.readReasoningEfforts("reasons-three-ways")).resolves.toEqual([
        "none",
        "low",
        "max",
      ]);
      await expect(reader.readContextWindow("reasons-three-ways")).resolves.toBe(1_048_576);
      expect(mockGetModels).toHaveBeenCalledTimes(1);
    });

    it("tells a model that honors no level apart from one that published none", async () => {
      // An empty list means the model has no effort to vary and its caller should offer
      // no control; an absent field means an older service that cannot say, where the
      // caller must keep whatever menu it already had.
      // https://github.com/logancyang/obsidian-copilot/issues/2917
      mockGetModels.mockResolvedValue({
        data: [
          { id: "honors-no-level", reasoning_efforts: [] },
          { id: "service-too-old", context_length: "1M" },
        ],
      });
      const reader = new CopilotPlusUsageReader();

      await expect(reader.readReasoningEfforts("honors-no-level")).resolves.toEqual([]);
      await expect(reader.readReasoningEfforts("service-too-old")).resolves.toBeNull();
      await expect(reader.readReasoningEfforts("not-in-catalog")).resolves.toBeNull();
    });

    it("treats an unusable effort list as unknown rather than as no levels", async () => {
      // "No levels" removes the effort control. Doing that because the field arrived
      // malformed would delete a working menu on the strength of garbage, so anything
      // the caller cannot act on has to read the same as the field being absent.
      mockGetModels.mockResolvedValue({
        data: [
          { id: "garbage-levels", reasoning_efforts: [7, "", null, "  "] },
          { id: "wrong-type", reasoning_efforts: "high" },
          { id: "partly-usable", reasoning_efforts: [" high ", 7] },
        ],
      });
      const reader = new CopilotPlusUsageReader();

      await expect(reader.readReasoningEfforts("garbage-levels")).resolves.toBeNull();
      await expect(reader.readReasoningEfforts("wrong-type")).resolves.toBeNull();
      await expect(reader.readReasoningEfforts("partly-usable")).resolves.toEqual(["high"]);
    });

    it("answers null for effort levels when the catalog cannot be read", async () => {
      // Not "no levels": dropping a working effort control over one transient outage is
      // worse than leaving the menu as it was.
      mockGetModels.mockResolvedValue(null);

      await expect(
        new CopilotPlusUsageReader().readReasoningEfforts("any-model")
      ).resolves.toBeNull();
    });

    it("gives up on a catalog read that never answers, so the agent still starts", async () => {
      // The opencode spawn path waits on this read and the HTTP layer enforces no
      // timeout, so an unreachable host would otherwise hold up starting the agent.
      // https://github.com/logancyang/obsidian-copilot/issues/2917
      jest.useFakeTimers();
      try {
        mockGetModels.mockReturnValue(new Promise(() => {}));
        const reader = new CopilotPlusUsageReader();

        const pending = reader.readReasoningEfforts("never-answers");
        jest.advanceTimersByTime(3_000);

        await expect(pending).resolves.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it("retries the catalog after a read times out instead of reusing the dead request (https://github.com/logancyang/obsidian-copilot/issues/2917)", async () => {
      // Keeping the timed-out request as the shared one would make every later read wait
      // out the same dead connection, so the menu would stay guessed even once the host
      // came back.
      jest.useFakeTimers();
      try {
        mockGetModels
          .mockReturnValueOnce(new Promise(() => {}))
          .mockResolvedValue({ data: [{ id: "gpt-5", reasoning_efforts: ["low", "high"] }] });
        const reader = new CopilotPlusUsageReader();

        const timedOut = reader.readReasoningEfforts("gpt-5");
        jest.advanceTimersByTime(3_000);
        await expect(timedOut).resolves.toBeNull();

        await expect(reader.readReasoningEfforts("gpt-5")).resolves.toEqual(["low", "high"]);
        expect(mockGetModels).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it("retries after a failed catalog fetch instead of caching the failure (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
      // One transient outage at the wrong moment must not strand the context ring on a
      // bare token count for the rest of the session.
      mockGetModels
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ data: [{ id: "gemini-3-pro", context_length: "1M" }] });
      const reader = new CopilotPlusUsageReader();

      await expect(reader.readContextWindow("gemini-3-pro")).resolves.toBeNull();
      await expect(reader.readContextWindow("gemini-3-pro")).resolves.toBe(1_048_576);
      expect(mockGetModels).toHaveBeenCalledTimes(2);
    });
  });
});
