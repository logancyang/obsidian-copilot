import {
  ensureMultiAgentEntitlement,
  isMultiAgentEnabled,
  showMultiAgentUpgradePrompt,
  useCanUseMultiAgent,
} from "@/agentMode/session/fanout/multiAgentEntitlement";
import { verifyEntitlement } from "@/entitlement";
import { navigateToPlusPage, verifyCachedEntitlement } from "@/plusUtils";
import { setSettings } from "@/settings/model";
import { renderHook } from "@testing-library/react";
import { Notice } from "obsidian";

jest.mock("@/entitlement");
jest.mock("@/plusUtils", () => ({
  ...jest.requireActual("@/plusUtils"),
  navigateToPlusPage: jest.fn(),
}));

const mockValidateLicenseKey = jest.fn<Promise<unknown>, [unknown, Record<string, unknown>]>();
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      validateLicenseKey: (app: unknown, context: Record<string, unknown>) =>
        mockValidateLicenseKey(app, context),
    }),
  },
}));

const FUTURE_EXP_SECONDS = 9_999_999_999;
const PAST_EXP_SECONDS = 1_000_000_000;

function setLegacyPlus(isPlusUser: boolean): void {
  setSettings({ entitlementToken: "", entitlementExpiresAt: 0, isPlusUser });
}

async function verifyTokenWith(features: string[], expSeconds = FUTURE_EXP_SECONDS): Promise<void> {
  jest.mocked(verifyEntitlement).mockResolvedValue({
    user_id: "user-1",
    plan: "supporter",
    tier: "plus",
    features: features as never,
    iat: 0,
    exp: expSeconds,
  });
  setSettings({
    entitlementToken: "stored-token",
    entitlementExpiresAt: expSeconds * 1000,
    isPlusUser: features.includes("multi_agent"),
  });
  await verifyCachedEntitlement();
}

describe("multiAgentEntitlement", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockValidateLicenseKey.mockReset().mockResolvedValue({ isValid: undefined });
    setSettings({ userId: "user-1", plusLicenseKey: "license-key" });
    setLegacyPlus(false);
    await verifyCachedEntitlement();
  });

  describe("isMultiAgentEnabled()", () => {
    it("follows the stored Plus flag when no signed entitlement has been issued", () => {
      setLegacyPlus(true);
      expect(isMultiAgentEnabled()).toBe(true);

      setLegacyPlus(false);
      expect(isMultiAgentEnabled()).toBe(false);
    });

    it("is true for a token verified this session that carries multi_agent", async () => {
      await verifyTokenWith(["multi_agent"]);

      expect(isMultiAgentEnabled()).toBe(true);
    });

    it("is false for a token without multi_agent, even with the stored Plus flag set", async () => {
      await verifyTokenWith(["navigator"]);
      setSettings({ isPlusUser: true });

      expect(isMultiAgentEnabled()).toBe(false);
    });

    it("is false once the signed exp has passed", async () => {
      await verifyTokenWith(["multi_agent"], PAST_EXP_SECONDS);

      expect(isMultiAgentEnabled()).toBe(false);
    });
  });

  describe("useCanUseMultiAgent()", () => {
    it("is true for a Plus user whose entitlement has not expired", async () => {
      await verifyTokenWith(["multi_agent"]);

      expect(renderHook(() => useCanUseMultiAgent()).result.current).toBe(true);
    });

    it("is false once the stored entitlement expiry has passed", () => {
      setSettings({ isPlusUser: true, entitlementExpiresAt: Date.now() - 1 });

      expect(renderHook(() => useCanUseMultiAgent()).result.current).toBe(false);
    });

    it("is false for a user without Plus", () => {
      expect(renderHook(() => useCanUseMultiAgent()).result.current).toBe(false);
    });
  });

  describe("ensureMultiAgentEntitlement()", () => {
    it("allows a Plus user without waiting for the license check it reports with the multi_agent trigger for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      setLegacyPlus(true);
      mockValidateLicenseKey.mockReturnValue(new Promise(() => {}));
      const app = {} as never;

      await expect(ensureMultiAgentEntitlement(app)).resolves.toBe(true);
      expect(mockValidateLicenseKey).toHaveBeenCalledWith(app, { trigger: "multi_agent" });
    });

    it("allows a non-Plus cache once the license check confirms Plus", async () => {
      mockValidateLicenseKey.mockImplementation(async () => {
        setLegacyPlus(true);
        return { isValid: true };
      });

      await expect(ensureMultiAgentEntitlement()).resolves.toBe(true);
    });

    it("blocks a user the license check leaves without Plus", async () => {
      mockValidateLicenseKey.mockResolvedValue({ isValid: true });

      await expect(ensureMultiAgentEntitlement()).resolves.toBe(false);
      expect(mockValidateLicenseKey).toHaveBeenCalledTimes(1);
    });
  });

  describe("showMultiAgentUpgradePrompt()", () => {
    it("explains multi-agent answers are a Plus feature and opens the pricing page", () => {
      showMultiAgentUpgradePrompt();

      expect(jest.mocked(Notice).mock.calls[0][0]).toContain("Copilot Plus feature");
      expect(navigateToPlusPage).toHaveBeenCalledWith("multi_agent");
    });
  });
});
