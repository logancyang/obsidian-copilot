/**
 * Tests for KeychainMigrationModal — specifically verifying that handleKeepKeys
 * only dismisses the modal after successful persistence, and shows a Notice on failure.
 */

// Reason: must mock obsidian before any import that depends on it.
const mockNotice = jest.fn();
const mockSuperClose = jest.fn();
jest.mock("obsidian", () => ({
  App: class App {},
  Modal: class Modal {
    app: unknown;
    contentEl = document.createElement("div");
    constructor(app: unknown) {
      this.app = app;
    }
    open() {}
    close() {
      mockSuperClose();
    }
  },
  Notice: mockNotice,
}));

// Capture the onKeepConfirmed callback from React render
let capturedOnKeep: (() => void) | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- captured for future handleClearKeys tests
let capturedOnRemove: (() => void) | null = null;
jest.mock("react-dom/client", () => ({
  createRoot: jest.fn(() => ({
    render: jest.fn(
      (element: { props?: { onKeepConfirmed?: unknown; onRemoveConfirmed?: unknown } }) => {
        if (element?.props?.onKeepConfirmed) {
          capturedOnKeep = element.props.onKeepConfirmed as () => void;
        }
        if (element?.props?.onRemoveConfirmed) {
          capturedOnRemove = element.props.onRemoveConfirmed as () => void;
        }
      }
    ),
    unmount: jest.fn(),
  })),
}));

jest.mock("react", () => ({
  createElement: jest.fn(
    (_type: unknown, props: Record<string, unknown>, ..._children: unknown[]) => ({ props })
  ),
  useState: jest.fn(),
  useEffect: jest.fn(),
  useRef: jest.fn(),
}));

jest.mock("@/components/ui/button", () => ({ Button: "Button" }));
jest.mock("lucide-react", () => ({
  AlertTriangle: "AlertTriangle",
  ArrowLeft: "ArrowLeft",
  Clock: "Clock",
  Info: "Info",
  ShieldCheck: "ShieldCheck",
  Smartphone: "Smartphone",
  Trash2: "Trash2",
}));

const mockRunTransaction = jest.fn();
const mockRefreshDiskHasSecrets = jest.fn();
const mockSuppressNextPersistOnce = jest.fn();
const mockCanClearDiskSecrets = jest.fn().mockReturnValue(true);
jest.mock("@/services/settingsPersistence", () => ({
  runPersistenceTransaction: (task: () => Promise<void>) => mockRunTransaction(task),
  refreshDiskHasSecrets: (data: unknown) => mockRefreshDiskHasSecrets(data),
  refreshLastPersistedSettings: jest.fn(),
  suppressNextPersistOnce: () => mockSuppressNextPersistOnce(),
  canClearDiskSecrets: () => mockCanClearDiskSecrets(),
}));

const mockGetSettings = jest.fn();
const mockSetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  setSettings: (s: unknown) => mockSetSettings(s),
}));

jest.mock("@/services/settingsSecretTransforms", () => ({
  stripKeychainFields: jest.fn((s: unknown) => s),
  cleanupLegacyFields: jest.fn((s: unknown) => s),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
}));

import { KeychainMigrationModal } from "./KeychainMigrationModal";

describe("KeychainMigrationModal — handleKeepKeys", () => {
  const mockApp = {} as InstanceType<typeof import("obsidian").App>;
  const mockSaveData = jest.fn();
  const mockLoadData = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnKeep = null;
    capturedOnRemove = null;

    mockGetSettings.mockReturnValue({ openAIApiKey: "sk-test" });
    mockLoadData.mockResolvedValue({ openAIApiKey: "sk-test" });

    // Default: runPersistenceTransaction executes the task inline
    mockRunTransaction.mockImplementation(async (task: () => Promise<void>) => task());
    mockSaveData.mockResolvedValue(undefined);
  });

  /**
   * Open the modal and return the captured callbacks.
   */
  function openModal(): {
    modal: KeychainMigrationModal;
    onKeep: () => void;
  } {
    const modal = new KeychainMigrationModal(mockApp, mockSaveData, mockLoadData);
    modal.onOpen();
    expect(capturedOnKeep).not.toBeNull();
    return { modal, onKeep: capturedOnKeep! };
  }

  it("dismisses the modal after successful persistence", async () => {
    const { onKeep } = openModal();

    // Invoke handleKeepKeys (via the captured callback)
    await onKeep();

    // saveData should have been called with the snapshot + timestamp
    expect(mockSaveData).toHaveBeenCalledTimes(1);
    const savedData = mockSaveData.mock.calls[0][0] as Record<string, unknown>;
    expect(savedData._migrationModalDismissed).toBe(true);

    // setSettings should have been called with the dismissal flag
    expect(mockSetSettings).toHaveBeenCalledTimes(1);
    const settingsArg = mockSetSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(settingsArg._migrationModalDismissed).toBe(true);

    // Modal should have closed (super.close called)
    expect(mockSuperClose).toHaveBeenCalled();
  });

  it("does NOT dismiss the modal when persistence fails", async () => {
    // Make the saveData call fail inside the transaction
    mockSaveData.mockRejectedValue(new Error("disk write failed"));

    const { onKeep } = openModal();

    await onKeep();

    // Modal should NOT have closed
    expect(mockSuperClose).not.toHaveBeenCalled();

    // User should see a Notice about the failure
    expect(mockNotice).toHaveBeenCalledWith("Failed to save your choice. Please try again.");
  });

  it("does NOT dismiss the modal when runPersistenceTransaction rejects", async () => {
    // Make the entire transaction reject
    mockRunTransaction.mockRejectedValue(new Error("queue error"));

    const { onKeep } = openModal();

    await onKeep();

    // Modal stays open
    expect(mockSuperClose).not.toHaveBeenCalled();

    // User notified
    expect(mockNotice).toHaveBeenCalledWith("Failed to save your choice. Please try again.");
  });

  it("calls suppressNextPersistOnce before setSettings", async () => {
    const { onKeep } = openModal();

    await onKeep();

    // suppressNextPersistOnce must be called before setSettings
    const suppressOrder = mockSuppressNextPersistOnce.mock.invocationCallOrder[0];
    const setSettingsOrder = mockSetSettings.mock.invocationCallOrder[0];
    expect(suppressOrder).toBeLessThan(setSettingsOrder);
  });
});
