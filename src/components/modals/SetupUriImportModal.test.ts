/**
 * Tests for SetupUriImportModal — specifically verifying that sparse imports
 * (missing secret fields) start from DEFAULT_SETTINGS so omitted secrets
 * become "" and generate keychain tombstones.
 */

// Reason: must mock obsidian before any import that depends on it.
const mockNotice = jest.fn();
jest.mock("obsidian", () => ({
  App: class App {},
  Modal: class Modal {
    app: unknown;
    contentEl = document.createElement("div");
    constructor(app: unknown) {
      this.app = app;
    }
    open() {}
    close() {}
  },
  Notice: mockNotice,
}));

// Capture the onPersistSettings callback from React render
let capturedOnPersist: ((settings: unknown) => Promise<void>) | null = null;
jest.mock("react-dom/client", () => ({
  createRoot: jest.fn(() => ({
    render: jest.fn((element: { props?: { onPersistSettings?: unknown } }) => {
      if (element?.props?.onPersistSettings) {
        capturedOnPersist = element.props.onPersistSettings as (
          settings: unknown
        ) => Promise<void>;
      }
    }),
    unmount: jest.fn(),
  })),
}));

jest.mock("react", () => ({
  createElement: jest.fn(
    (_type: unknown, props: Record<string, unknown>, ..._children: unknown[]) => ({ props })
  ),
}));

jest.mock("@/components/setup-uri/ImportStepperContent", () => ({
  ImportStepperContent: "ImportStepperContent",
}));

const mockPersistSettings = jest.fn().mockResolvedValue(undefined);
const mockSuppressNextPersistOnce = jest.fn();
jest.mock("@/services/settingsPersistence", () => ({
  persistSettings: (...args: unknown[]) => mockPersistSettings(...args),
  suppressNextPersistOnce: () => mockSuppressNextPersistOnce(),
}));

const mockGetSettings = jest.fn();
const mockReplaceSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  replaceSettings: (s: unknown) => mockReplaceSettings(s),
}));

const mockIsAvailable = jest.fn().mockReturnValue(true);
jest.mock("@/services/keychainService", () => ({
  KeychainService: {
    getInstance: jest.fn(() => ({
      isAvailable: mockIsAvailable,
    })),
  },
}));

import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";
import { SetupUriImportModal } from "./SetupUriImportModal";

/** Match the production heuristic for sensitive keys. */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[_-]/g, "");
  return (
    normalized.includes("apikey") ||
    lower.endsWith("token") ||
    lower.endsWith("accesstoken") ||
    lower.endsWith("secret") ||
    lower.endsWith("password") ||
    lower.endsWith("licensekey")
  );
}

describe("SetupUriImportModal", () => {
  const mockApp = {} as InstanceType<typeof import("obsidian").App>;
  const mockSaveData = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnPersist = null;

    // Simulate current local settings with a vault ID and a stale secret
    mockGetSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      _keychainVaultId: "vault1234",
      _diskSecretsCleared: true,
      openAIApiKey: "old-stale-key",
      anthropicApiKey: "old-anthropic-key",
    } as CopilotSettings);
  });

  /**
   * Open the modal and return the captured onPersistSettings callback.
   */
  function openAndCapture(): (settings: CopilotSettings) => Promise<void> {
    const modal = new SetupUriImportModal(mockApp, mockSaveData);
    modal.onOpen();
    expect(capturedOnPersist).not.toBeNull();
    return capturedOnPersist!;
  }

  it("fills omitted secret fields with empty strings from DEFAULT_SETTINGS", async () => {
    const onPersist = openAndCapture();

    // Sparse payload: only has anthropicApiKey, missing openAIApiKey and others
    const sparsePayload = {
      anthropicApiKey: "sk-ant-new",
      defaultChainType: "llm_chain",
    } as unknown as CopilotSettings;

    await onPersist(sparsePayload);

    expect(mockPersistSettings).toHaveBeenCalledTimes(1);
    const mergedSettings = mockPersistSettings.mock.calls[0][0] as Record<string, unknown>;

    // Imported field is preserved
    expect(mergedSettings.anthropicApiKey).toBe("sk-ant-new");

    // Omitted secret fields should be "" (from DEFAULT_SETTINGS), not undefined
    expect(mergedSettings.openAIApiKey).toBe("");
    expect(mergedSettings.googleApiKey).toBe("");
    expect(mergedSettings.huggingfaceApiKey).toBe("");
  });

  it("preserves vault-local fields from current settings", async () => {
    const onPersist = openAndCapture();

    await onPersist({ anthropicApiKey: "sk-ant-new" } as unknown as CopilotSettings);

    const mergedSettings = mockPersistSettings.mock.calls[0][0] as Record<string, unknown>;

    // Vault-local fields preserved from current settings
    expect(mergedSettings._keychainVaultId).toBe("vault1234");
  });

  it("passes current settings as prevSettings for tombstone computation", async () => {
    const onPersist = openAndCapture();

    await onPersist({ anthropicApiKey: "sk-ant-new" } as unknown as CopilotSettings);

    // persistSettings receives currentLocal as the 3rd arg (prevSettings)
    const prevSettings = mockPersistSettings.mock.calls[0][2] as Record<string, unknown>;
    expect(prevSettings.openAIApiKey).toBe("old-stale-key");
  });

  it("ensures all top-level secret fields are present (not undefined) in merged output", async () => {
    const onPersist = openAndCapture();

    // Completely empty payload — no secrets at all
    await onPersist({} as CopilotSettings);

    const mergedSettings = mockPersistSettings.mock.calls[0][0] as Record<string, unknown>;

    // Every sensitive key from DEFAULT_SETTINGS should be present as ""
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!isSensitiveKey(key)) continue;
      expect(mergedSettings[key]).toBeDefined();
      expect(typeof mergedSettings[key]).toBe("string");
    }
  });
});
