import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import type { Provider } from "@/modelManagement";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// App is threaded via useApp; the destructive flows it powers are not under
// test here, so a bare object is enough.
jest.mock("@/context", () => {
  const app = {};
  return {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
    useApp: () => app,
  };
});

// Keychain reads/writes used by the banner's BYOK presence check and the
// Delete All Keys flow. Individual tests control both.
const getSecretById = jest.fn<string | null, [string]>().mockReturnValue(null);
type SyncMemoryFn = (data: Record<string, unknown>) => void;
const forgetAllSecrets = jest.fn<Promise<void>, [unknown, SyncMemoryFn]>();
jest.mock("@/services/keychainService", () => ({
  KeychainService: {
    getInstance: () => ({
      isAvailable: () => true,
      getSecretById: (id: string) => getSecretById(id),
      forgetAllSecrets: (saveData: unknown, syncMemory: SyncMemoryFn) =>
        forgetAllSecrets(saveData, syncMemory),
    }),
  },
}));

// The barrel drags provider adapters and agent modules into the test; the
// component only needs the leaf presence predicate plus the registry bridge,
// so resolve to the leaf and stub the context hook.
const notifyCredentialStoreChanged = jest.fn();
jest.mock("@/modelManagement", () => ({
  ...jest.requireActual<typeof import("@/modelManagement/providers/providerHasApiKey")>(
    "@/modelManagement/providers/providerHasApiKey"
  ),
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useModelManagement: () => ({
    providerRegistry: {
      notifyCredentialStoreChanged: (): void => {
        notifyCredentialStoreChanged();
      },
    },
  }),
}));

// Auto-confirm the destructive dialog so the flow under test proceeds.
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    #onConfirm: () => void;
    constructor(_app: unknown, onConfirm: () => void) {
      this.#onConfirm = onConfirm;
    }
    open(): void {
      this.#onConfirm();
    }
  },
}));

// Peripheral sections with heavy dependency chains — not under test.
jest.mock("@/settings/v2/components/LegacyChatPromptsNotice", () => ({
  LegacyChatPromptsNotice: () => null,
}));
jest.mock("@/logFileManager", () => ({
  logFileManager: { getLogPath: () => "", append: jest.fn() },
}));
jest.mock("@/LLMProviders/chainRunner/utils/promptPayloadRecorder", () => ({
  flushRecordedPromptPayloadToLog: jest.fn(),
}));
jest.mock("@/settings/copilotSaveData", () => ({ getCopilotSaveData: () => jest.fn() }));
jest.mock("@/services/settingsPersistence", () => ({
  refreshLastPersistedSettings: jest.fn(),
  releaseLegacyCredentialHold: jest.fn(),
  // The flow under test runs inside the transaction; execute it for real.
  runPersistenceTransaction: (fn: () => Promise<void>) => fn(),
  suppressNextPersistOnce: jest.fn(),
}));
// Mobile gate keeps the lazy agentMode import (and its Node-only modules) out.
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => false }));

import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";

const BYOK_POINTER = "copilot-vtest-provider-p1";

const byokProvider = {
  id: "p1",
  displayName: "Test Provider",
  origin: { kind: "byok" },
  requiresApiKey: true,
  apiKeyKeychainId: BYOK_POINTER,
} as unknown as Provider;

function seedSettings(providers: Record<string, Provider>): void {
  settingsStore.set(settingsAtom, {
    ...DEFAULT_SETTINGS,
    providers,
  });
}

describe("AdvancedSettings", () => {
  describe("AdvancedSettings()", () => {
    beforeEach(() => {
      getSecretById.mockReset().mockReturnValue(null);
      forgetAllSecrets.mockReset();
      notifyCredentialStoreChanged.mockReset();
    });

    it("counts a BYOK provider's keychain entry so a BYOK-only setup is not reported as keyless (https://github.com/logancyang/obsidian-copilot-preview/issues/261)", () => {
      getSecretById.mockImplementation((id) => (id === BYOK_POINTER ? "sk-test" : null));
      seedSettings({ p1: byokProvider });

      render(<AdvancedSettings />);

      expect(screen.queryByText(/No API keys found/)).toBeNull();
    });

    it("still reports an empty keychain when no legacy field and no BYOK provider holds a key", () => {
      seedSettings({ p1: byokProvider });

      render(<AdvancedSettings />);

      expect(screen.getByText(/No API keys found/)).toBeTruthy();
    });

    // Subprocess agent backends bake provider keys into spawn-time config and
    // only restart on registry emissions; "Delete All Keys" must announce the
    // wipe through the registry or a running backend keeps using the deleted
    // key. https://github.com/logancyang/obsidian-copilot-preview/issues/261
    it("announces the credential wipe through the registry even when the transaction fails after the sweep ran (https://github.com/logancyang/obsidian-copilot-preview/issues/261)", async () => {
      forgetAllSecrets.mockImplementation(async (_saveData, syncMemory) => {
        // Partial keychain failure: memory was synced, then the error throws.
        syncMemory({ ...DEFAULT_SETTINGS });
        throw new Error("partial keychain failure");
      });
      seedSettings({ p1: byokProvider });
      render(<AdvancedSettings />);

      fireEvent.click(screen.getByRole("button", { name: "Delete All Keys" }));

      await waitFor(() => expect(notifyCredentialStoreChanged).toHaveBeenCalledTimes(1));
    });

    it("does not announce a credential wipe when the transaction returns without touching the stores (https://github.com/logancyang/obsidian-copilot-preview/issues/261)", async () => {
      // Disk-write failure path: forgetAllSecrets swallows the error and
      // returns without ever calling syncMemory — nothing was deleted.
      forgetAllSecrets.mockImplementation(async () => {});
      seedSettings({ p1: byokProvider });
      render(<AdvancedSettings />);

      fireEvent.click(screen.getByRole("button", { name: "Delete All Keys" }));

      await waitFor(() => expect(forgetAllSecrets).toHaveBeenCalledTimes(1));
      expect(notifyCredentialStoreChanged).not.toHaveBeenCalled();
    });
  });
});
