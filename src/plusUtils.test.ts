import { DEFAULT_SETTINGS } from "@/constants";
import type { CopilotSettings } from "@/settings/model";

const mockGetSettings = jest.fn<CopilotSettings, []>();
const mockSetSettings = jest.fn<void, [Partial<CopilotSettings>]>();
const mockUpdateSetting = jest.fn<void, [string, unknown]>();

type SettingsListener = (prev: CopilotSettings, next: CopilotSettings) => void;
const settingsListeners = new Set<SettingsListener>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  setSettings: (partial: Partial<CopilotSettings>) => mockSetSettings(partial),
  updateSetting: (key: string, value: unknown) => mockUpdateSetting(key, value),
  useSettingsValue: () => mockGetSettings(),
  subscribeToSettingsChange: (callback: SettingsListener) => {
    settingsListeners.add(callback);
    return () => settingsListeners.delete(callback);
  },
}));

function emitSettings(next: CopilotSettings): void {
  const prev = mockGetSettings();
  mockGetSettings.mockReturnValue(next);
  for (const listener of [...settingsListeners]) listener(prev, next);
}

const mockVerifyEntitlement = jest.fn<Promise<unknown>, [string, unknown?]>();

jest.mock("@/entitlement", () => ({
  verifyEntitlement: (...args: [string, unknown?]) => mockVerifyEntitlement(...args),
}));

const mockValidateLicenseKey = jest.fn<
  Promise<{ isValid: boolean | undefined }>,
  [unknown, Record<string, unknown>]
>();

jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      validateLicenseKey: (app: unknown, context: Record<string, unknown>) =>
        mockValidateLicenseKey(app, context),
    }),
  },
}));

const mockSetModelKey = jest.fn<void, [string]>();

jest.mock("@/aiParams", () => ({
  setModelKey: (key: string) => mockSetModelKey(key),
}));

const mockIsDesktopRuntime = jest.fn<boolean, []>();

jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: () => mockIsDesktopRuntime(),
}));

const mockApplyCopilotDefaultModel = jest.fn<string[], [string]>();

jest.mock("@/agentMode", () => ({
  applyCopilotDefaultModel: (configuredModelId: string) =>
    mockApplyCopilotDefaultModel(configuredModelId),
}));

import {
  applyAccountLicense,
  applyEntitlement,
  applyLicenseSettings,
  isAccountLicense,
  isUsingLicensedModels,
  checkIsPaidUser,
  ensureEntitlement,
  hasVerifiedFeature,
  isEntitlementExpired,
  isEntitlementVerificationPending,
  isSelfHostModeValid,
  markPaidPendingEntitlement,
  navigateToPlusPage,
  removeLicense,
  turnOffPaid,
  subscribeToEntitlementChange,
  useIsSelfHostEligible,
  useLicenseState,
  verifyCachedEntitlement,
} from "@/plusUtils";
import { sha256 } from "@/utils/hash";
import { renderHook, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";

const FUTURE_EXP_SECONDS = 9_999_999_999;
const PAST_EXP_SECONDS = 1_000_000_000;
const STORED_LICENSE_KEY = "key";

function buildSettings(overrides: Partial<CopilotSettings>): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

async function verifySessionFeatures(
  features: string[],
  expSeconds: number = FUTURE_EXP_SECONDS
): Promise<void> {
  mockVerifyEntitlement.mockResolvedValue({
    user_id: "user-123",
    plan: "believer",
    tier: "plus",
    features,
    iat: 0,
    exp: expSeconds,
  });
  mockGetSettings.mockReturnValue(
    buildSettings({
      userId: "user-123",
      entitlementToken: "token",
      plusLicenseKey: STORED_LICENSE_KEY,
    })
  );
  await verifyCachedEntitlement();
}

function tokenBackedSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return buildSettings({
    userId: "user-123",
    entitlementToken: "token",
    plusLicenseKey: STORED_LICENSE_KEY,
    entitlementExpiresAt: Date.now() + 60_000,
    ...overrides,
  });
}

