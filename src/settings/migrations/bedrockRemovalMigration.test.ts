import type { CustomModel } from "@/aiParams";
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

function settingsWith(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

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

describe("bedrockRemovalMigration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    keychain();
  });

  describe("planBedrockRemoval()", () => {
    it("names every Bedrock provider row and leaves every other provider alone", () => {
      const plan = planBedrockRemoval(bedrockVault());
      expect(plan?.providerIds).toEqual(["bed"]);
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
  });

  describe("executeBedrockRemoval()", () => {
    it("hands each Bedrock row to the shared provider cascade", async () => {
      const { api, removeProvider } = makeApi();
      await executeBedrockRemoval(api, bedrockVault());
      expect(removeProvider).toHaveBeenCalledTimes(1);
      expect(removeProvider).toHaveBeenCalledWith("bed");
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
  });
});
