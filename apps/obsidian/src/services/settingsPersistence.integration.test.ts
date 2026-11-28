import type { App } from "obsidian";

import { DEFAULT_SETTINGS } from "@/constants";
import type { Provider } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { loadSettingsWithKeychain, resetPersistenceState } from "@/services/settingsPersistence";
import type { CopilotSettings } from "@/settings/model";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
}

const noLegacyBackup = async () => ({ status: "not-needed" }) as const;

const VAULT_ID = "1234abcd";
const STABLE_NAME = `copilot-v${VAULT_ID}-provider-anthropic-api-key`;

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
    vault: { adapter: {} },
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

function diskSettings(pointer: string): CopilotSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    _keychainVaultId: VAULT_ID,
    isPaidUser: true,
    providers: { "row-anthropic": anthropicRow(pointer) },
  };
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
      const legacyPointer = `copilot-v${VAULT_ID}-provider-row-anthropic`;
      secrets.set(`copilot-v${VAULT_ID}-plus-license-key`, "lic-12345");
      secrets.set(legacyPointer, "sk-ant-12345");

      const { settings: first, saved } = await load(app, diskSettings(legacyPointer));
      resetPersistenceState();
      const { settings: second } = await load(app, saved);

      expect(first.plusLicenseKey).toBe("lic-12345");
      expect(first.providers["row-anthropic"].apiKeyKeychainId).toBe(STABLE_NAME);
      expect(apiKeyFor(app, first)).toBe("sk-ant-12345");
      expect(saved?.providers["row-anthropic"].apiKeyKeychainId).toBe(STABLE_NAME);
      expect(saved?._keychainVaultId).toBe(VAULT_ID);
      expect(second.plusLicenseKey).toBe("lic-12345");
      expect(apiKeyFor(app, second)).toBe("sk-ant-12345");
    });

    it("resolves this device's key after another device's sync already rewrote the provider pointer (https://github.com/logancyang/obsidian-copilot/issues/3618)", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      secrets.set(`copilot-v${VAULT_ID}-provider-row-anthropic`, "sk-ant-12345");

      const { settings: loaded } = await load(app, diskSettings(STABLE_NAME));

      expect(apiKeyFor(app, loaded)).toBe("sk-ant-12345");
    });
  });
});
