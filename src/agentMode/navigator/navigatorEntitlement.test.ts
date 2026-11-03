import {
  ensureNavigatorEntitlement,
  isNavigatorEnabled,
  useIsNavigatorEnabled,
} from "@/agentMode/navigator/navigatorEntitlement";
import {
  applyLicenseWithNavigator,
  setNavigatorAccess,
  verifyStoredToken,
} from "@/agentMode/ui/testing/navigatorAccess";
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

describe("navigatorEntitlement", () => {
  beforeEach(() => {
    mockValidateLicenseKey.mockReset().mockResolvedValue({ isValid: undefined });
  });

  describe("isNavigatorEnabled()", () => {
    it.each([
      { who: "a Supporter whose token carries navigator", access: "supporter", expected: true },
      { who: "a Plus user without navigator", access: "plus-without-navigator", expected: false },
      { who: "a free user", access: "free", expected: false },
    ] as const)("is $expected for $who", async ({ access, expected }) => {
      await setNavigatorAccess(access);

      expect(isNavigatorEnabled()).toBe(expected);
    });

    it("is unknown (undefined) while the stored token is still being verified at startup for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("unverified");

      expect(isNavigatorEnabled()).toBeUndefined();
    });
  });

  describe("useIsNavigatorEnabled()", () => {
    it("unlocks when the stored token finishes verifying, without a settings change or restart (https://github.com/Brevilabs/obsidian-copilot-private/issues/626)", async () => {
      await setNavigatorAccess("unverified");
      const { result } = renderHook(() => useIsNavigatorEnabled());
      expect(result.current).toBeUndefined();

      await act(() => verifyStoredToken(true));

      expect(result.current).toBe(true);
    });
  });

  describe("ensureNavigatorEntitlement()", () => {
    it("allows a Supporter without waiting for the license check it reports with the navigator trigger for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      await setNavigatorAccess("supporter");
      mockValidateLicenseKey.mockReturnValue(new Promise(() => {}));
      const app = {} as never;

      await expect(ensureNavigatorEntitlement(app)).resolves.toBe(true);
      expect(mockValidateLicenseKey).toHaveBeenCalledWith(app, { trigger: "navigator" });
    });

    it("allows a stored token still being verified at startup for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("unverified");

      await expect(ensureNavigatorEntitlement()).resolves.toBe(true);
    });

    it("allows a token without navigator once the license check returns one that grants it for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      await setNavigatorAccess("plus-without-navigator");
      mockValidateLicenseKey.mockImplementation(async () => {
        await applyLicenseWithNavigator();
        return { isValid: true };
      });

      await expect(ensureNavigatorEntitlement()).resolves.toBe(true);
    });

    it("blocks a token without navigator when the license check returns no grant", async () => {
      await setNavigatorAccess("plus-without-navigator");

      await expect(ensureNavigatorEntitlement()).resolves.toBe(false);
      expect(mockValidateLicenseKey).toHaveBeenCalledTimes(1);
    });
  });
});
