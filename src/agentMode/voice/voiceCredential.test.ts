import type { App } from "obsidian";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";
import {
  readVoiceCredential,
  voiceCredentialKeychainId,
  writeVoiceCredential,
} from "@/agentMode/voice/voiceCredential";

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

interface KeychainStub {
  isAvailable: jest.Mock;
  getVaultId: jest.Mock;
  getSecretById: jest.Mock;
  setSecretById: jest.Mock;
  deleteSecretById: jest.Mock;
}

function keychain(overrides: Partial<KeychainStub> = {}): KeychainStub {
  const instance: KeychainStub = {
    isAvailable: jest.fn(() => true),
    getVaultId: jest.fn(() => "a1b2c3d4"),
    getSecretById: jest.fn(() => null),
    setSecretById: jest.fn(),
    deleteSecretById: jest.fn(),
    ...overrides,
  };
  mockGetInstance.mockReturnValue(instance as unknown as KeychainService);
  return instance;
}

const APP = {} as App;

/** Applies the updater the code passed to `setSettings` to a baseline slice. */
function appliedVoiceSettings(
  current: Partial<CopilotSettings> = {
    agentMode: { voice: { enabled: true, serverUrl: "https://voice.example.com" } },
  } as Partial<CopilotSettings>
): Record<string, unknown> {
  const updater = mockSetSettings.mock.calls[0][0] as (
    settings: CopilotSettings
  ) => Partial<CopilotSettings>;
  const patch = updater(current as CopilotSettings);
  return (patch.agentMode as unknown as Record<string, unknown>).voice as Record<string, unknown>;
}

describe("voiceCredential", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("voiceCredentialKeychainId()", () => {
    it("namespaces the entry under the vault prefix that cleanup sweeps", () => {
      expect(voiceCredentialKeychainId("a1b2c3d4")).toBe("copilot-va1b2c3d4-voice-credential");
    });
  });

  describe("readVoiceCredential()", () => {
    it("returns the stored credential for the configured entry", () => {
      const stub = keychain({ getSecretById: jest.fn(() => "tester-credential") });

      const credential = readVoiceCredential(APP, {
        enabled: true,
        serverUrl: "https://voice.example.com",
        credentialKeychainId: "copilot-va1b2c3d4-voice-credential",
      });

      expect(credential).toBe("tester-credential");
      expect(stub.getSecretById).toHaveBeenCalledWith("copilot-va1b2c3d4-voice-credential");
    });

    it("returns null when no credential has been stored yet", () => {
      keychain();

      expect(readVoiceCredential(APP, { enabled: true, serverUrl: "" })).toBeNull();
    });

    it("returns null when the operating system keychain is unavailable", () => {
      keychain({ isAvailable: jest.fn(() => false) });

      const credential = readVoiceCredential(APP, {
        enabled: true,
        serverUrl: "",
        credentialKeychainId: "copilot-va1b2c3d4-voice-credential",
      });

      expect(credential).toBeNull();
    });
  });

  describe("writeVoiceCredential()", () => {
    it("stores the credential in the keychain and records only its entry id in settings", () => {
      const stub = keychain();

      writeVoiceCredential(APP, "tester-credential");

      expect(stub.setSecretById).toHaveBeenCalledWith(
        "copilot-va1b2c3d4-voice-credential",
        "tester-credential"
      );
      expect(appliedVoiceSettings()).toEqual({
        enabled: true,
        serverUrl: "https://voice.example.com",
        credentialKeychainId: "copilot-va1b2c3d4-voice-credential",
      });
    });

    it("removes the keychain entry and the settings reference when cleared", () => {
      const stub = keychain();

      writeVoiceCredential(APP, "");

      expect(stub.deleteSecretById).toHaveBeenCalledWith("copilot-va1b2c3d4-voice-credential");
      expect(stub.setSecretById).not.toHaveBeenCalled();
      expect(appliedVoiceSettings()).toMatchObject({ credentialKeychainId: undefined });
    });

    it("leaves settings untouched when the operating system keychain is unavailable", () => {
      const stub = keychain({ isAvailable: jest.fn(() => false) });

      writeVoiceCredential(APP, "tester-credential");

      expect(stub.setSecretById).not.toHaveBeenCalled();
      expect(mockSetSettings).not.toHaveBeenCalled();
    });
  });
});
