import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import type { Provider } from "@/modelManagement";
import { render, screen } from "@testing-library/react";
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

// Keychain read used by the banner's BYOK presence check. Individual tests
// control what the pointer resolves to.
const getSecretById = jest.fn<string | null, [string]>().mockReturnValue(null);
jest.mock("@/services/keychainService", () => ({
  KeychainService: {
    getInstance: () => ({
      isAvailable: () => true,
      getSecretById: (id: string) => getSecretById(id),
    }),
  },
}));

// The barrel drags provider adapters and agent modules into the test; the
// banner only needs the leaf presence predicate, so resolve to that module.
jest.mock("@/modelManagement", () =>
  jest.requireActual<typeof import("@/modelManagement/providers/providerHasApiKey")>(
    "@/modelManagement/providers/providerHasApiKey"
  )
);

// Peripheral sections with heavy dependency chains — not under test.
jest.mock("@/settings/v2/components/LegacyChatPromptsNotice", () => ({
  LegacyChatPromptsNotice: () => null,
}));
jest.mock("@/logFileManager", () => ({ logFileManager: { getLogPath: () => "" } }));
jest.mock("@/LLMProviders/chainRunner/utils/promptPayloadRecorder", () => ({
  flushRecordedPromptPayloadToLog: jest.fn(),
}));
jest.mock("@/settings/copilotSaveData", () => ({ getCopilotSaveData: () => jest.fn() }));
jest.mock("@/services/settingsPersistence", () => ({
  refreshLastPersistedSettings: jest.fn(),
  releaseLegacyCredentialHold: jest.fn(),
  runPersistenceTransaction: jest.fn(),
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
  });
});
