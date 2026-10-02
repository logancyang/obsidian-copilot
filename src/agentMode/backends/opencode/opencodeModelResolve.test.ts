import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel, Provider, ProviderOrigin, ProviderType } from "@/modelManagement";
import {
  copilotPlusModelId,
  opencodeEnabledModelEntries,
  opencodeWireBaseIdFor,
} from "./opencodeModelResolve";

function makeProvider(
  providerId: string,
  origin: ProviderOrigin,
  providerType: ProviderType = "anthropic",
  baseUrl?: string
): Provider {
  return {
    providerId,
    providerType,
    displayName: providerId,
    origin,
    baseUrl,
    addedAt: 0,
  };
}

function makeModel(configuredModelId: string, providerId: string, wireId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: wireId, displayName: wireId },
    configuredAt: 0,
  };
}

function makeSettings(args: {
  enabledModels?: string[];
  configuredModels?: ConfiguredModel[];
  providers?: Record<string, Provider>;
  enableSelfHostMode?: boolean;
}): CopilotSettings {
  return {
    backends:
      args.enabledModels === undefined ? {} : { opencode: { enabledModels: args.enabledModels } },
    configuredModels: args.configuredModels ?? [],
    providers: args.providers ?? {},
    enableSelfHostMode: args.enableSelfHostMode ?? false,
  } as unknown as CopilotSettings;
}

