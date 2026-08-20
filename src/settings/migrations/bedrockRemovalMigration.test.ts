/**
 * Unit tests for the Amazon Bedrock removal migration.
 * https://github.com/logancyang/obsidian-copilot/issues/2928
 *
 * `planBedrockRemoval` is pure, so most coverage builds an in-the-wild settings
 * object and asserts the resulting plan. `executeBedrockRemoval` is exercised
 * against a mocked settings store, a stub coordinator and a stub keychain so
 * the side effects are observable in isolation.
 */

import type { CustomModel, ProjectConfig } from "@/aiParams";
import { ChatModelProviders, DEFAULT_SETTINGS } from "@/constants";
import type {
  ConfiguredModel,
  ModelManagementApi,
  Provider,
  ProviderType,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

import { executeBedrockRemoval, planBedrockRemoval } from "./bedrockRemovalMigration";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<typeof import("@/settings/model")>("@/settings/model");
  return { ...actual, setSettings: jest.fn() };
});

jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: jest.fn() },
}));

const mockSetSettings = setSettings as jest.MockedFunction<typeof setSettings>;
const mockGetInstance = KeychainService.getInstance as jest.MockedFunction<
  typeof KeychainService.getInstance
>;

type KeychainStub = { isAvailable: jest.Mock; deleteSecret: jest.Mock };

function keychain(overrides: Partial<KeychainStub> = {}): KeychainStub {
  const instance: KeychainStub = {
    isAvailable: jest.fn(() => true),
    deleteSecret: jest.fn(),
    ...overrides,
  };
  mockGetInstance.mockReturnValue(instance as unknown as KeychainService);
  return instance;
}

function makeApi() {
  const removeProvider = jest.fn(async () => undefined);
  const api = { coordinator: { removeProvider } } as unknown as ModelManagementApi;
  return { api, removeProvider };
}

/** A persisted provider row. `providerType` is widened because the union no
 *  longer has a `"bedrock"` member to name — which is the point of the test. */
function provider(providerId: string, providerType: string, apiKeyKeychainId?: string): Provider {
  return {
    providerId,
    providerType: providerType as ProviderType,
    displayName: providerId,
    origin: { kind: "byok" },
    addedAt: 0,
    ...(apiKeyKeychainId ? { apiKeyKeychainId } : {}),
  };
}

function configuredModel(configuredModelId: string, providerId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: `${configuredModelId}-wire`, displayName: configuredModelId },
    configuredAt: 0,
  };
}

function model(overrides: Partial<CustomModel>): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: false,
    ...overrides,
  };
}

function project(overrides: Partial<ProjectConfig>): ProjectConfig {
  return {
    id: "p1",
    name: "Project",
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    ...overrides,
  };
}

