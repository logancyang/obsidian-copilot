/**
 * Behavior tests for the chat model picker's credential gating.
 *
 * These drive the REAL invalidation chain end to end — `forgetAllSecrets()` /
 * `ProviderRegistry.setApiKey()` → settings store → `providersAtom` →
 * `backendPickerAtomFamily("chat")` → the hook's memo → `_disabledReason` —
 * rather than asserting that a row object was cloned. A future change that
 * breaks any link in that chain (atom dependency, memo deps, `syncMemory`
 * wiring) fails here, which identity assertions could not catch.
 */

import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { App } from "obsidian";

import { AppContext } from "@/context";
import { KeychainService } from "@/services/keychainService";
import { ProviderAdapterRegistry, ProviderRegistry } from "@/modelManagement";
import type { Provider } from "@/modelManagement";
import {
  getSettings,
  resetSettings,
  setSettings,
  settingsStore,
  settingsAtom,
} from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";

import { useChatModelPicker } from "./useChatModelPicker";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const KEYCHAIN_ID = "copilot-vtest0000-provider-p1";

let secrets: Map<string, string>;
let app: App;

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

function seedConfiguredProvider(): void {
  const provider: Provider = {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "My OpenAI",
    origin: { kind: "byok", catalogProviderId: "openai" },
    addedAt: 0,
    requiresApiKey: true,
    apiKeyKeychainId: KEYCHAIN_ID,
  };
  setSettings({
    providers: { p1: provider },
    configuredModels: [
      {
        configuredModelId: "cm1",
        providerId: "p1",
        info: { id: "gpt-4", displayName: "GPT-4" },
        configuredAt: 0,
      },
    ],
    backends: { chat: { enabledModels: ["cm1"] } },
  });
}

function renderPicker() {
  return renderHook(() => useChatModelPicker({ value: "cm1", onChange: jest.fn() }), {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(AppContext.Provider, { value: app }, children),
  });
}

/**
 * The reason the picker shows for the seeded model, or `undefined`.
 *
 * Selected by name because the picker also advertises locked Copilot preview
 * rows ahead of the configured ones.
 */
function disabledReason(result: { current: ReturnType<typeof useChatModelPicker> }) {
  return result.current.models.find((model) => model.name === "cm1")?._disabledReason;
}

describe("useChatModelPicker", () => {
  describe("useChatModelPicker()", () => {
    beforeEach(() => {
      secrets = new Map();
      app = makeApp();
      resetSettings();
      KeychainService.resetInstance();
      KeychainService.getInstance(app).setVaultId("test0000");
      seedConfiguredProvider();
    });

    it("leaves a model selectable while its provider's key is in this device's keychain", () => {
      secrets.set(KEYCHAIN_ID, "sk-live");
      const { result } = renderPicker();
      expect(result.current.models.some((model) => model.name === "cm1")).toBe(true);
      expect(disabledReason(result)).toBeUndefined();
    });

    it("gates the model behind 'Add API key' once Delete All Keys removes the entry, then clears the gate when the key is re-entered under the same pointer (https://github.com/logancyang/obsidian-copilot-preview/issues/261)", async () => {
      secrets.set(KEYCHAIN_ID, "sk-live");
      const { result } = renderPicker();
      expect(disabledReason(result)).toBeUndefined();

      // Real Delete All Keys: strips secrets, clears this vault's keychain, and
      // syncs memory. The provider row keeps its pointer, so only the fresh slice
      // identity can make the picker re-read the keychain.
      await act(async () => {
        await KeychainService.getInstance(app).forgetAllSecrets(
          async () => {},
          (data: Partial<CopilotSettings>) => setSettings(data)
        );
      });
      expect(secrets.has(KEYCHAIN_ID)).toBe(false);
      expect(getSettings().providers.p1.apiKeyKeychainId).toBe(KEYCHAIN_ID);
      expect(disabledReason(result)).toBe("Add API key");

      // Real re-entry: same provider, same derived pointer, keychain-only write.
      const registry = new ProviderRegistry(app, new ProviderAdapterRegistry());
      await act(async () => {
        await registry.setApiKey("p1", "sk-fresh");
      });
      expect(disabledReason(result)).toBeUndefined();
    });

    it("keeps a keyless provider's model selectable — presence is only asked of key-requiring providers", () => {
      settingsStore.set(settingsAtom, (prev) => ({
        ...prev,
        providers: {
          p1: { ...prev.providers.p1, requiresApiKey: false },
        },
      }));
      const { result } = renderPicker();
      expect(disabledReason(result)).toBeUndefined();
    });
  });
});
