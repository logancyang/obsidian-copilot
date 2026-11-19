import * as customAgentsGate from "@/agents/customAgentsGate";
import {
  getCustomAgentsGate,
  useCustomAgentsGate,
} from "@/agents/customAgentsGate";
import { setCustomAgentsAccess, verifyStoredToken } from "@/agents/testing/customAgentsAccess";
import { act, renderHook } from "@testing-library/react";

jest.mock("@/entitlement");

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
});