function settingsWith(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** A vault that migrated a v3 Bedrock setup: one provider, one model, enrolled
 *  in chat and selected as the default. */
function bedrockVault(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return settingsWith({
    providers: {
      bed: provider("bed", "bedrock", "copilot-v1-provider-bed"),
      ant: provider("ant", "anthropic", "copilot-v1-provider-ant"),
    },
    configuredModels: [configuredModel("cm-bed", "bed"), configuredModel("cm-ant", "ant")],
    backends: { chat: { enabledModels: ["cm-bed", "cm-ant"] } },
    defaultModelKey: "cm-bed",
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  keychain();
});

describe("bedrockRemovalMigration", () => {
  describe("planBedrockRemoval()", () => {
    it("returns null for a vault that never configured Bedrock", () => {
      expect(
        planBedrockRemoval(
          settingsWith({
            providers: { ant: provider("ant", "anthropic") },
            configuredModels: [configuredModel("cm-ant", "ant")],
            backends: { chat: { enabledModels: ["cm-ant"] } },
          })
        )
      ).toBeNull();
    });

    it("names every Bedrock provider row and leaves every other provider alone", () => {
      const plan = planBedrockRemoval(bedrockVault());
      expect(plan?.providerIds).toEqual(["bed"]);
    });

    it("leaves the provider, model and backend slices to the shared cascade", () => {
      const plan = planBedrockRemoval(bedrockVault());
      expect(plan?.patch.providers).toBeUndefined();
      expect(plan?.patch.configuredModels).toBeUndefined();
      expect(plan?.patch.backends).toBeUndefined();
    });

    it("clears a selection pointing at a removed model", () => {
      const plan = planBedrockRemoval(
        bedrockVault({
          defaultModelKey: "cm-bed",
          quickCommandModelKey: "cm-bed",
          projectList: [project({ projectModelKey: "cm-bed" })],
        })
      );
      expect(plan?.patch.defaultModelKey).toBe("");
      expect(plan?.patch).toHaveProperty("quickCommandModelKey", undefined);
      expect(plan?.patch.projectList?.[0].projectModelKey).toBe("");
    });

    it("leaves a selection pointing at a surviving model alone", () => {
      const plan = planBedrockRemoval(bedrockVault({ defaultModelKey: "cm-ant" }));
      expect(plan?.patch.defaultModelKey).toBeUndefined();
    });

    it("removes a legacy Bedrock model from a vault whose BYOK migration never ran (https://github.com/logancyang/obsidian-copilot/issues/2928)", () => {
      const plan = planBedrockRemoval(
        settingsWith({
          activeModels: [
            model({ name: "anthropic.claude-sonnet-4-5", provider: "amazon-bedrock" }),
            model({ name: "gpt-5" }),
          ],
          defaultModelKey: "anthropic.claude-sonnet-4-5|amazon-bedrock",
        })
      );
      expect(plan?.providerIds).toEqual([]);
      expect(plan?.patch.activeModels?.map((m) => m.name)).toEqual(["gpt-5"]);
      expect(plan?.patch.defaultModelKey).toBe("");
    });

    it("clears a legacy selection whose model row is already gone", () => {
      const plan = planBedrockRemoval(
        settingsWith({ defaultModelKey: "anthropic.claude-sonnet-4-5|amazon-bedrock" })
      );
      expect(plan?.patch.defaultModelKey).toBe("");
    });
  });

  describe("executeBedrockRemoval()", () => {
    it("writes no settings and removes no provider when the vault never configured Bedrock", async () => {
      const { api, removeProvider } = makeApi();
      await executeBedrockRemoval(
        api,
        settingsWith({ providers: { ant: provider("ant", "anthropic") } })
      );
      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(removeProvider).not.toHaveBeenCalled();
    });

    it("hands each Bedrock row to the shared provider cascade", async () => {
      const { api, removeProvider } = makeApi();
      await executeBedrockRemoval(api, bedrockVault());
      expect(removeProvider).toHaveBeenCalledTimes(1);
      expect(removeProvider).toHaveBeenCalledWith("bed");
    });

    it("writes only the slices the cascade does not own", async () => {
      const { api } = makeApi();
      await executeBedrockRemoval(api, bedrockVault());
      expect(mockSetSettings).toHaveBeenCalledTimes(1);
      expect(mockSetSettings).toHaveBeenCalledWith({ defaultModelKey: "" });
    });

    it("skips the settings write when only provider rows need removing", async () => {
      const { api, removeProvider } = makeApi();
      await executeBedrockRemoval(
        api,
        settingsWith({ providers: { bed: provider("bed", "bedrock") } })
      );
      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(removeProvider).toHaveBeenCalledWith("bed");
    });

    it("deletes the pre-BYOK top-level key, which no later code path can name (https://github.com/logancyang/obsidian-copilot/issues/2928)", async () => {
      const store = keychain();
      const { api } = makeApi();
      await executeBedrockRemoval(api, settingsWith());
      expect(store.deleteSecret).toHaveBeenCalledWith("amazonBedrockApiKey");
    });

    it("leaves the legacy key in place when the keychain is unavailable", async () => {
      const store = keychain({ isAvailable: jest.fn(() => false) });
      const { api, removeProvider } = makeApi();
      await executeBedrockRemoval(api, bedrockVault());
      expect(store.deleteSecret).not.toHaveBeenCalled();
      expect(removeProvider).toHaveBeenCalledWith("bed");
    });

    it("still removes the provider when deleting the legacy key throws", async () => {
      keychain({
        deleteSecret: jest.fn(() => {
          throw new Error("keychain locked");
        }),
      });
      const { api, removeProvider } = makeApi();
      await expect(executeBedrockRemoval(api, bedrockVault())).resolves.toBeUndefined();
      expect(removeProvider).toHaveBeenCalledWith("bed");
    });
  });
});
