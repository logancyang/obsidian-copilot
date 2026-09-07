import { DEFAULT_SETTINGS } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";

import { planCodexModelIdCollapse } from "./codexModelIdMigration";

const CODEX_PROVIDER_ID = "prov-codex";
const OPENCODE_PROVIDER_ID = "prov-opencode";

function provider(providerId: string, agentType: "codex" | "opencode"): Provider {
  return {
    providerId,
    providerType: "openai-compatible",
    displayName: agentType,
    origin: { kind: "agent", agentType },
    addedAt: 0,
  };
}

function model(
  configuredModelId: string,
  wireId: string,
  displayName: string,
  providerId = CODEX_PROVIDER_ID
): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: wireId, displayName },
    configuredAt: 0,
  };
}

function settings(overrides: Partial<CopilotSettings>): CopilotSettings {
  return {
    ...DEFAULT_SETTINGS,
    providers: {
      [CODEX_PROVIDER_ID]: provider(CODEX_PROVIDER_ID, "codex"),
      [OPENCODE_PROVIDER_ID]: provider(OPENCODE_PROVIDER_ID, "opencode"),
    },
    ...overrides,
  };
}

/** The six rows codex-acp's cross-product produces for one base model. */
const SOL_VARIANTS = ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) =>
  model(`cm-sol-${effort}`, `gpt-5.6-sol[${effort}]`, `GPT-5.6-Sol (${effort})`)
);

describe("codexModelIdMigration", () => {
  describe("planCodexModelIdCollapse()", () => {
    it("folds every effort variant of a base model onto one row", () => {
      const plan = planCodexModelIdCollapse(settings({ configuredModels: SOL_VARIANTS }));

      expect(plan?.configuredModels).toEqual([
        {
          configuredModelId: "cm-sol-low",
          providerId: CODEX_PROVIDER_ID,
          info: { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
          configuredAt: 0,
        },
      ]);
    });

    it("keeps a base model enabled when any of its effort variants was", () => {
      const plan = planCodexModelIdCollapse(
        settings({
          configuredModels: SOL_VARIANTS,
          backends: { codex: { enabledModels: ["cm-sol-high", "cm-sol-ultra"] } },
        })
      );

      // Both pointed at the same base model, so they collapse to the one
      // surviving row rather than leaving a duplicate entry behind.
      expect(plan?.enabledModels).toEqual(["cm-sol-low"]);
    });

    it("preserves the enabled set across two base models", () => {
      const terra = ["low", "high"].map((effort) =>
        model(`cm-terra-${effort}`, `gpt-5.6-terra[${effort}]`, `GPT-5.6-Terra (${effort})`)
      );
      const plan = planCodexModelIdCollapse(
        settings({
          configuredModels: [...SOL_VARIANTS, ...terra],
          backends: { codex: { enabledModels: ["cm-sol-max", "cm-terra-high"] } },
        })
      );

      expect(plan?.configuredModels.map((m) => m.info.id)).toEqual([
        "gpt-5.6-sol",
        "gpt-5.6-terra",
      ]);
      expect(plan?.enabledModels).toEqual(["cm-sol-low", "cm-terra-low"]);
    });

    it("leaves a base model disabled when none of its variants was enabled", () => {
      const plan = planCodexModelIdCollapse(
        settings({
          configuredModels: SOL_VARIANTS,
          backends: { codex: { enabledModels: [] } },
        })
      );

      expect(plan?.enabledModels).toEqual([]);
    });

    it("passes through an enabled id that matches no configured row", () => {
      const plan = planCodexModelIdCollapse(
        settings({
          configuredModels: SOL_VARIANTS,
          backends: { codex: { enabledModels: ["cm-sol-high", "cm-vanished"] } },
        })
      );

      // Unresolvable ids are already inert downstream (`agentOriginEnabledModelEntries`
      // skips them); rewriting the list is not this migration's job.
      expect(plan?.enabledModels).toEqual(["cm-sol-low", "cm-vanished"]);
    });

    it("moves the bracketed effort out of the sticky default's base model id", () => {
      const plan = planCodexModelIdCollapse(
        settings({
          configuredModels: SOL_VARIANTS,
          agentMode: {
            ...DEFAULT_SETTINGS.agentMode,
            backends: {
              codex: { defaultModel: { baseModelId: "gpt-5.6-sol[xhigh]", effort: null } },
            },
          },
        })
      );

      expect(plan?.defaultModel).toEqual({ baseModelId: "gpt-5.6-sol", effort: "xhigh" });
    });

    it("leaves models owned by another agent's provider untouched", () => {
      const opencodeModel = model("cm-oc", "openai/gpt-5", "GPT-5", OPENCODE_PROVIDER_ID);
      const plan = planCodexModelIdCollapse(
        settings({ configuredModels: [...SOL_VARIANTS, opencodeModel] })
      );

      expect(plan?.configuredModels).toContainEqual(opencodeModel);
    });

    it("plans no change for a vault whose codex rows are already base models", () => {
      expect(
        planCodexModelIdCollapse(
          settings({
            configuredModels: [model("cm-sol", "gpt-5.6-sol", "GPT-5.6-Sol")],
            backends: { codex: { enabledModels: ["cm-sol"] } },
            agentMode: {
              ...DEFAULT_SETTINGS.agentMode,
              backends: { codex: { defaultModel: { baseModelId: "gpt-5.6-sol", effort: "high" } } },
            },
          })
        )
      ).toBeNull();
    });

    it("plans no change for a vault that has never set codex up", () => {
      expect(planCodexModelIdCollapse(settings({ configuredModels: [] }))).toBeNull();
    });

    it("is idempotent — replanning against its own output plans nothing", () => {
      const first = planCodexModelIdCollapse(
        settings({
          configuredModels: SOL_VARIANTS,
          backends: { codex: { enabledModels: ["cm-sol-ultra"] } },
        })
      );

      expect(
        planCodexModelIdCollapse(
          settings({
            configuredModels: first!.configuredModels,
            backends: { codex: { enabledModels: first!.enabledModels } },
          })
        )
      ).toBeNull();
    });

    it("keeps a display name whose parenthesized suffix isn't the row's effort", () => {
      const plan = planCodexModelIdCollapse(
        settings({
          configuredModels: [model("cm", "gpt-5.6-luna[high]", "GPT-5.6-Luna (preview)")],
        })
      );

      expect(plan?.configuredModels[0].info.displayName).toBe("GPT-5.6-Luna (preview)");
    });
  });
});
