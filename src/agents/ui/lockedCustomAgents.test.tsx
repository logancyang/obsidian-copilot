import * as customAgentsGate from "@/agents/customAgentsGate";
import { CustomAgentsUpsellModal } from "@/agents/ui/CustomAgentsUpsell";
import { openLockedCustomAgents, renderNewAgentButton } from "@/agents/ui/lockedCustomAgents";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { verifyEntitlement, type EntitlementFeature } from "@/entitlement";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { applyEntitlement, verifyCachedEntitlement } from "@/plusUtils";
import { getSettings, setSettings } from "@/settings/model";
import { act, fireEvent, render, screen } from "@testing-library/react";
import * as obsidianModule from "obsidian";
import { App } from "obsidian";
import React from "react";

jest.mock("@/entitlement");

const mockOpenUpsell = jest.fn();
jest.mock("@/agents/ui/CustomAgentsUpsell", () => ({
  CustomAgentsUpsellModal: jest.fn(() => ({ open: mockOpenUpsell })),
}));

const mockOpenExpired = jest.fn();
jest.mock("@/components/modals/CopilotPlusExpiredModal", () => ({
  CopilotPlusExpiredModal: jest.fn(() => ({ open: mockOpenExpired })),
}));

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/582";

interface LicenseRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface LicenseReply {
  status: number;
  json: unknown;
}

const REFUSED_403: LicenseReply = {
  status: 403,
  json: { detail: { error: "FORBIDDEN", reason: "Invalid license key" } },
};
const REFUSED_400: LicenseReply = { status: 400, json: { detail: "license_key is required" } };
const GRANTED: LicenseReply = {
  status: 200,
  json: { is_valid: true, plan: "supporter", entitlement: "fresh-token" },
};

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

