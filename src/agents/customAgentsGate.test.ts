import {
  getCustomAgentsGate,
  isLicenseLapsed,
  subscribeToCustomAgentsGate,
  useCustomAgentsGate,
} from "@/agents/customAgentsGate";
import { setCustomAgentsAccess, verifyStoredToken } from "@/agents/testing/customAgentsAccess";
import { act, renderHook } from "@testing-library/react";

jest.mock("@/entitlement");

const LAPSED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";

describe("customAgentsGate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getCustomAgentsGate()", () => {
    it("is full for a team license whose verified token carries custom_agents", async () => {
      await setCustomAgentsAccess("team");

      expect(getCustomAgentsGate()).toBe("full");
    });

    it.each([
      { who: "a Plus user without custom_agents", access: "plus-without-custom-agents" },
      { who: "a free user", access: "free" },
      { who: "a device with no license key", access: "keyless" },
    ] as const)("is locked for $who", async ({ access }) => {
      await setCustomAgentsAccess(access);

      expect(getCustomAgentsGate()).toBe("locked");
    });

    it("is pending while the stored token is still being verified at startup, so nothing flashes for https://github.com/Brevilabs/obsidian-copilot-private/issues/934", async () => {
      await setCustomAgentsAccess("unverified");

      expect(getCustomAgentsGate()).toBe("pending");
    });
  });

  describe("useCustomAgentsGate()", () => {
    it("turns from pending to full when the stored token finishes verifying, without a settings change or restart", async () => {
      await setCustomAgentsAccess("unverified");
      const { result } = renderHook(() => useCustomAgentsGate());
      expect(result.current).toBe("pending");

      await act(() => verifyStoredToken(true));

      expect(result.current).toBe("full");
    });

    it("turns from pending to locked when the verified token lacks custom_agents", async () => {
      await setCustomAgentsAccess("unverified");
      const { result } = renderHook(() => useCustomAgentsGate());

      await act(() => verifyStoredToken(false));

      expect(result.current).toBe("locked");
    });
  });

  describe("subscribeToCustomAgentsGate()", () => {
    it("notifies on license verification until unsubscribed", async () => {
      await setCustomAgentsAccess("unverified");
      const listener = jest.fn();
      const unsubscribe = subscribeToCustomAgentsGate(listener);

      await verifyStoredToken(false);
      expect(listener).toHaveBeenCalled();
      listener.mockClear();

      unsubscribe();
      await verifyStoredToken(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("isLicenseLapsed()", () => {
    it.each([
      {
        device: "a device whose Supporter plan lapsed and kept its license key",
        access: "free",
        gate: "locked",
        lapsed: true,
      },
      {
        device: "a device whose expired Supporter key now verifies as a free-tier token",
        access: "free-tier-token",
        gate: "locked",
        lapsed: true,
      },
      {
        device:
          "a device on an active paid plan without custom agents, as a Plus user whose vault syncs agents",
        access: "plus-without-custom-agents",
        gate: "locked",
        lapsed: false,
      },
      {
        device: "a device that never had a license, as when Sync brings another device's agents",
        access: "keyless",
        gate: "locked",
        lapsed: false,
      },
    ] as const)(
      `tells $device apart by the gate, the stored license key and whether a paid plan is active (${LAPSED_ISSUE})`,
      async ({ access, gate, lapsed }) => {
        await setCustomAgentsAccess(access);

        expect(getCustomAgentsGate()).toBe(gate);
        expect(isLicenseLapsed()).toBe(lapsed);
      }
    );
  });
});
