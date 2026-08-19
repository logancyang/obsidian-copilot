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

/** Publish a settings change the way the provider sync's write does. */
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
  applyEntitlement,
  applyLicenseSettings,
  isUsingLicensedModels,
  canUseMultiAgent,
  checkIsPaidUser,
  isPlusEnabled,
  isSelfHostModeValid,
  markPaidPendingEntitlement,
  turnOffPaid,
  useIsSelfHostEligible,
  useLicenseState,
  verifyCachedEntitlement,
} from "@/plusUtils";
import { renderHook, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";

const FUTURE_EXP_SECONDS = 9_999_999_999;
const PAST_EXP_SECONDS = 1_000_000_000;

function buildSettings(overrides: Partial<CopilotSettings>): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/**
 * Drive the module's in-memory verified-feature set the way the real startup
 * path does: re-verify a persisted token whose claims grant `features`.
 */
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
  mockGetSettings.mockReturnValue(buildSettings({ userId: "user-123", entitlementToken: "token" }));
  await verifyCachedEntitlement();
}

/**
 * Settings of a user holding an unexpired, token-derived entitlement. `token`
 * matches what {@link verifySessionFeatures} verified, so the in-memory proof
 * belongs to the token settings currently hold.
 */
function tokenBackedSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return buildSettings({
    userId: "user-123",
    entitlementToken: "token",
    entitlementExpiresAt: Date.now() + 60_000,
    ...overrides,
  });
}

/**
 * Drive the module's verified proof from a token whose claims are given, the
 * way the real startup path does.
 */
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
  mockGetSettings.mockReturnValue(buildSettings({ userId: "user-123", entitlementToken: "token" }));
  await verifyCachedEntitlement();
}

