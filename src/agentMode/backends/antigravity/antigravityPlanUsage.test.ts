import {
  parseAntigravityQuotaGroups,
  planUsageForModel,
  quotaGroupForModel,
  type AntigravityQuotaGroup,
} from "./antigravityPlanUsage";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function usageJson(groups: unknown[]): string {
  return JSON.stringify({ status: "SUCCESS", command: { name: "usage", data: { groups } } });
}

const FREE_TIER = usageJson([
  {
    name: "Gemini Models",
    description: "Models within this group: Gemini Flash, Gemini Pro",
    buckets: [
      {
        id: "gemini-weekly",
        name: "Weekly Limit Remaining",
        window: "weekly",
        remaining_fraction: 0.837824821472168,
        reset_time: "2026-11-18T06:01:04Z",
      },
    ],
  },
]);

const GROUPS: AntigravityQuotaGroup[] = [
  {
    name: "Gemini Models",
    modelFamilies: ["gemini flash", "gemini pro"],
    windows: [{ id: "gemini-weekly", label: "Weekly", percent: 10 }],
  },
  {
    name: "Claude and GPT models",
    modelFamilies: ["claude opus", "claude sonnet", "gpt-oss"],
    windows: [{ id: "3p-weekly", label: "Weekly", percent: 20 }],
  },
  {
    name: "Gemini 4 Argon",
    modelFamilies: [],
    windows: [{ id: "gemini-argon-wtu-weekly", label: "Weekly", percent: 30 }],
  },
];

describe("antigravityPlanUsage", () => {
  describe("parseAntigravityQuotaGroups()", () => {
    it("reads a free-tier account's weekly-only group with its models and reset time", () => {
      expect(parseAntigravityQuotaGroups(FREE_TIER)).toEqual([
        {
          name: "Gemini Models",
          modelFamilies: ["gemini flash", "gemini pro"],
          windows: [
            {
              id: "gemini-weekly",
              label: "Weekly",
              percent: 16.2,
              resetsAt: Date.parse("2026-11-18T06:01:04Z"),
            },
          ],
        },
      ]);
    });

    it("skips buckets without a remaining fraction and groups left with no buckets", () => {
      const json = usageJson([
        { name: "Broken", buckets: [{ id: "x", window: "weekly" }] },
        { name: "Ok", buckets: [{ id: "y", window: "5h", remaining_fraction: 0 }] },
      ]);

      expect(parseAntigravityQuotaGroups(json)).toEqual([
        { name: "Ok", modelFamilies: [], windows: [{ id: "y", label: "5h", percent: 100 }] },
      ]);
    });

    it.each(["not json", JSON.stringify({ status: "SUCCESS" })])(
      "returns null for output that is not a usage report: %s",
      (stdout) => {
        expect(parseAntigravityQuotaGroups(stdout)).toBeNull();
      }
    );
  });

  describe("quotaGroupForModel()", () => {
    it.each([
      ["gemini-3.8-flash", "Gemini Models"],
      ["claude-opus-5-5", "Claude and GPT models"],
      ["gpt-oss-120b-medium", "Claude and GPT models"],
      ["gemini-4-argon", "Gemini 4 Argon"],
    ])("bills %s to the %s group", (model, group) => {
      expect(quotaGroupForModel(GROUPS, model)?.name).toBe(group);
    });

    it.each([null, undefined, "llama-4"])("finds no group for model %s", (model) => {
      expect(quotaGroupForModel(GROUPS, model)).toBeNull();
    });
  });

  describe("planUsageForModel()", () => {
    const planUsage = { windows: GROUPS.flatMap((group) => group.windows), updatedAt: 5 };

    it("keeps only the windows of the model's quota group", () => {
      expect(planUsageForModel(planUsage, GROUPS, "claude-sonnet-5-5")).toEqual({
        windows: [{ id: "3p-weekly", label: "Weekly", percent: 20 }],
        updatedAt: 5,
      });
    });

    it("shows no meter for a model outside every quota group", () => {
      expect(planUsageForModel(planUsage, GROUPS, "llama-4")).toBeNull();
    });
  });
});