async function verifySessionClaims(
  claims: Partial<{ plan: string; tier: string; features: string[]; exp: number }>
): Promise<void> {
  mockVerifyEntitlement.mockResolvedValue({
    user_id: "user-123",
    plan: "believer",
    tier: "plus",
    features: [],
    iat: 0,
    exp: FUTURE_EXP_SECONDS,
    ...claims,
  });
  mockGetSettings.mockReturnValue(
    buildSettings({
      userId: "user-123",
      entitlementToken: "token",
      plusLicenseKey: STORED_LICENSE_KEY,
    })
  );
  await verifyCachedEntitlement();
}

describe("plusUtils", () => {
  beforeEach(async () => {
    mockSetSettings.mockClear();
    mockUpdateSetting.mockClear();
    mockSetModelKey.mockClear();
    mockVerifyEntitlement.mockReset();
    mockValidateLicenseKey.mockReset();
    mockApplyCopilotDefaultModel.mockReset().mockReturnValue([]);
    mockIsDesktopRuntime.mockReturnValue(true);
    (Notice as unknown as jest.Mock).mockClear();
    settingsListeners.clear();
    mockGetSettings.mockReturnValue(buildSettings({ entitlementToken: "" }));
    await verifyCachedEntitlement();
  });

  describe("navigateToPlusPage()", () => {
    afterEach(() => jest.restoreAllMocks());

    it.each(["settings", "multi_agent", "chat_mode_select", "expired_modal"] as const)(
      "opens pricing with the %s placement and shared source — https://github.com/Brevilabs/obsidian-copilot-private/issues/640",
      (medium) => {
        const open = jest.spyOn(window, "open").mockImplementation(() => null);

        navigateToPlusPage(medium);

        expect(open).toHaveBeenCalledWith(
          `https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=${medium}`,
          "_blank"
        );
      }
    );
  });

  describe("applyLicenseSettings()", () => {
    const FLASH_CONFIGURED_ID = "cm-flash";

    function settingsWithFlashConfigured(): CopilotSettings {
      return buildSettings({
        providers: {
          "plus-1": {
            providerId: "plus-1",
            origin: { kind: "copilot-plus" },
            providerType: "openai-compatible",
            displayName: "Copilot",
            addedAt: 0,
          },
        },
        configuredModels: [
          {
            configuredModelId: FLASH_CONFIGURED_ID,
            providerId: "plus-1",
            info: { id: "copilot-plus-flash", displayName: "Copilot Plus Flash" },
            configuredAt: 0,
          },
        ],
      });
    }

    it("makes the configured Copilot model the chat default", async () => {
      mockGetSettings.mockReturnValue(settingsWithFlashConfigured());

      await applyLicenseSettings();

      expect(mockSetModelKey).toHaveBeenCalledWith(FLASH_CONFIGURED_ID);
      expect(mockSetSettings).toHaveBeenCalledWith({ defaultModelKey: FLASH_CONFIGURED_ID });
    });

    it("writes no chain type or embedding model — both belong to retired surfaces", async () => {
      mockGetSettings.mockReturnValue(settingsWithFlashConfigured());

      await applyLicenseSettings();

      const written = mockSetSettings.mock.calls.flatMap((call) => Object.keys(call[0]));
      expect(written).toEqual(["defaultModelKey"]);
    });

    it("seeds the agent default model on desktop", async () => {
      mockGetSettings.mockReturnValue(settingsWithFlashConfigured());
      mockApplyCopilotDefaultModel.mockReturnValue(["opencode"]);

      await applyLicenseSettings();

      expect(mockApplyCopilotDefaultModel).toHaveBeenCalledWith(FLASH_CONFIGURED_ID);
    });

    it("still sets the chat default on mobile, where Agent Mode cannot load", async () => {
      mockIsDesktopRuntime.mockReturnValue(false);
      mockGetSettings.mockReturnValue(settingsWithFlashConfigured());

      await applyLicenseSettings();

      expect(mockSetSettings).toHaveBeenCalledWith({ defaultModelKey: FLASH_CONFIGURED_ID });
      expect(mockApplyCopilotDefaultModel).not.toHaveBeenCalled();
    });

    it("applies once provider sync enrolls the model, rather than no-opping on a click that beat it", async () => {
      mockGetSettings.mockReturnValue(buildSettings({}));

      const applied = applyLicenseSettings();
      expect(mockSetSettings).not.toHaveBeenCalled();

      emitSettings(settingsWithFlashConfigured());
      await applied;

      expect(mockSetModelKey).toHaveBeenCalledWith(FLASH_CONFIGURED_ID);
      expect(mockSetSettings).toHaveBeenCalledWith({ defaultModelKey: FLASH_CONFIGURED_ID });
      expect(mockApplyCopilotDefaultModel).toHaveBeenCalledWith(FLASH_CONFIGURED_ID);
    });

    it("ignores settings changes that still lack the model", async () => {
      mockGetSettings.mockReturnValue(buildSettings({}));

      const applied = applyLicenseSettings();
      emitSettings(buildSettings({ userId: "user-123" }));
      expect(mockSetSettings).not.toHaveBeenCalled();

      emitSettings(settingsWithFlashConfigured());
      await applied;

      expect(mockSetSettings).toHaveBeenCalledWith({ defaultModelKey: FLASH_CONFIGURED_ID });
    });

    it("stops waiting and tells the user when the model never arrives", async () => {
      jest.useFakeTimers();
      try {
        mockGetSettings.mockReturnValue(buildSettings({}));

        const applied = applyLicenseSettings();
        jest.advanceTimersByTime(15_000);
        await applied;

        expect(mockSetModelKey).not.toHaveBeenCalled();
        expect(mockSetSettings).not.toHaveBeenCalled();
        expect(mockApplyCopilotDefaultModel).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("leaves no settings listener behind once it settles", async () => {
      mockGetSettings.mockReturnValue(buildSettings({}));

      const applied = applyLicenseSettings();
      emitSettings(settingsWithFlashConfigured());
      await applied;

      expect(settingsListeners.size).toBe(0);
    });

    it("ignores a model of the same name that a non-Copilot provider supplies", async () => {
      mockGetSettings.mockReturnValue(
        buildSettings({
          providers: {
            "byok-1": {
              providerId: "byok-1",
              origin: { kind: "byok" },
              providerType: "openai-compatible",
              displayName: "Some BYOK provider",
              addedAt: 0,
            },
          },
          configuredModels: [
            {
              configuredModelId: "cm-impostor",
              providerId: "byok-1",
              info: { id: "copilot-plus-flash", displayName: "Copilot Plus Flash" },
              configuredAt: 0,
            },
          ],
        })
      );

      jest.useFakeTimers();
      try {
        const applied = applyLicenseSettings();
        jest.advanceTimersByTime(15_000);
        await applied;
      } finally {
        jest.useRealTimers();
      }

      expect(mockSetSettings).not.toHaveBeenCalled();
    });

    it("keeps the chat default when agent seeding throws", async () => {
      mockGetSettings.mockReturnValue(settingsWithFlashConfigured());
      mockApplyCopilotDefaultModel.mockImplementation(() => {
        throw new Error("registry unavailable");
      });

      await expect(applyLicenseSettings()).resolves.toBeUndefined();
      expect(mockSetSettings).toHaveBeenCalledWith({ defaultModelKey: FLASH_CONFIGURED_ID });
    });
  });

  describe("isUsingLicensedModels()", () => {
    it("is true when the chat default is a Copilot model", () => {
      const settings = buildSettings({
        defaultModelKey: "cm-flash",
        providers: {
          "plus-1": {
            providerId: "plus-1",
            origin: { kind: "copilot-plus" },
            providerType: "openai-compatible",
            displayName: "Copilot",
            addedAt: 0,
          },
        },
        configuredModels: [
          {
            configuredModelId: "cm-flash",
            providerId: "plus-1",
            info: { id: "copilot-plus-flash", displayName: "Copilot Plus Flash" },
            configuredAt: 0,
          },
        ],
      });
      mockGetSettings.mockReturnValue(settings);

      expect(isUsingLicensedModels(settings)).toBe(true);
    });

    it("is true for an agent still defaulted to a Copilot model after chat moved off it", () => {
      const settings = buildSettings({
        defaultModelKey: "cm-byok",
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          backends: {
            opencode: {
              defaultModel: { baseModelId: "copilot-plus/copilot-plus-flash", effort: null },
            },
          },
        },
      });
      mockGetSettings.mockReturnValue(settings);

      expect(isUsingLicensedModels(settings)).toBe(true);
    });

    it("ignores a BYOK model whose wire id merely resembles the licensed one", () => {
      const settings = buildSettings({
        defaultModelKey: "cm-byok",
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          backends: {
            opencode: {
              defaultModel: { baseModelId: "openrouter/copilot-plus-flash", effort: null },
            },
            codex: { defaultModel: { baseModelId: "copilot-plus-flash-v2", effort: null } },
          },
        },
      });
      mockGetSettings.mockReturnValue(settings);

      expect(isUsingLicensedModels(settings)).toBe(false);
    });

    it("is false when neither chat nor any agent points at a Copilot model", () => {
      const settings = buildSettings({
        defaultModelKey: "cm-byok",
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          backends: {
            opencode: {
              defaultModel: { baseModelId: "anthropic/claude-sonnet-4-5", effort: null },
            },
            claude: { defaultModel: null },
          },
        },
      });
      mockGetSettings.mockReturnValue(settings);

      expect(isUsingLicensedModels(settings)).toBe(false);
    });
  });

  describe("isSelfHostModeValid()", () => {
    it("is true when the toggle is on and the entitlement grants self-host", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));

      expect(isSelfHostModeValid()).toBe(true);
    });

    it("is false when the entitlement grants self-host but the toggle is off", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: false }));

      expect(isSelfHostModeValid()).toBe(false);
    });

    it("is false for a Plus token that does not carry the self_host feature", async () => {
      await verifySessionFeatures(["multi_agent"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));

      expect(isSelfHostModeValid()).toBe(false);
    });

    it("is false when no token was verified this session (edited data.json)", () => {
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, isPlusUser: true })
      );

      expect(isSelfHostModeValid()).toBe(false);
    });

    it("is false once the signed exp has passed, even with the persisted expiry edited forward", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"], PAST_EXP_SECONDS);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({
          enableSelfHostMode: true,
          entitlementExpiresAt: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
        })
      );

      expect(isSelfHostModeValid()).toBe(false);
    });

    it("stays open while the signed exp holds, even with the persisted expiry in the past", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, entitlementExpiresAt: Date.now() - 1000 })
      );

      expect(isSelfHostModeValid()).toBe(true);
    });

    it.each([
      ["turnOffPaid", turnOffPaid],
      ["markPaidPendingEntitlement", markPaidPendingEntitlement],
    ])("revokes self-host once %s drops the token", async (_name, clear) => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));
      expect(isSelfHostModeValid()).toBe(true);

      clear();
      mockGetSettings.mockReturnValue(
        buildSettings({ enableSelfHostMode: true, entitlementToken: "", entitlementExpiresAt: 0 })
      );

      expect(isSelfHostModeValid()).toBe(false);
    });
  });

  describe("hasVerifiedFeature()", () => {
    it("is true for a feature carried by the token verified this session for the stored license key", async () => {
      await verifySessionFeatures(["navigator"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings());

      expect(hasVerifiedFeature("navigator")).toBe(true);
      expect(hasVerifiedFeature("multi_agent")).toBe(false);
    });

    it("is false once the signed exp has passed", async () => {
      await verifySessionFeatures(["navigator"], PAST_EXP_SECONDS);
      mockGetSettings.mockReturnValue(tokenBackedSettings());

      expect(hasVerifiedFeature("navigator")).toBe(false);
    });

    it("is false once a different license key is stored", async () => {
      await verifySessionFeatures(["navigator"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "another-key" }));

      expect(hasVerifiedFeature("navigator")).toBe(false);
    });
  });

  describe("isEntitlementVerificationPending()", () => {
    it("is true while the stored token has not been verified this session for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      mockGetSettings.mockReturnValue(tokenBackedSettings());

      expect(isEntitlementVerificationPending()).toBe(true);
    });

    it("is false once the stored token is verified, and when no token is stored", async () => {
      await verifySessionFeatures(["navigator"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings());
      expect(isEntitlementVerificationPending()).toBe(false);

      mockGetSettings.mockReturnValue(tokenBackedSettings({ entitlementToken: "" }));
      expect(isEntitlementVerificationPending()).toBe(false);
    });
  });

  describe("isEntitlementExpired()", () => {
    it("is true only for a stored expiry that has passed", () => {
      expect(isEntitlementExpired(buildSettings({ entitlementExpiresAt: Date.now() - 1 }))).toBe(
        true
      );
      expect(
        isEntitlementExpired(buildSettings({ entitlementExpiresAt: Date.now() + 60_000 }))
      ).toBe(false);
      expect(isEntitlementExpired(buildSettings({ entitlementExpiresAt: 0 }))).toBe(false);
    });
  });

  describe("ensureEntitlement()", () => {
    beforeEach(() => mockValidateLicenseKey.mockResolvedValue({ isValid: undefined }));

    it("resolves true for a granted feature without waiting for the license check it reports with the feature as trigger for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      mockValidateLicenseKey.mockReturnValue(new Promise(() => {}));
      const app = {} as never;

      await expect(ensureEntitlement(app, "navigator", () => true)).resolves.toBe(true);
      expect(mockValidateLicenseKey).toHaveBeenCalledWith(app, { trigger: "navigator" });
    });

    it("waits for the license check and re-reads the grant when the feature was not granted for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      let granted = false;
      mockValidateLicenseKey.mockImplementation(async () => {
        granted = true;
        return { isValid: true };
      });

      await expect(ensureEntitlement(undefined, "multi_agent", () => granted)).resolves.toBe(true);
    });

    it("resolves false when the check leaves the feature ungranted", async () => {
      await expect(ensureEntitlement(undefined, "multi_agent", () => false)).resolves.toBe(false);
      expect(mockValidateLicenseKey).toHaveBeenCalledTimes(1);
    });

    it("resolves without throwing when the license check cannot reach the server, keeping a granted feature for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      mockValidateLicenseKey.mockRejectedValue(new Error("offline"));

      await expect(ensureEntitlement(undefined, "navigator", () => true)).resolves.toBe(true);
      await expect(ensureEntitlement(undefined, "navigator", () => false)).resolves.toBe(false);
    });
  });

  describe("subscribeToEntitlementChange()", () => {
    it("notifies when a token is verified and when settings change, until unsubscribed, for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      const listener = jest.fn();
      const unsubscribe = subscribeToEntitlementChange(listener);

      await verifySessionFeatures(["navigator"]);
      expect(listener).toHaveBeenCalledTimes(1);
      emitSettings(tokenBackedSettings({ plusLicenseKey: "another-key" }));
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      await verifySessionFeatures(["navigator"]);
      emitSettings(tokenBackedSettings());
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe("markPaidPendingEntitlement()", () => {
    it("keeps paid access while clearing the entitlement and withholding strict features", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, isPaidUser: true, isPlusUser: true })
      );
      expect(hasVerifiedFeature("multi_agent")).toBe(true);
      expect(isSelfHostModeValid()).toBe(true);

      markPaidPendingEntitlement();

      const pendingState = {
        isPaidUser: true,
        isPlusUser: false,
        entitlementToken: "",
        entitlementExpiresAt: 0,
      };
      expect(mockSetSettings).toHaveBeenCalledWith(pendingState);
      mockGetSettings.mockReturnValue(buildSettings({ enableSelfHostMode: true, ...pendingState }));
      expect(hasVerifiedFeature("multi_agent")).toBe(false);
      expect(isSelfHostModeValid()).toBe(false);
    });
  });

  describe("removeLicense()", () => {
    it("clears the stored key, its entitlement and any account mark in one settings write", () => {
      mockGetSettings.mockReturnValue(tokenBackedSettings({ isPaidUser: true, isPlusUser: true }));

      removeLicense();

      expect(mockSetSettings).toHaveBeenCalledTimes(1);
      expect(mockSetSettings).toHaveBeenCalledWith({
        plusLicenseKey: "",
        accountLicenseKeyHash: "",
        isPaidUser: false,
        isPlusUser: false,
        entitlementToken: "",
        entitlementExpiresAt: 0,
      });
    });
  });

  describe("isAccountLicense()", () => {
    it("is true for the exact key the account applied", () => {
      expect(
        isAccountLicense({
          plusLicenseKey: "account-key",
          accountLicenseKeyHash: sha256("account-key"),
        })
      ).toBe(true);
    });

    it("is false for a key the user put in place of the account's, so it is never removed with the plan — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      expect(
        isAccountLicense({
          plusLicenseKey: "pasted-key",
          accountLicenseKeyHash: sha256("account-key"),
        })
      ).toBe(false);
    });

    it("is false with no key stored, and for settings from versions without the account mark", () => {
      expect(isAccountLicense({ plusLicenseKey: "", accountLicenseKeyHash: sha256("") })).toBe(
        false
      );
      expect(isAccountLicense({ plusLicenseKey: "account-key" })).toBe(false);
    });
  });

  describe("applyAccountLicense()", () => {
    it("saves the account mark before the key, so a restart between the two writes never leaves the account's key looking pasted — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      applyAccountLicense("account-key");

      expect(mockSetSettings.mock.calls).toEqual([
        [{ accountLicenseKeyHash: sha256("account-key") }],
        [{ plusLicenseKey: "account-key" }],
      ]);
    });
  });

  describe("turnOffPaid()", () => {
    it("removes a license the account applied together with its entitlement — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({
          plusLicenseKey: "account-key",
          accountLicenseKeyHash: sha256("account-key"),
          isPaidUser: true,
        })
      );

      turnOffPaid();

      expect(mockSetSettings).toHaveBeenCalledWith(
        expect.objectContaining({ plusLicenseKey: "", isPaidUser: false, entitlementToken: "" })
      );
    });

    it("clears only the entitlement of a pasted key, leaving the key to fix or replace", () => {
      mockGetSettings.mockReturnValue(tokenBackedSettings({ isPaidUser: true }));

      turnOffPaid();

      expect(mockSetSettings).toHaveBeenCalledWith({
        isPaidUser: false,
        isPlusUser: false,
        entitlementToken: "",
        entitlementExpiresAt: 0,
      });
    });
  });

  describe("applyEntitlement()", () => {
    beforeEach(() => {
      mockGetSettings.mockReturnValue(
        buildSettings({ userId: "user-123", plusLicenseKey: STORED_LICENSE_KEY })
      );
    });

    it("grants Plus and self-host for a Supporter token carrying both features", async () => {
      mockVerifyEntitlement.mockResolvedValue({
        user_id: "user-123",
        plan: "supporter",
        tier: "plus",
        features: ["multi_agent", "self_host"],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      });

      expect(await applyEntitlement("token")).toBe(true);
      expect(mockSetSettings).toHaveBeenCalledWith({
        entitlementToken: "token",
        entitlementExpiresAt: FUTURE_EXP_SECONDS * 1000,
        isPaidUser: true,
        isPlusUser: true,
      });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));
      expect(isSelfHostModeValid()).toBe(true);
    });

    it("applies a Lite token as paid but neither Plus nor self-host", async () => {
      mockVerifyEntitlement.mockResolvedValue({
        user_id: "user-123",
        plan: "lite",
        tier: "lite",
        features: [],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      });

      expect(await applyEntitlement("token")).toBe(true);
      expect(mockSetSettings).toHaveBeenCalledWith({
        entitlementToken: "token",
        entitlementExpiresAt: FUTURE_EXP_SECONDS * 1000,
        isPaidUser: true,
        isPlusUser: false,
      });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));
      expect(isSelfHostModeValid()).toBe(false);
    });

    it("grants Plus without self-host for a Plus token", async () => {
      mockVerifyEntitlement.mockResolvedValue({
        user_id: "user-123",
        plan: "plus",
        tier: "plus",
        features: ["multi_agent"],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      });

      expect(await applyEntitlement("token")).toBe(true);
      expect(mockSetSettings).toHaveBeenCalledWith({
        entitlementToken: "token",
        entitlementExpiresAt: FUTURE_EXP_SECONDS * 1000,
        isPaidUser: true,
        isPlusUser: true,
      });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));
      expect(isSelfHostModeValid()).toBe(false);
    });

    it("does not tag the proof with a key swapped in while verification was in flight (https://github.com/Brevilabs/obsidian-copilot-private/issues/307)", async () => {
      mockVerifyEntitlement.mockImplementation(async () => {
        mockGetSettings.mockReturnValue(
          buildSettings({ userId: "user-123", plusLicenseKey: "a-different-key" })
        );
        return {
          user_id: "user-123",
          plan: "believer",
          tier: "plus",
          features: ["multi_agent", "self_host"],
          iat: 0,
          exp: FUTURE_EXP_SECONDS,
        };
      });

      expect(await applyEntitlement("token")).toBe(true);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ plusLicenseKey: "a-different-key", enableSelfHostMode: true })
      );
      expect(isSelfHostModeValid()).toBe(false);
      expect(hasVerifiedFeature("multi_agent")).toBe(false);
    });

    it("never shows listeners a renewed token as still awaiting verification, which open agent chats took for a connector change for https://github.com/Brevilabs/obsidian-copilot-private/issues/903", async () => {
      await verifySessionFeatures(["connectors"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings());
      mockSetSettings.mockImplementationOnce((partial) =>
        emitSettings({ ...mockGetSettings(), ...partial })
      );
      const pendingSeen: boolean[] = [];
      subscribeToEntitlementChange(() => pendingSeen.push(isEntitlementVerificationPending()));
      mockVerifyEntitlement.mockResolvedValue({
        user_id: "user-123",
        plan: "believer",
        tier: "plus",
        features: ["connectors"],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      });

      expect(await applyEntitlement("renewed-token")).toBe(true);

      expect(pendingSeen.length).toBeGreaterThan(0);
      expect(pendingSeen).not.toContain(true);
      expect(hasVerifiedFeature("connectors")).toBe(true);
    });

    it("does NOT change settings when the token cannot be verified", async () => {
      mockVerifyEntitlement.mockResolvedValue(null);

      expect(await applyEntitlement("bad")).toBe(false);
      expect(mockSetSettings).not.toHaveBeenCalled();
    });
  });

  describe("verifyCachedEntitlement()", () => {
    it("re-grants the cached token's features offline with no network call", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));

      expect(isSelfHostModeValid()).toBe(true);
      expect(hasVerifiedFeature("multi_agent")).toBe(true);
    });

    it("does not clobber a fresher token applied while its verification was in flight", async () => {
      const believerClaims = {
        user_id: "user-123",
        plan: "believer",
        tier: "plus",
        features: ["multi_agent", "self_host"],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      };
      mockGetSettings.mockReturnValue(
        buildSettings({
          userId: "user-123",
          entitlementToken: "old-token",
          plusLicenseKey: STORED_LICENSE_KEY,
        })
      );
      mockVerifyEntitlement.mockImplementation(async (token: string) => {
        if (token === "old-token") {
          await applyEntitlement("new-token");
          mockGetSettings.mockReturnValue(
            tokenBackedSettings({ entitlementToken: "new-token", enableSelfHostMode: true })
          );
        }
        return believerClaims;
      });

      await verifyCachedEntitlement();

      expect(isSelfHostModeValid()).toBe(true);
      expect(hasVerifiedFeature("multi_agent")).toBe(true);
    });

    it("closes every gate when the same cached token stops verifying", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);

      mockVerifyEntitlement.mockResolvedValue(null);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, isPlusUser: true })
      );
      await verifyCachedEntitlement();

      expect(isSelfHostModeValid()).toBe(false);
      expect(hasVerifiedFeature("multi_agent")).toBe(false);
    });
  });

  describe("checkIsPaidUser()", () => {
    it("returns false without reaching the server when no license key is set", async () => {
      mockGetSettings.mockReturnValue(buildSettings({ plusLicenseKey: "" }));

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
      expect(mockValidateLicenseKey).not.toHaveBeenCalled();
    });

    it("returns the server's verdict when it answers", async () => {
      mockGetSettings.mockReturnValue(buildSettings({ plusLicenseKey: "key", isPaidUser: true }));
      mockValidateLicenseKey.mockResolvedValue({ isValid: false });

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
      expect(mockValidateLicenseKey).toHaveBeenCalledWith(undefined, { trigger: "manual" });
    });

    it("keeps an unexpired entitlement working when the license server is unreachable", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));
      mockValidateLicenseKey.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(true);
      expect(mockValidateLicenseKey).toHaveBeenCalled();
    });

    it("keeps an unexpired entitlement working when the server answers without a verdict", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));
      mockValidateLicenseKey.mockResolvedValue({ isValid: undefined });

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(true);
    });

    it("stops a turn whose entitlement expired while renewal was failing", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"], PAST_EXP_SECONDS);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));
      mockValidateLicenseKey.mockResolvedValue({ isValid: undefined });

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
    });

    it("refuses the offline fallback to an unexpired free-tier token", async () => {
      await verifySessionClaims({ plan: "none", tier: "free" });
      mockGetSettings.mockReturnValue(tokenBackedSettings());
      mockValidateLicenseKey.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
    });

    it("refuses the previous key's entitlement to a newly entered key the server cannot rule on (https://github.com/Brevilabs/obsidian-copilot-private/issues/307)", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "a-different-key" }));
      mockValidateLicenseKey.mockResolvedValue({ isValid: undefined });

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
    });

    it("does not grant offline access on persisted flags alone (edited data.json)", async () => {
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ plusLicenseKey: "key", isPaidUser: true })
      );
      mockValidateLicenseKey.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
    });

    it("leaves the retained paid state untouched when validation is unreachable after reset (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", async () => {
      mockGetSettings.mockReturnValue(
        buildSettings({
          plusLicenseKey: "key",
          isPaidUser: true,
          isPlusUser: false,
          entitlementToken: "",
          entitlementExpiresAt: FUTURE_EXP_SECONDS * 1000,
        })
      );
      mockValidateLicenseKey.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
      expect(mockValidateLicenseKey).toHaveBeenCalled();
      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });
  });

  describe("useLicenseState()", () => {
    it("names the plan the session-verified entitlement carries", async () => {
      await verifySessionClaims({ plan: "believer", tier: "plus" });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "active", plan: "believer" });
    });

    it("returns the same object across renders while the plan is unchanged", async () => {
      await verifySessionClaims({ plan: "believer", tier: "plus" });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));

      const { result, rerender } = renderHook(() => useLicenseState());
      const first = result.current;
      rerender();

      expect(result.current).toBe(first);
    });

    it("reports inactive for a lapsed key the server downgraded to the free tier", async () => {
      await verifySessionClaims({ plan: "plus", tier: "free" });
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ plusLicenseKey: "key", isPaidUser: false })
      );

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "inactive" });
    });

    it("reports inactive once the signed expiry has passed", async () => {
      await verifySessionClaims({ plan: "plus", tier: "plus", exp: PAST_EXP_SECONDS });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "inactive" });
    });

    it("reports inactive once the retained post-reset expiry has passed (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      mockGetSettings.mockReturnValue(
        buildSettings({
          plusLicenseKey: "key",
          isPaidUser: true,
          isPlusUser: false,
          entitlementToken: "",
          entitlementExpiresAt: PAST_EXP_SECONDS * 1000,
        })
      );

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "inactive" });
    });

    it("reports inactive for a stored key the server rejected outright", async () => {
      mockGetSettings.mockReturnValue(
        buildSettings({ userId: "user-123", plusLicenseKey: "key", isPaidUser: false })
      );

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "inactive" });
    });

    it("keeps a paid key active when the server confirmed it without signing a token", () => {
      mockGetSettings.mockReturnValue(
        buildSettings({ userId: "user-123", plusLicenseKey: "key", isPaidUser: true })
      );

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "active" });
    });

    it("stops naming the previous key's plan once a different key is stored (https://github.com/Brevilabs/obsidian-copilot-private/issues/307)", async () => {
      await verifySessionClaims({ plan: "believer", tier: "plus" });
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ plusLicenseKey: "a-different-key", isPaidUser: false })
      );

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "inactive" });
    });

    it("shows nothing when no license key is stored", () => {
      mockGetSettings.mockReturnValue(buildSettings({ userId: "user-123", isPaidUser: false }));

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "none" });
    });
  });

  describe("useIsSelfHostEligible()", () => {
    it("reports eligible without touching the preference when the token grants self-host", async () => {
      mockVerifyEntitlement.mockResolvedValue({
        user_id: "user-123",
        plan: "believer",
        tier: "plus",
        features: ["multi_agent", "self_host"],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));

      const { result } = renderHook(() => useIsSelfHostEligible());

      await waitFor(() => expect(result.current).toBe(true));
      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it("clears the preference when a verified token's plan does not grant self-host", async () => {
      mockVerifyEntitlement.mockResolvedValue({
        user_id: "user-123",
        plan: "plus",
        tier: "plus",
        features: ["multi_agent"],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));

      const { result } = renderHook(() => useIsSelfHostEligible());

      await waitFor(() => expect(result.current).toBe(false));
      expect(mockUpdateSetting).toHaveBeenCalledWith("enableSelfHostMode", false);
    });

    it("keeps the preference when the token cannot be verified", async () => {
      mockVerifyEntitlement.mockResolvedValue(null);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));

      const { result } = renderHook(() => useIsSelfHostEligible());

      await waitFor(() => expect(result.current).toBe(false));
      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });
  });
});