describe("opencodeModelResolve", () => {
  describe("opencodeEnabledModelEntries()", () => {
    const byokProvider = (overrides: Partial<Provider> = {}): Provider => ({
      ...makeProvider("p1", { kind: "byok", catalogProviderId: "openrouter" }, "openai-compatible"),
      requiresApiKey: true,
      apiKeyKeychainId: "kc-1",
      ...overrides,
    });

    it("flags a required-key provider with no key as missing_key", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: byokProvider({ apiKeyKeychainId: null }) },
        configuredModels: [makeModel("cm1", "p1", "qwen/qwen3-max")],
      });
      const [entry] = opencodeEnabledModelEntries(settings);
      expect(entry.baseModelId).toBe("openrouter/qwen/qwen3-max");
      expect(entry.credentialState).toBe("missing_key");
    });

    it("reports a keyed, never-failed provider as ok with its display name", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: byokProvider() },
        configuredModels: [
          {
            configuredModelId: "cm1",
            providerId: "p1",
            info: { id: "x", displayName: "Big X" },
            configuredAt: 0,
          },
        ],
      });
      const [entry] = opencodeEnabledModelEntries(settings);
      expect(entry.credentialState).toBe("ok");
      expect(entry.name).toBe("Big X");
    });

    it("labels a custom OpenAI-compatible provider's models with the provider's display name instead of its UUID route id (https://github.com/logancyang/obsidian-copilot/issues/3496)", () => {
      const customProviderId = "d5df8680-65f4-4c4b-81d2-7797550f47fe";
      const settings = makeSettings({
        enabledModels: ["named", "unnamed"],
        providers: {
          [customProviderId]: {
            ...makeProvider(customProviderId, { kind: "byok" }, "openai-compatible"),
            displayName: "custom-provider",
          },
        },
        configuredModels: [
          {
            configuredModelId: "named",
            providerId: customProviderId,
            info: { id: "auto", displayName: "custom-model" },
            configuredAt: 0,
          },
          {
            configuredModelId: "unnamed",
            providerId: customProviderId,
            info: { id: "fast", displayName: "" },
            configuredAt: 0,
          },
        ],
      });
      const [named, unnamed] = opencodeEnabledModelEntries(settings);
      expect(named.baseModelId).toBe(`${customProviderId}/auto`);
      expect(named.label).toBe("custom-provider/custom-model");
      expect(unnamed.label).toBe("custom-provider/fast");
    });

    it("leaves a custom provider's models unlabeled when its display name is blank, so opencode's route-id label shows (https://github.com/logancyang/obsidian-copilot/issues/3496)", () => {
      const customProviderId = "d5df8680-65f4-4c4b-81d2-7797550f47fe";
      const settings = makeSettings({
        enabledModels: ["named"],
        providers: {
          [customProviderId]: {
            ...makeProvider(customProviderId, { kind: "byok" }, "openai-compatible"),
            displayName: "   ",
          },
        },
        configuredModels: [
          {
            configuredModelId: "named",
            providerId: customProviderId,
            info: { id: "auto", displayName: "custom-model" },
            configuredAt: 0,
          },
        ],
      });
      const [entry] = opencodeEnabledModelEntries(settings);
      expect(entry.baseModelId).toBe(`${customProviderId}/auto`);
      expect(entry.label).toBeUndefined();
    });

    it("leaves Copilot Plus, catalog BYOK, and agent-native models unlabeled so opencode's own label shows (https://github.com/logancyang/obsidian-copilot/issues/3496)", () => {
      const settings = makeSettings({
        enabledModels: ["plus", "catalog", "native"],
        providers: {
          plus: makeProvider("plus", { kind: "copilot-plus" }),
          catalog: byokProvider({ providerId: "catalog" }),
          native: makeProvider("native", { kind: "agent", agentType: "opencode" }),
        },
        configuredModels: [
          makeModel("plus", "plus", "copilot-plus-flash"),
          makeModel("catalog", "catalog", "qwen/qwen3-max"),
          makeModel("native", "native", "opencode/big-pickle"),
        ],
      });
      const entries = opencodeEnabledModelEntries(settings);
      expect(entries.map((e) => e.baseModelId)).toEqual([
        "copilot-plus/copilot-plus-flash",
        "openrouter/qwen/qwen3-max",
        "opencode/big-pickle",
      ]);
      expect(entries.map((e) => e.label)).toEqual([undefined, undefined, undefined]);
    });

    it("treats agent-origin (native) models as ok regardless of key", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: makeProvider("p1", { kind: "agent", agentType: "opencode" }) },
        configuredModels: [makeModel("cm1", "p1", "opencode/big-pickle")],
      });
      const [entry] = opencodeEnabledModelEntries(settings);
      expect(entry.baseModelId).toBe("opencode/big-pickle");
      expect(entry.credentialState).toBe("ok");
    });

    it("flags opencode Zen models (opencode/ prefix) as free, others not", () => {
      const settings = makeSettings({
        enabledModels: ["zen", "lms"],
        providers: { p1: makeProvider("p1", { kind: "agent", agentType: "opencode" }) },
        configuredModels: [
          makeModel("zen", "p1", "opencode/big-pickle"),
          makeModel("lms", "p1", "lmstudio/gpt-oss-20b"),
        ],
      });
      const byId = new Map(opencodeEnabledModelEntries(settings).map((e) => [e.baseModelId, e]));
      expect(byId.get("opencode/big-pickle")?.isFree).toBe(true);
      expect(byId.get("lmstudio/gpt-oss-20b")?.isFree).toBe(false);
    });

    it("flags cloud-hosted models with needsSelfHostWarning when Self-Host Mode is on", () => {
      const settings = makeSettings({
        enableSelfHostMode: true,
        enabledModels: ["cloud", "local"],
        providers: {
          pc: makeProvider(
            "pc",
            { kind: "byok", catalogProviderId: "openai" },
            "anthropic",
            "https://api.openai.com/v1"
          ),
          pl: makeProvider(
            "pl",
            { kind: "byok", catalogProviderId: "ollama" },
            "anthropic",
            "http://localhost:11434/v1"
          ),
        },
        configuredModels: [makeModel("cloud", "pc", "gpt-4o"), makeModel("local", "pl", "llama3")],
      });
      const byId = new Map(opencodeEnabledModelEntries(settings).map((e) => [e.baseModelId, e]));
      expect(byId.get("openai/gpt-4o")?.needsSelfHostWarning).toBe(true);
      expect(byId.get("ollama/llama3")?.needsSelfHostWarning).toBe(false);
    });

    it("does not flag cloud models when Self-Host Mode is off", () => {
      const settings = makeSettings({
        enableSelfHostMode: false,
        enabledModels: ["cloud"],
        providers: {
          pc: makeProvider(
            "pc",
            { kind: "byok", catalogProviderId: "openai" },
            "anthropic",
            "https://api.openai.com/v1"
          ),
        },
        configuredModels: [makeModel("cloud", "pc", "gpt-4o")],
      });
      expect(opencodeEnabledModelEntries(settings)[0].needsSelfHostWarning).toBe(false);
    });

    it("returns the shared frozen empty array when nothing is enabled", () => {
      const first = opencodeEnabledModelEntries(makeSettings({ enabledModels: [] }));
      const second = opencodeEnabledModelEntries(makeSettings({ enabledModels: [] }));
      expect(first).toHaveLength(0);
      expect(first).toBe(second);
    });

    it("builds the `<provider>/<model>` wire base id for copilot-plus models", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: makeProvider("p1", { kind: "copilot-plus" }) },
        configuredModels: [makeModel("cm1", "p1", "copilot-plus-flash")],
      });
      expect(opencodeEnabledModelEntries(settings)[0].baseModelId).toBe(
        "copilot-plus/copilot-plus-flash"
      );
    });

    it("skips models whose provider row is missing", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: {},
        configuredModels: [makeModel("cm1", "p1", "claude-sonnet-4-6")],
      });
      expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
    });

    it("skips models whose configured-model row is missing", () => {
      const settings = makeSettings({
        enabledModels: ["missing"],
        providers: { p1: makeProvider("p1", { kind: "byok", catalogProviderId: "anthropic" }) },
        configuredModels: [],
      });
      expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
    });

    it("skips models on unroutable providers (BYOK without catalog id)", () => {
      const settings = makeSettings({
        enabledModels: ["cm1"],
        providers: { p1: makeProvider("p1", { kind: "byok" }, "google") },
        configuredModels: [makeModel("cm1", "p1", "some-google-model")],
      });
      expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
    });
  });

  describe("copilotPlusModelId()", () => {
    it("strips opencode's Copilot Plus prefix down to the bare model id", () => {
      expect(copilotPlusModelId("copilot-plus/gemini-3-pro")).toBe("gemini-3-pro");
    });

    it.each([
      ["a BYOK model on the user's own key", "google/gemini-3-pro"],
      ["an agent-hosted model", "opencode/grok-code"],
      ["a bare id with no provider prefix", "gemini-3-pro"],
      ["null", null],
      ["undefined", undefined],
    ])("answers null for %s — Copilot Plus caps must not apply to it", (_label, wireId) => {
      expect(copilotPlusModelId(wireId)).toBeNull();
    });
  });

  describe("opencodeWireBaseIdFor()", () => {
    const plusProvider = makeProvider("plus-1", { kind: "copilot-plus" }, "openai-compatible");

    it("prefixes a Copilot model with the provider opencode routes it under", () => {
      const settings = makeSettings({
        providers: { "plus-1": plusProvider },
        configuredModels: [makeModel("cm1", "plus-1", "copilot-plus-flash")],
      });
      expect(opencodeWireBaseIdFor("cm1", settings)).toBe("copilot-plus/copilot-plus-flash");
    });

    it("answers for a configured model that no backend has enabled yet", () => {
      const settings = makeSettings({
        providers: { "plus-1": plusProvider },
        configuredModels: [makeModel("cm1", "plus-1", "copilot-plus-flash")],
      });
      expect(settings.backends.opencode).toBeUndefined();
      expect(opencodeWireBaseIdFor("cm1", settings)).toBe("copilot-plus/copilot-plus-flash");
    });

    it("leaves an agent-hosted model's own id unprefixed", () => {
      const settings = makeSettings({
        providers: { "oc-1": makeProvider("oc-1", { kind: "agent", agentType: "opencode" }) },
        configuredModels: [makeModel("cm1", "oc-1", "opencode/zen-model")],
      });
      expect(opencodeWireBaseIdFor("cm1", settings)).toBe("opencode/zen-model");
    });

    it("returns null for an unknown model, a missing provider, and an unroutable one", () => {
      const unroutable = makeSettings({
        providers: { p1: makeProvider("p1", { kind: "byok" }, "google") },
        configuredModels: [makeModel("cm1", "p1", "some-google-model")],
      });
      expect(opencodeWireBaseIdFor("cm1", unroutable)).toBeNull();
      expect(opencodeWireBaseIdFor("nope", unroutable)).toBeNull();

      const orphaned = makeSettings({
        providers: {},
        configuredModels: [makeModel("cm1", "gone", "copilot-plus-flash")],
      });
      expect(opencodeWireBaseIdFor("cm1", orphaned)).toBeNull();
    });
  });
});
