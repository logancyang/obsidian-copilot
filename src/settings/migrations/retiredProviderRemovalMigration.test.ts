import type { CustomModel, ProjectConfig } from "@/aiParams";
import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import type {
  ConfiguredModel,
  ModelManagementApi,
  Provider,
  ProviderType,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

import {
  executeRetiredProviderRemoval,
  planRetiredProviderRemoval,
  referencesRetiredProvider,
  type RetiredProviderRemovalPlan,
} from "./retiredProviderRemovalMigration";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<typeof import("@/settings/model")>("@/settings/model");
  return { ...actual, setSettings: jest.fn() };
});

jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: jest.fn() },
}));

const mockLogWarn = logWarn as jest.MockedFunction<typeof logWarn>;
const mockSetSettings = setSettings as jest.MockedFunction<typeof setSettings>;
const mockGetInstance = KeychainService.getInstance as jest.MockedFunction<
  typeof KeychainService.getInstance
>;

interface KeychainStub {
  isAvailable: jest.Mock;
  deleteSecret: jest.Mock;
}

function keychain(overrides: Partial<KeychainStub> = {}): KeychainStub {
  const instance: KeychainStub = {
    isAvailable: jest.fn(() => true),
    deleteSecret: jest.fn(),
    ...overrides,
  };
  mockGetInstance.mockReturnValue(instance as unknown as KeychainService);
  return instance;
}

function makeApi(): {
  api: ModelManagementApi;
  removeProvider: jest.Mock<Promise<void>, [string]>;
} {
  const removeProvider = jest.fn(async (_providerId: string): Promise<void> => undefined);
  return {
    api: { coordinator: { removeProvider } } as unknown as ModelManagementApi,
    removeProvider,
  };
}

function provider(providerId: string, providerType: string): Provider {
  return {
    providerId,
    providerType: providerType as ProviderType,
    displayName: providerId,
    origin: { kind: "byok" },
    addedAt: 0,
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

function legacyModel(name: string, providerName: string): CustomModel {
  return { name, provider: providerName, enabled: true, isBuiltIn: false };
}

function project(projectModelKey: string): ProjectConfig {
  return {
    id: "project",
    name: "Project",
    systemPrompt: "",
    projectModelKey,
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
  };
}

function settingsWith(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("retiredProviderRemovalMigration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    keychain();
  });

  describe("referencesRetiredProvider()", () => {
    it("matches only a complete legacy provider suffix", () => {
      expect(referencesRetiredProvider("claude|amazon-bedrock", ["amazon-bedrock"])).toBe(true);
      expect(referencesRetiredProvider("claude|amazon-bedrock-preview", ["amazon-bedrock"])).toBe(
        false
      );
      expect(referencesRetiredProvider("amazon-bedrock|openai", ["amazon-bedrock"])).toBe(false);
    });
  });

  describe("planRetiredProviderRemoval()", () => {
    it("returns null when neither provider rows nor retired selections exist", () => {
      expect(
        planRetiredProviderRemoval(
          settingsWith({ providers: { openai: provider("openai", "openai") } }),
          "retired",
          ["legacy-retired"]
        )
      ).toBeNull();
    });

    it("plans every retired provider and clears current and legacy selections", () => {
      const plan = planRetiredProviderRemoval(
        settingsWith({
          providers: {
            retiredOne: provider("retired-one", "retired"),
            retiredTwo: provider("retired-two", "retired"),
            openai: provider("openai", "openai"),
          },
          configuredModels: [
            configuredModel("current-retired", "retired-one"),
            configuredModel("current-openai", "openai"),
          ],
          activeModels: [legacyModel("old", "legacy-retired"), legacyModel("kept", "openai")],
          defaultModelKey: "current-retired",
          quickCommandModelKey: "old|legacy-retired",
          projectList: [project("current-retired"), project("current-openai")],
        }),
        "retired",
        ["legacy-retired"]
      );

      expect(plan).toEqual({
        providerIds: ["retired-one", "retired-two"],
        patch: {
          activeModels: [legacyModel("kept", "openai")],
          defaultModelKey: "",
          quickCommandModelKey: undefined,
          projectList: [project(""), project("current-openai")],
        },
      });
    });
  });

  describe("executeRetiredProviderRemoval()", () => {
    it("deletes the legacy secret even when there is no provider plan", async () => {
      const store = keychain();
      const { api, removeProvider } = makeApi();

      await executeRetiredProviderRemoval(api, null, "legacyApiKey", "Retired migration");

      expect(store.deleteSecret).toHaveBeenCalledWith("legacyApiKey");
      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(removeProvider).not.toHaveBeenCalled();
    });

    it("writes the shared patch and cascades every retired provider", async () => {
      const { api, removeProvider } = makeApi();
      const plan: RetiredProviderRemovalPlan = {
        providerIds: ["retired-one", "retired-two"],
        patch: { defaultModelKey: "" },
      };

      await executeRetiredProviderRemoval(api, plan, "legacyApiKey", "Retired migration");

      expect(mockSetSettings).toHaveBeenCalledWith({ defaultModelKey: "" });
      expect(removeProvider.mock.calls).toEqual([["retired-one"], ["retired-two"]]);
    });

    it("continues the provider cascade when deleting the legacy secret throws", async () => {
      keychain({
        deleteSecret: jest.fn(() => {
          throw new Error("keychain locked");
        }),
      });
      const { api, removeProvider } = makeApi();
      const plan: RetiredProviderRemovalPlan = {
        providerIds: ["retired"],
        patch: {},
      };

      await expect(
        executeRetiredProviderRemoval(api, plan, "legacyApiKey", "Retired migration")
      ).resolves.toBeUndefined();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "[Retired migration] could not delete the legacy stored API key",
        expect.any(Error)
      );
      expect(removeProvider).toHaveBeenCalledWith("retired");
    });
  });
});