describe("plusUtils", () => {
  // Every gate reads the in-memory proof, so reset it to the fail-closed state.
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

  describe("applyLicenseSettings()", () => {
    const FLASH_CONFIGURED_ID = "cm-flash";

    /** Settings in the state the provider sync leaves behind: Plus provider registered, flash configured. */
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
      // Mid-flight: the click landed before enrollment, so nothing is written yet.
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
      // The case the expiry warning exists for: chat is on the user's own model,
      // so only the agent's sessions are about to break. The Copilot provider is
      // already unregistered here, as expiry leaves it.
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
      // Persisted flags and a future expiry can be forged; the ES256 signature
      // cannot, and nothing re-proved it this process.
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, isPlusUser: true })
      );

      expect(isSelfHostModeValid()).toBe(false);
    });

    // Expiry comes from the signed claims, never from the persisted setting:
    // data.json is editable and the ES256 signature is not. Both directions are
    // asserted so the setting is proven inert rather than merely unused.
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
      // These paths also zero `entitlementExpiresAt`, so the expiry check alone
      // would not close the gate — the proof lapses because it is tagged with a
      // token settings no longer hold.
      mockGetSettings.mockReturnValue(
        buildSettings({ enableSelfHostMode: true, entitlementToken: "", entitlementExpiresAt: 0 })
      );

      expect(isSelfHostModeValid()).toBe(false);
    });
  });

  describe("markPaidPendingEntitlement()", () => {
    it("keeps paid access while clearing the entitlement and withholding strict features", async () => {
      await verifySessionFeatures(["multi_agent", "self_host"]);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, isPaidUser: true, isPlusUser: true })
      );
      expect(isPlusEnabled()).toBe(true);
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
      expect(isPlusEnabled()).toBe(false);
      expect(isSelfHostModeValid()).toBe(false);
    });
  });

  describe("canUseMultiAgent()", () => {
    it("returns false for a free user", () => {
      mockGetSettings.mockReturnValue(buildSettings({ isPlusUser: false }));
      expect(canUseMultiAgent()).toBe(false);
    });

    it("returns false for a Lite user (paid but below Plus)", () => {
      mockGetSettings.mockReturnValue(buildSettings({ isPaidUser: true, isPlusUser: false }));
      expect(canUseMultiAgent()).toBe(false);
    });

    it("returns false once the signed exp has passed (offline lock)", async () => {
      await verifySessionFeatures(["multi_agent"], PAST_EXP_SECONDS);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ isPlusUser: true }));
      expect(canUseMultiAgent()).toBe(false);
    });

    it("blocks token-derived Plus that was not verified this session (edited data.json)", () => {
      mockGetSettings.mockReturnValue(tokenBackedSettings({ isPlusUser: true }));
      expect(canUseMultiAgent()).toBe(false);
    });

    it("allows token-derived Plus once the signed token is verified this session", async () => {
      await verifySessionFeatures(["multi_agent"]);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ isPlusUser: true }));

      expect(canUseMultiAgent()).toBe(true);
    });

    it("is not granted by self-host mode alone", async () => {
      // Self-host plans reach Plus through their own token's multi_agent
      // feature, so the toggle must not act as a bypass.
      await verifySessionFeatures(["self_host"]);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, isPlusUser: false })
      );

      expect(canUseMultiAgent()).toBe(false);
    });
  });

  describe("applyEntitlement()", () => {
    beforeEach(() => {
      mockGetSettings.mockReturnValue(buildSettings({ userId: "user-123" }));
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

      // Returns true (verified + applied); the tier shows in the flags, not the
      // return value.
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

    it("does NOT change settings when the token cannot be verified", async () => {
      // An unverifiable token (bad signature, expired, unknown kid, or empty key
      // set during rollout) is not an authoritative negative, so flags are left
      // untouched for the caller to decide the fallback. Only turnOffPaid clears.
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
      expect(canUseMultiAgent()).toBe(true);
    });

    it("does not clobber a fresher token applied while its verification was in flight", async () => {
      // main.ts runs this concurrently with the online /license check. The
      // startup re-check reads the OLD token, and /license installs a new one
      // before that verification resolves; the stale write must be dropped or
      // the proof ends up tagged with a token settings no longer hold.
      const believerClaims = {
        user_id: "user-123",
        plan: "believer",
        tier: "plus",
        features: ["multi_agent", "self_host"],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      };
      mockGetSettings.mockReturnValue(
        buildSettings({ userId: "user-123", entitlementToken: "old-token" })
      );
      mockVerifyEntitlement.mockImplementation(async (token: string) => {
        if (token === "old-token") {
          // The concurrent /license round-trip resolves first and installs a
          // fresher token, exactly as applyEntitlement would at startup.
          await applyEntitlement("new-token");
          mockGetSettings.mockReturnValue(
            tokenBackedSettings({ entitlementToken: "new-token", enableSelfHostMode: true })
          );
        }
        return believerClaims;
      });

      await verifyCachedEntitlement();

      // The fresher grant survives: a paying user is not locked out for the session.
      expect(isSelfHostModeValid()).toBe(true);
      expect(canUseMultiAgent()).toBe(true);
    });

    it("closes every gate when the same cached token stops verifying", async () => {
      // Kid rotation or tampering: settings still hold the token an earlier
      // check granted, so re-tagging it with no features is what revokes.
      await verifySessionFeatures(["multi_agent", "self_host"]);

      mockVerifyEntitlement.mockResolvedValue(null);
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ enableSelfHostMode: true, isPlusUser: true })
      );
      await verifyCachedEntitlement();

      expect(isSelfHostModeValid()).toBe(false);
      expect(canUseMultiAgent()).toBe(false);
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
      // requestUrl rejects offline, and every caller reads a rejection as "no
      // license" — which would deny the offline window the signed token exists
      // to provide. The call still runs, since it is what renews the token.
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
      // The persisted isPaidUser is still true here. Answering from it would let
      // the turn proceed with isSelfHostModeValid() already closed, rerouting a
      // self-host user's searches to the cloud on a failed renewal.
      await verifySessionFeatures(["multi_agent", "self_host"], PAST_EXP_SECONDS);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));
      mockValidateLicenseKey.mockResolvedValue({ isValid: undefined });

      expect(await checkIsPaidUser(undefined, { trigger: "manual" })).toBe(false);
    });

    it("refuses the offline fallback to an unexpired free-tier token", async () => {
      // The backend downgrades a lapsed paid key to the free policy instead of
      // refusing it a token, so an unexpired proof is not by itself paid access.
      mockVerifyEntitlement.mockResolvedValue({
        user_id: "user-123",
        plan: "none",
        tier: "free",
        features: [],
        iat: 0,
        exp: FUTURE_EXP_SECONDS,
      });
      mockGetSettings.mockReturnValue(
        buildSettings({ userId: "user-123", entitlementToken: "token" })
      );
      await verifyCachedEntitlement();
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));
      mockValidateLicenseKey.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

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
      // The post-reset shape: reset kept isPaidUser and the license key but
      // dropped the entitlement token. An unreachable server means "unknown",
      // not "unentitled" — writing the paid flag here would read as sign-out
      // to the settings subscriber (`plusSyncNeeded`) and tear down the
      // preserved Plus provider and its keychain entry.
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
      // The server keeps answering is_valid for a lapsed key but issues a
      // free-tier entitlement that still names the plan, so the tier — not the
      // plan name — is what says this user has nothing.
      await verifySessionClaims({ plan: "plus", tier: "free" });
      mockGetSettings.mockReturnValue(
        tokenBackedSettings({ plusLicenseKey: "key", isPaidUser: false })
      );

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "inactive" });
    });

    it("reports inactive once the signed expiry has passed", async () => {
      // Shares the gates' liveness bound, so a section left open across `exp`
      // stops naming a plan whose entitlement has already closed.
      await verifySessionClaims({ plan: "plus", tier: "plus", exp: PAST_EXP_SECONDS });
      mockGetSettings.mockReturnValue(tokenBackedSettings({ plusLicenseKey: "key" }));

      const { result } = renderHook(() => useLicenseState());

      expect(result.current).toEqual({ status: "inactive" });
    });

    it("reports inactive once the retained post-reset expiry has passed (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // The post-reset shape: reset kept isPaidUser and the original expiry
      // but dropped the token, so no signed claims exist. The retained expiry
      // is what keeps this display time-bounded — without it a reset user
      // offline would read Active forever.
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
      // turnOffPaid clears the token and the expiry, so nothing but the key and
      // the downgraded flag survive an invalid or revoked key.
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
      // Unverifiable is "unknown", not "not entitled": a kid that has not
      // shipped, unavailable WebCrypto, or an expiry crossed just before the
      // online refresh. Clearing here would burn a preference that the next
      // successful refresh cannot restore, silently leaving the user on cloud.
      mockVerifyEntitlement.mockResolvedValue(null);
      mockGetSettings.mockReturnValue(tokenBackedSettings({ enableSelfHostMode: true }));

      const { result } = renderHook(() => useIsSelfHostEligible());

      await waitFor(() => expect(result.current).toBe(false));
      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });
  });
});
