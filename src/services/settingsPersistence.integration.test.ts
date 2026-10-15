import type { App } from "obsidian";

import { DEFAULT_SETTINGS } from "@/constants";
import type { Provider } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { loadSettingsWithKeychain, resetPersistenceState } from "@/services/settingsPersistence";
import type { CopilotSettings } from "@/settings/model";
import { md5 } from "@/utils/hash";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
}

const noLegacyBackup = async () => ({ status: "not-needed" }) as const;

const VAULT_PATH = "/Users/test/Notes";
const THIS_DEVICE_VAULT_ID = md5(VAULT_PATH).slice(0, 8);
const OTHER_DEVICE_VAULT_ID = "0a1b2c3d";

let secrets: Map<string, string>;

function makeApp(): App {
  return {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    vault: { adapter: { getBasePath: () => VAULT_PATH } },
  } as unknown as App;
}

function anthropicRow(apiKeyKeychainId: string): Provider {
  return {
    providerId: "row-anthropic",
    providerType: "anthropic",
    displayName: "Anthropic",
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
    requiresApiKey: true,
    apiKeyKeychainId,
  };
}

function diskSettings(vaultId: string, pointer: string): CopilotSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    _keychainVaultId: vaultId,
    isPaidUser: true,
    providers: { "row-anthropic": anthropicRow(pointer) },
  } as unknown as CopilotSettings;
}

async function load(
  app: App,
  raw: unknown
): Promise<{ settings: CopilotSettings; saved: CopilotSettings | undefined }> {
  let saved: CopilotSettings | undefined;
  const settings = await loadSettingsWithKeychain(
    app,
    raw,
    async (data) => {
      saved = structuredClone(data);
    },
    noLegacyBackup
  );
  return { settings, saved };
}

function apiKeyFor(app: App, settings: CopilotSettings): string | null {
  const pointer = settings.providers["row-anthropic"].apiKeyKeychainId!;
  return KeychainService.getInstance(app).getSecretById(pointer);
}

describe("settingsPersistence", () => {
  describe("loadSettingsWithKeychain()", () => {
    beforeEach(() => {
      secrets = new Map();
      resetPersistenceState();
      KeychainService.resetInstance();
    });

    it("keeps an upgrading user's license key and provider key working without re-entry, across repeated loads (https://github.com/logancyang/obsidian-copilot/issues/3618)", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      const legacyPointer = `copilot-v${THIS_DEVICE_VAULT_ID}-provider-row-anthropic`;
      secrets.set(`copilot-v${THIS_DEVICE_VAULT_ID}-plus-license-key`, "lic-12345");
      secrets.set(legacyPointer, "sk-ant-12345");

      const { settings: first, saved } = await load(
        app,
        diskSettings(THIS_DEVICE_VAULT_ID, legacyPointer)
      );
      resetPersistenceState();
      const { settings: second } = await load(app, saved);

      expect(first.plusLicenseKey).toBe("lic-12345");
      expect(first.providers["row-anthropic"].apiKeyKeychainId).toBe("copilot-anthropic-api-key");
      expect(apiKeyFor(app, first)).toBe("sk-ant-12345");
      expect(saved?.providers["row-anthropic"].apiKeyKeychainId).toBe("copilot-anthropic-api-key");
      expect(saved).not.toHaveProperty("_keychainVaultId");
      expect(second.plusLicenseKey).toBe("lic-12345");
      expect(apiKeyFor(app, second)).toBe("sk-ant-12345");
    });

    it("resolves keys on a device whose data.json was overwritten by another device's sync (https://github.com/logancyang/obsidian-copilot/issues/3618)", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      secrets.set(`copilot-v${THIS_DEVICE_VAULT_ID}-plus-license-key`, "lic-12345");
      secrets.set(`copilot-v${THIS_DEVICE_VAULT_ID}-provider-row-anthropic`, "sk-ant-12345");

      const { settings: loaded } = await load(
        app,
        diskSettings(
          OTHER_DEVICE_VAULT_ID,
          `copilot-v${OTHER_DEVICE_VAULT_ID}-provider-row-anthropic`
        )
      );

      expect(loaded.plusLicenseKey).toBe("lic-12345");
      expect(apiKeyFor(app, loaded)).toBe("sk-ant-12345");
    });
  });
});
