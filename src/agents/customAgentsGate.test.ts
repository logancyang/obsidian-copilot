import * as customAgentsGate from "@/agents/customAgentsGate";
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
  let launchedConstant: jest.ReplaceProperty<boolean>;

  beforeEach(() => {
    launchedConstant = jest.replaceProperty(customAgentsGate, "launched", false);
  });

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
    ] as const)("is hidden before launch for $who", async ({ access }) => {
      await setCustomAgentsAccess(access);

      expect(getCustomAgentsGate()).toBe("hidden");
    });

    it.each([
      { when: "before launch", launched: false },
      { when: "once launched", launched: true },
    ])(
      "is pending $when while the stored token is still being verified at startup, so nothing flashes for https://github.com/Brevilabs/obsidian-copilot-private/issues/934",
      async ({ launched }) => {
        launchedConstant.replaceValue(launched);
        await setCustomAgentsAccess("unverified");

        expect(getCustomAgentsGate()).toBe("pending");
      }
    );

    it("is locked without custom_agents once launched", async () => {
      launchedConstant.replaceValue(true);
      await setCustomAgentsAccess("plus-without-custom-agents");

      expect(getCustomAgentsGate()).toBe("locked");
    });

    it("stays full for a team license once launched", async () => {
      launchedConstant.replaceValue(true);
      await setCustomAgentsAccess("team");

      expect(getCustomAgentsGate()).toBe("full");
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

    it("turns from pending to hidden when the verified token lacks custom_agents", async () => {
      await setCustomAgentsAccess("unverified");
      const { result } = renderHook(() => useCustomAgentsGate());

      await act(() => verifyStoredToken(false));

      expect(result.current).toBe("hidden");
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
        launchedConstant.replaceValue(true);
        await setCustomAgentsAccess(access);

        expect(getCustomAgentsGate()).toBe(gate);
        expect(isLicenseLapsed()).toBe(lapsed);
      }
    );
  });
});