function answerLicenseChecks(reply: LicenseReply | Error): jest.Mock {
  const requestUrl = jest.fn(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  setRequestUrlImpl(requestUrl);
  return requestUrl;
}

function holdLicenseCheck(): { requestUrl: jest.Mock; reply: (reply: LicenseReply) => void } {
  let reply: (value: LicenseReply) => void = () => undefined;
  const requestUrl = jest.fn(
    () =>
      new Promise<LicenseReply>((resolve) => {
        reply = resolve;
      })
  );
  setRequestUrlImpl(requestUrl);
  return { requestUrl, reply: (value) => reply(value) };
}

function sentBody(requestUrl: jest.Mock, call = 0): Record<string, unknown> {
  const [request] = requestUrl.mock.calls[call] as [LicenseRequest];
  return JSON.parse(request.body) as Record<string, unknown>;
}

function licenseState() {
  const { plusLicenseKey, isPaidUser, isPlusUser, entitlementToken, entitlementExpiresAt } =
    getSettings();
  return { plusLicenseKey, isPaidUser, isPlusUser, entitlementToken, entitlementExpiresAt };
}

async function enterLicenseKey(key: string): Promise<void> {
  setSettings({
    userId: "user-1",
    plusLicenseKey: key,
    isPaidUser: false,
    isPlusUser: false,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
  await verifyCachedEntitlement();
}

function awaitRunningLicenseCheck(): Promise<void> {
  return act(() => openLockedCustomAgents(new App(), "custom_agent_dialog"));
}

function renderWithApp(element: React.ReactElement | undefined) {
  return render(
    <AppContext.Provider value={new App()}>
      <TooltipProvider>{element}</TooltipProvider>
    </AppContext.Provider>
  );
}

describe("lockedCustomAgents", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.replaceProperty(customAgentsGate, "launched", true);
    BrevilabsClient.getInstance().setPluginVersion("4.0.20");
    await enterLicenseKey("");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("openLockedCustomAgents()", () => {
    it.each([
      { who: "no license key", key: "", reply: REFUSED_403, features: [] },
      { who: "a free license key", key: "free-key", reply: REFUSED_403, features: [] },
      { who: "a Plus license key", key: "plus-key", reply: GRANTED, features: ["multi_agent"] },
    ] as const)(
      `sends one license check with trigger custom_agents for $who, then shows the dialog (${ISSUE})`,
      async ({ key, reply, features }) => {
        await enterLicenseKey(key);
        mockSignedClaims([...features]);
        const { requestUrl, reply: answer } = holdLicenseCheck();

        const opening = openLockedCustomAgents(new App(), "custom_agent_dialog");
        expect(mockOpenUpsell).not.toHaveBeenCalled();
        answer(reply);
        await opening;

        expect(requestUrl).toHaveBeenCalledTimes(1);
        const [request] = requestUrl.mock.calls[0] as [LicenseRequest];
        expect(new URL(request.url).pathname).toMatch(/\/license$/);
        expect(request.headers["X-Client-Version"]).toBe("4.0.20");
        expect(sentBody(requestUrl)).toEqual({
          trigger: "custom_agents",
          user_id: "user-1",
          ...(key ? { license_key: key } : {}),
        });
        expect(CustomAgentsUpsellModal).toHaveBeenCalledWith(
          expect.anything(),
          "custom_agent_dialog"
        );
        expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      { who: "no license key", key: "", reply: REFUSED_403, status: 403 },
      { who: "no license key", key: "", reply: REFUSED_400, status: 400 },
      { who: "a free license key", key: "free-key", reply: REFUSED_403, status: 403 },
      { who: "a free license key", key: "free-key", reply: REFUSED_400, status: 400 },
    ])(
      `leaves a never-paid user with $who exactly as they were when the check answers $status (${ISSUE})`,
      async ({ key, reply }) => {
        await enterLicenseKey(key);
        const before = licenseState();
        answerLicenseChecks(reply);

        await openLockedCustomAgents(new App(), "custom_agent_dialog");

        expect(licenseState()).toEqual(before);
        expect(CopilotPlusExpiredModal).not.toHaveBeenCalled();
        expect(customAgentsGate.getCustomAgentsGate()).toBe("locked");
        expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      }
    );

    it(`gives the feature instead of the dialog when the check grants custom_agents (${ISSUE})`, async () => {
      await enterLicenseKey("supporter-key");
      mockSignedClaims(["multi_agent", "custom_agents"]);
      answerLicenseChecks(GRANTED);
      const onUnlocked = jest.fn();

      await openLockedCustomAgents(new App(), "custom_agent_dialog", onUnlocked);

      expect(customAgentsGate.getCustomAgentsGate()).toBe("full");
      expect(onUnlocked).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });

    it(`shows the dialog, and no error, when the license check cannot reach the server (${ISSUE})`, async () => {
      answerLicenseChecks(new Error("net::ERR_INTERNET_DISCONNECTED"));

      await openLockedCustomAgents(new App(), "custom_agent_mention");

      expect(CustomAgentsUpsellModal).toHaveBeenCalledWith(
        expect.anything(),
        "custom_agent_mention"
      );
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });

    it(`sends one check and shows one dialog when clicked again while the check runs (${ISSUE})`, async () => {
      const { requestUrl, reply } = holdLicenseCheck();

      const first = openLockedCustomAgents(new App(), "custom_agent_dialog");
      const second = openLockedCustomAgents(new App(), "custom_agent_dialog");
      reply(REFUSED_403);
      await Promise.all([first, second]);

      expect(requestUrl).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });

    it(`opens the create dialog by itself once the entitlement turns on after the dialog was shown from + (${ISSUE})`, async () => {
      answerLicenseChecks(REFUSED_403);
      const onUnlocked = jest.fn();
      await openLockedCustomAgents(new App(), "custom_agent_dialog", onUnlocked);
      expect(onUnlocked).not.toHaveBeenCalled();

      setSettings({ plusLicenseKey: "supporter-key" });
      mockSignedClaims(["multi_agent", "custom_agents"]);
      await act(async () => {
        await applyEntitlement("license-entitlement-token");
      });
      setSettings({ isPaidUser: true });

      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });

    it(`keeps waiting through license changes that do not grant custom_agents (${ISSUE})`, async () => {
      answerLicenseChecks(REFUSED_403);
      const onUnlocked = jest.fn();
      await openLockedCustomAgents(new App(), "custom_agent_dialog", onUnlocked);

      setSettings({ plusLicenseKey: "plus-key" });
      mockSignedClaims(["multi_agent"]);
      await applyEntitlement("plus-entitlement-token");
      expect(onUnlocked).not.toHaveBeenCalled();

      mockSignedClaims(["multi_agent", "custom_agents"]);
      await applyEntitlement("upgraded-entitlement-token");
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });

    it(`opens one create dialog when + showed the dialog several times before the entitlement turned on (${ISSUE})`, async () => {
      answerLicenseChecks(REFUSED_403);
      const firstUnlock = jest.fn();
      const latestUnlock = jest.fn();
      await openLockedCustomAgents(new App(), "custom_agent_dialog", firstUnlock);
      await openLockedCustomAgents(new App(), "custom_agent_dialog", latestUnlock);

      setSettings({ plusLicenseKey: "supporter-key" });
      mockSignedClaims(["multi_agent", "custom_agents"]);
      await applyEntitlement("license-entitlement-token");

      expect(firstUnlock).not.toHaveBeenCalled();
      expect(latestUnlock).toHaveBeenCalledTimes(1);
    });
  });

  describe("renderNewAgentButton()", () => {
    it.each(["hidden", "pending"] as const)(
      `shows no + at all while the gate is %s, so nothing locked flashes at startup (${ISSUE})`,
      (gate) => {
        expect(
          renderNewAgentButton(gate, { emphasized: true, onCreate: jest.fn() })
        ).toBeUndefined();
      }
    );

    it("shows an unlocked + that opens the create dialog when the gate is full", () => {
      const onCreate = jest.fn();
      renderWithApp(renderNewAgentButton("full", { emphasized: true, onCreate }));

      fireEvent.click(screen.getByRole("button", { name: "New agent" }));

      expect(screen.queryByText("New agent · Supporter preview")).toBeNull();
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it(`shows a locked + named for the Supporter preview that checks the license, then shows the dialog (${ISSUE})`, async () => {
      const onCreate = jest.fn();
      const { requestUrl, reply } = holdLicenseCheck();
      renderWithApp(renderNewAgentButton("locked", { emphasized: true, onCreate }));
      const plus = screen.getByRole("button", { name: "New agent · Supporter preview" });

      fireEvent.click(plus);
      fireEvent.click(plus);
      reply(REFUSED_403);
      await awaitRunningLicenseCheck();

      expect(requestUrl).toHaveBeenCalledTimes(1);
      expect(sentBody(requestUrl).trigger).toBe("custom_agents");
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      expect(CustomAgentsUpsellModal).toHaveBeenCalledWith(
        expect.anything(),
        "custom_agent_dialog"
      );
      expect(onCreate).not.toHaveBeenCalled();
    });

    it(`opens the create dialog from the locked + once the license it checks grants custom_agents (${ISSUE})`, async () => {
      await setCustomAgentsAccess("free");
      mockSignedClaims(["multi_agent", "custom_agents"]);
      answerLicenseChecks(GRANTED);
      const onCreate = jest.fn();
      renderWithApp(renderNewAgentButton("locked", { emphasized: true, onCreate }));

      fireEvent.click(screen.getByRole("button", { name: "New agent · Supporter preview" }));
      await awaitRunningLicenseCheck();

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });
  });
});
