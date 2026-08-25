/**
 * Unit tests for the Azure OpenAI removal migration.
 * https://github.com/logancyang/obsidian-copilot/issues/2932
 *
 * The chat sweep is shared with the Bedrock removal and is covered through that
 * migration's suite, so these focus on what Azure adds: the embedding selection,
 * which is the one slice whose absence would break a vault rather than degrade
 * it.
 */

import { DEFAULT_SETTINGS } from "@/constants";
import type {
  ConfiguredModel,
  ModelManagementApi,
  Provider,
  ProviderType,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

import { executeAzureRemoval, planAzureRemoval } from "./azureRemovalMigration";

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

/** `providerType` is widened because the union no longer has an Azure member. */
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

function settingsWith(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("azureRemovalMigration", () => {
  describe("planAzureRemoval()", () => {
    it("returns null for a vault that never configured Azure", () => {
      expect(
        planAzureRemoval(
          settingsWith({
            providers: { ant: provider("ant", "anthropic") },
            configuredModels: [configuredModel("cm-ant", "ant")],
          })
        )
      ).toBeNull();
    });

    it("drops the Azure provider row and its models", () => {
      const plan = planAzureRemoval(
        settingsWith({
          providers: { az: provider("az", "azure", "kc-az"), ant: provider("ant", "anthropic") },
          configuredModels: [configuredModel("cm-az", "az"), configuredModel("cm-ant", "ant")],
        })
      );
      // The row, its models, its enrollments and its key are the cascade's,
      // so the plan names the row rather than traversing them again.
      expect(plan?.providerIds).toEqual(["az"]);
      expect(plan?.patch.providers).toBeUndefined();
      expect(plan?.patch.configuredModels).toBeUndefined();
    });

    it("repoints an embedding selection that named Azure at the default model (https://github.com/logancyang/obsidian-copilot/issues/2932)", () => {
      const plan = planAzureRemoval(
        settingsWith({ embeddingModelKey: "azure-openai|azure openai" })
      );
      expect(plan?.patch.embeddingModelKey).toBe(DEFAULT_SETTINGS.embeddingModelKey);
    });

    it("repoints the pre-rename `azure_openai` embedding selection too (https://github.com/logancyang/obsidian-copilot/issues/2932)", () => {
      const plan = planAzureRemoval(
        settingsWith({ embeddingModelKey: "azure-openai|azure_openai" })
      );
      expect(plan?.patch.embeddingModelKey).toBe(DEFAULT_SETTINGS.embeddingModelKey);
    });

    it("acts on an embedding selection even when no Azure provider row exists (https://github.com/logancyang/obsidian-copilot/issues/2932)", () => {
      // A vault that only ever used the builtin Azure embedding row has no
      // provider row to find, and the dangling key is what would throw.
      const plan = planAzureRemoval(
        settingsWith({ providers: {}, embeddingModelKey: "azure-openai|azure openai" })
      );
      expect(plan).not.toBeNull();
      expect(plan?.patch.embeddingModelKey).toBe(DEFAULT_SETTINGS.embeddingModelKey);
    });

    it("leaves an embedding selection on another provider alone", () => {
      const plan = planAzureRemoval(
        settingsWith({
          providers: { az: provider("az", "azure") },
          embeddingModelKey: "text-embedding-3-small|openai",
        })
      );
      expect(plan?.patch.embeddingModelKey).toBeUndefined();
    });

    it("removes a legacy Azure chat model and the selection naming it (https://github.com/logancyang/obsidian-copilot/issues/2932)", () => {
      const plan = planAzureRemoval(
        settingsWith({
          activeModels: [
            { name: "gpt-4o", provider: "azure openai", enabled: true, isBuiltIn: false },
            { name: "gpt-5", provider: "openai", enabled: true, isBuiltIn: false },
          ],
          defaultModelKey: "gpt-4o|azure openai",
        })
      );
      expect(plan?.patch.activeModels?.map((m) => m.name)).toEqual(["gpt-5"]);
      expect(plan?.patch.defaultModelKey).toBe("");
    });
  });

  describe("executeAzureRemoval()", () => {
    it("writes no settings and cascades nothing when the vault never configured Azure", async () => {
      keychain();
      const { api, removeProvider } = makeApi();
      await executeAzureRemoval(
        api,
        settingsWith({ providers: { ant: provider("ant", "anthropic") } })
      );
      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(removeProvider).not.toHaveBeenCalled();
    });

    it("hands each Azure row to the cascade rather than deleting it directly", async () => {
      keychain();
      const { api, removeProvider } = makeApi();
      await executeAzureRemoval(
        api,
        settingsWith({
          providers: { az: provider("az", "azure", "kc-az") },
          configuredModels: [configuredModel("cm-az", "az")],
        })
      );
      expect(removeProvider).toHaveBeenCalledWith("az");
    });

    it("writes the embedding repoint (https://github.com/logancyang/obsidian-copilot/issues/2932)", async () => {
      keychain();
      const { api } = makeApi();
      await executeAzureRemoval(
        api,
        settingsWith({ embeddingModelKey: "azure-openai|azure openai" })
      );
      expect(mockSetSettings).toHaveBeenCalledWith(
        expect.objectContaining({ embeddingModelKey: DEFAULT_SETTINGS.embeddingModelKey })
      );
    });

    it("deletes the pre-BYOK top-level key even for a vault with nothing else to clean (https://github.com/logancyang/obsidian-copilot/issues/2932)", async () => {
      const store = keychain();
      const { api } = makeApi();
      await executeAzureRemoval(api, settingsWith({}));
      expect(store.deleteSecret).toHaveBeenCalledWith("azureOpenAIApiKey");
    });
  });
});
