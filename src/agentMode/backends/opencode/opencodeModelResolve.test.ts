import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel, Provider, ProviderOrigin, ProviderType } from "@/modelManagement";
import {
  isOpencodeZenWireId,
  mapProviderToOpencodeId,
  opencodeEnabledModelEntries,
} from "./opencodeModelResolve";

/** Build a minimal `Provider` row for a given origin + type. */
function makeProvider(
  providerId: string,
  origin: ProviderOrigin,
  providerType: ProviderType = "anthropic"
): Provider {
  return {
    providerId,
    providerType,
    displayName: providerId,
    origin,
    addedAt: 0,
  };
}

/** Build a minimal `ConfiguredModel` row. */
function makeModel(configuredModelId: string, providerId: string, wireId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: wireId, displayName: wireId },
    configuredAt: 0,
  };
}

/**
 * Assemble a `CopilotSettings`-shaped object with only the slices
 * `opencodeEnabledModelEntries` reads. Cast through `unknown` since the resolver
 * touches just `backends` / `configuredModels` / `providers`.
 */
function makeSettings(args: {
  enabledModels?: string[];
  configuredModels?: ConfiguredModel[];
  providers?: Record<string, Provider>;
}): CopilotSettings {
  return {
    backends:
      args.enabledModels === undefined ? {} : { opencode: { enabledModels: args.enabledModels } },
    configuredModels: args.configuredModels ?? [],
    providers: args.providers ?? {},
  } as unknown as CopilotSettings;
}

describe("mapProviderToOpencodeId", () => {
  it("maps a BYOK provider with a catalog id to that id, non-native", () => {
    const provider = makeProvider("p1", { kind: "byok", catalogProviderId: "anthropic" });
    expect(mapProviderToOpencodeId(provider)).toEqual({ id: "anthropic", native: false });
  });

  it("maps BYOK openrouter to openrouter, non-native", () => {
    const provider = makeProvider("p1", { kind: "byok", catalogProviderId: "openrouter" });
    expect(mapProviderToOpencodeId(provider)).toEqual({ id: "openrouter", native: false });
  });

  it("returns null for a non-OpenAI-compatible BYOK provider without a catalog id", () => {
    const provider = makeProvider("p1", { kind: "byok" });
    expect(mapProviderToOpencodeId(provider)).toBeNull();
  });

  it("maps an OpenAI-compatible BYOK provider without a catalog id to its providerId", () => {
    const provider = makeProvider("p1", { kind: "byok" }, "openai-compatible");
    expect(mapProviderToOpencodeId(provider)).toEqual({ id: "p1", native: false });
  });

  it("returns null for azure / bedrock BYOK providers without a catalog id", () => {
    expect(mapProviderToOpencodeId(makeProvider("p1", { kind: "byok" }, "azure"))).toBeNull();
    expect(mapProviderToOpencodeId(makeProvider("p2", { kind: "byok" }, "bedrock"))).toBeNull();
  });

  it("maps copilot-plus origin to the reserved copilot-plus id, non-native", () => {
    const provider = makeProvider("p1", { kind: "copilot-plus" });
    expect(mapProviderToOpencodeId(provider)).toEqual({ id: "copilot-plus", native: false });
  });

  it("maps an agent-origin provider to its providerId, native", () => {
    const provider = makeProvider("opencode-provider", { kind: "agent", agentType: "opencode" });
    expect(mapProviderToOpencodeId(provider)).toEqual({
      id: "opencode-provider",
      native: true,
    });
  });
});

describe("isOpencodeZenWireId", () => {
  it("matches the opencode/ prefix only", () => {
    expect(isOpencodeZenWireId("opencode/big-pickle")).toBe(true);
    expect(isOpencodeZenWireId("opencode/deepseek-v4-flash-free")).toBe(true);
    expect(isOpencodeZenWireId("lmstudio/gpt-oss-20b")).toBe(false);
    expect(isOpencodeZenWireId("openrouter/anthropic/claude")).toBe(false);
    expect(isOpencodeZenWireId("opencode-zen/x")).toBe(false); // prefix must be exactly `opencode/`
  });
});

describe("opencodeEnabledModelEntries", () => {
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

  it("returns the shared frozen empty array when nothing is enabled", () => {
    const first = opencodeEnabledModelEntries(makeSettings({ enabledModels: [] }));
    const second = opencodeEnabledModelEntries(makeSettings({ enabledModels: [] }));
    expect(first).toHaveLength(0);
    // Referential stability: the same frozen constant on every empty call.
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
      providers: { p1: makeProvider("p1", { kind: "byok" }, "azure") },
      configuredModels: [makeModel("cm1", "p1", "some-azure-model")],
    });
    expect(opencodeEnabledModelEntries(settings)).toHaveLength(0);
  });
});
