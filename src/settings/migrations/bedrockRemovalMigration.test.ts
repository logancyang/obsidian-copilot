/**
 * Unit tests for the Amazon Bedrock removal migration.
 * https://github.com/logancyang/obsidian-copilot/issues/2928
 *
 * `planBedrockRemoval` is pure, so most coverage builds an in-the-wild settings
 * object and asserts the resulting plan. `executeBedrockRemoval` is exercised
 * against a mocked settings store and keychain so the side effects are
 * observable in isolation.
 */

import type { CustomModel, ProjectConfig } from "@/aiParams";
import { ChatModelProviders, DEFAULT_SETTINGS } from "@/constants";
import type { ConfiguredModel, Provider, ProviderType } from "@/modelManagement";
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

type KeychainStub = { isAvailable: jest.Mock; deleteSecretById: jest.Mock };

function keychain(overrides: Partial<KeychainStub> = {}): KeychainStub {
  const instance: KeychainStub = {
    isAvailable: jest.fn(() => true),
    deleteSecretById: jest.fn(),
    ...overrides,
  };
  mockGetInstance.mockReturnValue(instance as unknown as KeychainService);
  return instance;
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

    it("drops the Bedrock provider row and leaves every other provider alone", () => {
      const plan = planBedrockRemoval(bedrockVault());
      expect(Object.keys(plan?.patch.providers ?? {})).toEqual(["ant"]);
    });

    it("drops the models belonging to the removed provider", () => {
      const plan = planBedrockRemoval(bedrockVault());
      expect(plan?.patch.configuredModels?.map((m) => m.configuredModelId)).toEqual(["cm-ant"]);
    });

    it("un-enrolls the removed models from every backend picker", () => {
      const plan = planBedrockRemoval(
        bedrockVault({
          backends: {
            chat: { enabledModels: ["cm-bed", "cm-ant"] },
            opencode: { enabledModels: ["cm-ant"] },
          },
        })
      );
      expect(plan?.patch.backends?.chat?.enabledModels).toEqual(["cm-ant"]);
      expect(plan?.patch.backends?.opencode?.enabledModels).toEqual(["cm-ant"]);
    });

    it("surfaces the keychain id of each removed row so its key can be deleted", () => {
      const plan = planBedrockRemoval(bedrockVault());
      expect(plan?.keychainIds).toEqual(["copilot-v1-provider-bed"]);
    });

    it("leaves the models slice untouched when the removed provider had no models", () => {
      const plan = planBedrockRemoval(
        settingsWith({
          providers: { bed: provider("bed", "bedrock"), ant: provider("ant", "anthropic") },
          configuredModels: [configuredModel("cm-ant", "ant")],
        })
      );
      expect(plan?.patch.configuredModels).toBeUndefined();
    });

    it("leaves the backends slice untouched when no enrollment named a removed model", () => {
      const plan = planBedrockRemoval(
        bedrockVault({ backends: { chat: { enabledModels: ["cm-ant"] } } })
      );
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

    it("removes a legacy Bedrock model from a vault whose BYOK migration never ran", () => {
      const plan = planBedrockRemoval(
        settingsWith({
          activeModels: [
            model({ name: "anthropic.claude-sonnet-4-5", provider: "amazon-bedrock" }),
            model({ name: "gpt-5" }),
          ],
          defaultModelKey: "anthropic.claude-sonnet-4-5|amazon-bedrock",
        })
      );
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
    it("writes nothing when the vault never configured Bedrock", () => {
      executeBedrockRemoval(settingsWith({ providers: { ant: provider("ant", "anthropic") } }));
      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(mockGetInstance).not.toHaveBeenCalled();
    });

    it("applies the patch and deletes the stored key", () => {
      const store = keychain();
      executeBedrockRemoval(bedrockVault());
      expect(mockSetSettings).toHaveBeenCalledTimes(1);
      expect(store.deleteSecretById).toHaveBeenCalledWith("copilot-v1-provider-bed");
    });

    it("still applies the patch when the keychain is unavailable", () => {
      const store = keychain({ isAvailable: jest.fn(() => false) });
      executeBedrockRemoval(bedrockVault());
      expect(mockSetSettings).toHaveBeenCalledTimes(1);
      expect(store.deleteSecretById).not.toHaveBeenCalled();
    });

    it("does not reach for the keychain when no removed row stored a key", () => {
      executeBedrockRemoval(
        settingsWith({
          providers: { bed: provider("bed", "bedrock") },
          configuredModels: [configuredModel("cm-bed", "bed")],
        })
      );
      expect(mockSetSettings).toHaveBeenCalledTimes(1);
      expect(mockGetInstance).not.toHaveBeenCalled();
    });

    it("keeps the settings patch when deleting the key throws", () => {
      keychain({
        deleteSecretById: jest.fn(() => {
          throw new Error("keychain locked");
        }),
      });
      expect(() => executeBedrockRemoval(bedrockVault())).not.toThrow();
      expect(mockSetSettings).toHaveBeenCalledTimes(1);
    });
  });
});
