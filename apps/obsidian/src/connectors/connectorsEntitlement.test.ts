import {
  ensureConnectorsEntitlement,
  isConnectorsEnabled,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import { verifyEntitlement, type EntitlementFeature } from "@/entitlement";
import { verifyCachedEntitlement } from "@/plusUtils";
import { setSettings } from "@/settings/model";
import { act, renderHook } from "@testing-library/react";

jest.mock("@/entitlement");

const mockValidateLicenseKey = jest.fn<Promise<unknown>, [unknown, Record<string, unknown>]>();
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      validateLicenseKey: (app: unknown, context: Record<string, unknown>) =>
        mockValidateLicenseKey(app, context),
    }),
  },
}));

function mockSignedClaims(features: EntitlementFeature[]): void {
  jest.mocked(verifyEntitlement).mockResolvedValue({
    user_id: "user-1",
    plan: "supporter",
    tier: "plus",
    features,
    iat: 0,
    exp: 9_999_999_999,
  });
}

async function storeToken(features: EntitlementFeature[] | null, verify = true): Promise<void> {
  setSettings({ userId: "user-1", plusLicenseKey: "license-key", entitlementToken: "" });
  await verifyCachedEntitlement();
  if (!features) return;
  mockSignedClaims(features);
  setSettings({ entitlementToken: "stored-entitlement-token" });
  if (verify) await verifyCachedEntitlement();
}

describe("connectorsEntitlement", () => {
  beforeEach(() => {
    mockValidateLicenseKey.mockReset().mockResolvedValue({ isValid: undefined });
  });

  describe("isConnectorsEnabled()", () => {
    it.each([
      {
        who: "a Supporter whose token carries connectors",
        features: ["connectors"],
        expected: true,
      },
      { who: "a Plus user without connectors", features: ["multi_agent"], expected: false },
      { who: "a free user", features: null, expected: false },
    ] as const)("is $expected for $who", async ({ features, expected }) => {
      await storeToken(features ? [...features] : null);

      expect(isConnectorsEnabled()).toBe(expected);
    });

    it("is unknown (undefined) while the stored token is still being verified at startup", async () => {
      await storeToken(["connectors"], false);

      expect(isConnectorsEnabled()).toBeUndefined();
    });
  });

  describe("useIsConnectorsEnabled()", () => {
    it("unlocks when the stored token finishes verifying", async () => {
      await storeToken(["connectors"], false);
      const { result } = renderHook(() => useIsConnectorsEnabled());
      expect(result.current).toBeUndefined();

      await act(() => verifyCachedEntitlement());

      expect(result.current).toBe(true);
    });
  });

  describe("ensureConnectorsEntitlement()", () => {
    it("allows a Supporter and reports the license check with the connectors trigger", async () => {
      await storeToken(["connectors"]);
      const app = {} as never;

      await expect(ensureConnectorsEntitlement(app)).resolves.toBe(true);
      expect(mockValidateLicenseKey).toHaveBeenCalledWith(app, { trigger: "connectors" });
    });

    it("blocks a token without connectors when the license check returns no grant", async () => {
      await storeToken(["multi_agent"]);

      await expect(ensureConnectorsEntitlement()).resolves.toBe(false);
    });
  });
});
