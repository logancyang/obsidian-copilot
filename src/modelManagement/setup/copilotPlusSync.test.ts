import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { RegisterPlusProviderInput } from "@/modelManagement/setup/CopilotPlusSetupApi";
import {
  COPILOT_PLUS_DEFAULT_ENABLED_MODELS,
  COPILOT_PLUS_MODELS,
  plusSyncNeeded,
  syncCopilotPlusProvider,
} from "@/modelManagement/setup/copilotPlusSync";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makeApi() {
  const registerPlusProvider = jest.fn(async (_input: RegisterPlusProviderInput) => ({
    providerId: "plus-1",
    configuredModelIds: [] as string[],
  }));
  const unregisterPlusProvider = jest.fn(async () => {});
  const api = {
    setup: { copilotPlus: { registerPlusProvider, unregisterPlusProvider } },
  } as unknown as ModelManagementApi;
  return { api, registerPlusProvider, unregisterPlusProvider };
}

describe("copilotPlusSync", () => {
  it("defines the curated lineup and default-enabled models", () => {
    expect(COPILOT_PLUS_MODELS.map((model) => model.id)).toEqual([
      "copilot-plus-flash",
      "kimi-k2.6",
      "glm-5.2",
      "kimi-k2.7-code",
      "deepseek-v4-pro",
      "deepseek-v4-flash-0731",
      "mimo-v2.5",
      "minimax-m2.7",
    ]);
    expect(COPILOT_PLUS_DEFAULT_ENABLED_MODELS).toEqual([
      "copilot-plus-flash",
      "deepseek-v4-pro",
      "glm-5.2",
    ]);
  });

  describe("plusSyncNeeded()", () => {
    const signedIn = { isPaidUser: true, plusLicenseKey: "lic-1" };

    it("stays false when a signed-in user's Reset Settings preserves the paid state (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // The reset write changes almost every field, but preserves both values
      // this predicate reads — so the destructive unregister cascade (provider
      // row, configured models, backend refs, provider keychain entry) must
      // not fire.
      expect(plusSyncNeeded(signedIn, { ...signedIn })).toBe(false);
    });

    it("fires on a genuine sign-out or sign-in (isPaidUser flip)", () => {
      expect(plusSyncNeeded(signedIn, { isPaidUser: false, plusLicenseKey: "lic-1" })).toBe(true);
      expect(plusSyncNeeded({ isPaidUser: false, plusLicenseKey: "" }, signedIn)).toBe(true);
    });

    it("fires on a key rotation while signed in, but not while signed out", () => {
      expect(plusSyncNeeded(signedIn, { isPaidUser: true, plusLicenseKey: "lic-2" })).toBe(true);
      expect(
        plusSyncNeeded(
          { isPaidUser: false, plusLicenseKey: "lic-1" },
          { isPaidUser: false, plusLicenseKey: "lic-2" }
        )
      ).toBe(false);
    });
  });

  describe("syncCopilotPlusProvider()", () => {
    it("registers with the Keychain-hydrated token when signed in", async () => {
      const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

      await syncCopilotPlusProvider(api, true, "hydrated-token");

      expect(unregisterPlusProvider).not.toHaveBeenCalled();
      expect(registerPlusProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "hydrated-token",
          models: COPILOT_PLUS_MODELS,
          autoEnrollModelIds: COPILOT_PLUS_DEFAULT_ENABLED_MODELS,
        })
      );
    });

    it("marks reasoning support for the models that expose an effort picker", () => {
      const reasoningById = Object.fromEntries(
        COPILOT_PLUS_MODELS.map((model) => [model.id, model.reasoning === true])
      );
      expect(reasoningById).toEqual({
        "copilot-plus-flash": true,
        "kimi-k2.6": false,
        "glm-5.2": true,
        "kimi-k2.7-code": true,
        "deepseek-v4-pro": true,
        "deepseek-v4-flash-0731": true,
        "mimo-v2.5": true,
        "minimax-m2.7": true,
      });
    });

    it.each([
      { isPaidUser: false, licenseKey: "hydrated-token" },
      { isPaidUser: true, licenseKey: "" },
    ])(
      "unregisters when paid state or credential is missing",
      async ({ isPaidUser, licenseKey }) => {
        const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

        await syncCopilotPlusProvider(api, isPaidUser, licenseKey);

        expect(registerPlusProvider).not.toHaveBeenCalled();
        expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
      }
    );

    it("contains background reconciliation failures", async () => {
      const { api, registerPlusProvider } = makeApi();
      registerPlusProvider.mockRejectedValueOnce(new Error("boom"));

      await expect(syncCopilotPlusProvider(api, true, "hydrated-token")).resolves.toBeUndefined();
    });
  });
});
