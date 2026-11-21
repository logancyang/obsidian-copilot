import * as customAgentsGate from "@/agents/customAgentsGate";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { CustomAgentsUpsellModal } from "@/agents/ui/CustomAgentsUpsell";
import { LockedAgentsUpsellModal } from "@/agents/ui/LockedAgentsUpsell";
import { fakeAgentStore } from "@/agents/ui/testing/fakeAgentStore";
import { COCO, MAYA } from "@/agents/ui/testing/rosterFixtures";
import { CustomAgentStoreContext } from "@/agents/ui/useCustomAgents";
import {
  openLockedAgentProfile,
  openLockedCustomAgents,
  renderNewAgentButton,
  useLockedAgentMention,
} from "@/agents/ui/lockedCustomAgents";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { verifyEntitlement, type EntitlementFeature } from "@/entitlement";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { applyEntitlement, verifyCachedEntitlement } from "@/plusUtils";
import { getSettings, setSettings } from "@/settings/model";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import * as obsidianModule from "obsidian";
import { App } from "obsidian";
import React from "react";

jest.mock("@/entitlement");

const mockOpenUpsell = jest.fn();
jest.mock("@/agents/ui/CustomAgentsUpsell", () => ({
  CustomAgentsUpsellModal: jest.fn(() => ({ open: mockOpenUpsell })),
}));

const mockOpenLockedAgents = jest.fn();
jest.mock("@/agents/ui/LockedAgentsUpsell", () => ({
  LockedAgentsUpsellModal: jest.fn(() => ({ open: mockOpenLockedAgents })),
}));

const mockOpenExpired = jest.fn();
jest.mock("@/components/modals/CopilotPlusExpiredModal", () => ({
  CopilotPlusExpiredModal: jest.fn(() => ({ open: mockOpenExpired })),
}));

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/582";
const LOCKED_AGENTS_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const MENTION_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const UNLOCK_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/1016";
const NO_AGENTS: readonly CustomAgent[] = [];
const AGENTS = [COCO, MAYA] as unknown as readonly CustomAgent[];

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
  return act(() => openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS));
}

function renderMentionHook(enabled: boolean, agents = NO_AGENTS) {
  const { store } = fakeAgentStore(agents);
  return renderHook(() => useLockedAgentMention(enabled), {
    wrapper: ({ children }) => (
      <AppContext.Provider value={new App()}>
        <CustomAgentStoreContext.Provider value={store}>
          {children}
        </CustomAgentStoreContext.Provider>
      </AppContext.Provider>
    ),
  });
}

function renderWithApp(element: React.ReactElement | undefined, agents = NO_AGENTS) {
  const { store } = fakeAgentStore(agents);
  return render(
    <AppContext.Provider value={new App()}>
      <CustomAgentStoreContext.Provider value={store}>
        <TooltipProvider>{element}</TooltipProvider>
      </CustomAgentStoreContext.Provider>
    </AppContext.Provider>
  );
}

describe("lockedCustomAgents", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    BrevilabsClient.getInstance().setPluginVersion("4.0.20");
    await enterLicenseKey("free-key");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("openLockedCustomAgents()", () => {
    it.each([
      { who: "a free license key", key: "free-key", reply: REFUSED_403, features: [] },
      { who: "a Plus license key", key: "plus-key", reply: GRANTED, features: ["multi_agent"] },
    ] as const)(
      `sends one license check with trigger custom_agents for $who, then shows the dialog (${ISSUE})`,
      async ({ key, reply, features }) => {
        await enterLicenseKey(key);
        mockSignedClaims([...features]);
        const { requestUrl, reply: answer } = holdLicenseCheck();

        const opening = openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS);
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
          license_key: key,
        });
        expect(CustomAgentsUpsellModal).toHaveBeenCalledWith(
          expect.anything(),
          "custom_agent_dialog"
        );
        expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      }
    );

    it(`sends no license request from a device without a license key, and still shows the dialog (https://github.com/Brevilabs/obsidian-copilot-private/issues/594)`, async () => {
      await enterLicenseKey("");
      const requestUrl = answerLicenseChecks(REFUSED_403);

      await openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS);

      expect(requestUrl).not.toHaveBeenCalled();
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });

    it.each([
      { who: "a free license key", key: "free-key", reply: REFUSED_403, status: 403 },
      { who: "a free license key", key: "free-key", reply: REFUSED_400, status: 400 },
    ])(
      `leaves a never-paid user with $who exactly as they were when the check answers $status (${ISSUE})`,
      async ({ key, reply }) => {
        await enterLicenseKey(key);
        const before = licenseState();
        answerLicenseChecks(reply);

        await openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS);

        expect(licenseState()).toEqual(before);
        expect(CopilotPlusExpiredModal).not.toHaveBeenCalled();
        expect(customAgentsGate.getCustomAgentsGate()).toBe("locked");
        expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      }
    );

    it(`opens what was clicked, and no dialog, when the click's own check grants custom_agents (${UNLOCK_ISSUE})`, async () => {
      await enterLicenseKey("supporter-key");
      mockSignedClaims(["multi_agent", "custom_agents"]);
      answerLicenseChecks(GRANTED);
      const onUnlocked = jest.fn();

      await openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS, onUnlocked);

      expect(customAgentsGate.getCustomAgentsGate()).toBe("full");
      expect(onUnlocked).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });

    it.each([
      { from: "+", medium: "custom_agent_dialog" },
      { from: "the @ row", medium: "custom_agent_mention" },
    ] as const)(
      `shows the vault's own agents instead of the Supporter preview when $from is chosen in a vault with agents (${LOCKED_AGENTS_ISSUE})`,
      async ({ medium }) => {
        answerLicenseChecks(REFUSED_403);

        await openLockedCustomAgents(new App(), medium, AGENTS);

        expect(LockedAgentsUpsellModal).toHaveBeenCalledWith(expect.anything(), AGENTS);
        expect(mockOpenLockedAgents).toHaveBeenCalledTimes(1);
        expect(mockOpenUpsell).not.toHaveBeenCalled();
      }
    );

    it(`shows the dialog, and no error, when the license check cannot reach the server (${ISSUE})`, async () => {
      answerLicenseChecks(new Error("net::ERR_INTERNET_DISCONNECTED"));

      await openLockedCustomAgents(new App(), "custom_agent_mention", NO_AGENTS);

      expect(CustomAgentsUpsellModal).toHaveBeenCalledWith(
        expect.anything(),
        "custom_agent_mention"
      );
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });

    it(`sends one check and shows one dialog when clicked again while the check runs (${ISSUE})`, async () => {
      const { requestUrl, reply } = holdLicenseCheck();

      const first = openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS);
      const second = openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS);
      reply(REFUSED_403);
      await Promise.all([first, second]);

      expect(requestUrl).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });

    it(`opens no create dialog when a license with custom_agents is entered after + showed the dialog (${UNLOCK_ISSUE})`, async () => {
      answerLicenseChecks(REFUSED_403);
      const onUnlocked = jest.fn();
      await openLockedCustomAgents(new App(), "custom_agent_dialog", NO_AGENTS, onUnlocked);

      setSettings({ plusLicenseKey: "supporter-key" });
      mockSignedClaims(["multi_agent", "custom_agents"]);
      await act(async () => {
        await applyEntitlement("license-entitlement-token");
      });
      setSettings({ isPaidUser: true });

      expect(customAgentsGate.getCustomAgentsGate()).toBe("full");
      expect(onUnlocked).not.toHaveBeenCalled();
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });
  });

  describe("openLockedAgentProfile()", () => {
    it(`checks the license with trigger custom_agents on a device with a license key, then opens the locked profile once when clicked twice meanwhile (${LOCKED_AGENTS_ISSUE})`, async () => {
      await enterLicenseKey("license-key");
      const { requestUrl, reply } = holdLicenseCheck();
      const openProfile = jest.fn();

      const first = openLockedAgentProfile(new App(), openProfile);
      const second = openLockedAgentProfile(new App(), openProfile);
      expect(openProfile).not.toHaveBeenCalled();
      reply(REFUSED_403);
      await Promise.all([first, second]);

      expect(requestUrl).toHaveBeenCalledTimes(1);
      expect(sentBody(requestUrl)).toEqual({
        trigger: "custom_agents",
        user_id: "user-1",
        license_key: "license-key",
      });
      expect(openProfile).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });

    it(`opens the profile unlocked when the check grants custom_agents (${LOCKED_AGENTS_ISSUE})`, async () => {
      await enterLicenseKey("supporter-key");
      mockSignedClaims(["multi_agent", "custom_agents"]);
      answerLicenseChecks(GRANTED);
      const openProfile = jest.fn();

      await openLockedAgentProfile(new App(), openProfile);

      expect(customAgentsGate.getCustomAgentsGate()).toBe("full");
      expect(openProfile).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });
  });

  describe("renderNewAgentButton()", () => {
    it(`shows no + at all while the gate is pending, so nothing locked flashes at startup (${ISSUE})`, () => {
      expect(
        renderNewAgentButton("pending", { emphasized: true, onCreate: jest.fn() })
      ).toBeUndefined();
    });

    it("shows an unlocked + that opens the create dialog when the gate is full", () => {
      const onCreate = jest.fn();
      renderWithApp(renderNewAgentButton("full", { emphasized: true, onCreate }));

      fireEvent.click(screen.getByRole("button", { name: "New teammate" }));

      expect(screen.queryByText("New teammate · Supporter preview")).toBeNull();
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it(`shows a locked + named for the Supporter preview that checks the license, then shows the dialog (${ISSUE})`, async () => {
      const onCreate = jest.fn();
      const { requestUrl, reply } = holdLicenseCheck();
      renderWithApp(renderNewAgentButton("locked", { emphasized: true, onCreate }));
      const plus = screen.getByRole("button", { name: "New teammate · Supporter preview" });

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

    it(`opens the dialog for the vault's agents from the locked + in a vault with agents (${LOCKED_AGENTS_ISSUE})`, async () => {
      answerLicenseChecks(REFUSED_403);
      renderWithApp(
        renderNewAgentButton("locked", { emphasized: false, onCreate: jest.fn() }),
        AGENTS
      );

      fireEvent.click(screen.getByRole("button", { name: "New teammate · Supporter preview" }));
      await awaitRunningLicenseCheck();

      expect(LockedAgentsUpsellModal).toHaveBeenCalledWith(expect.anything(), AGENTS);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });

    it(`opens the create dialog from the locked + when the license it checks grants custom_agents (${UNLOCK_ISSUE})`, async () => {
      await setCustomAgentsAccess("free");
      mockSignedClaims(["multi_agent", "custom_agents"]);
      answerLicenseChecks(GRANTED);
      const onCreate = jest.fn();
      renderWithApp(renderNewAgentButton("locked", { emphasized: true, onCreate }));

      fireEvent.click(screen.getByRole("button", { name: "New teammate · Supporter preview" }));
      await awaitRunningLicenseCheck();

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });
  });

  describe("useLockedAgentMention()", () => {
    it(`offers the Teammates row locked, marked Supporter preview, while the gate is locked (${MENTION_ISSUE})`, () => {
      const { result } = renderMentionHook(true);

      expect(result.current?.option).toMatchObject({
        title: "Teammates",
        category: "agents",
        lockedNote: "Supporter preview",
      });
    });

    it.each([
      { gate: "pending", setUp: () => setCustomAgentsAccess("unverified") },
      { gate: "full", setUp: () => setCustomAgentsAccess("team") },
    ])(`offers no row while the gate is $gate (${ISSUE})`, async ({ gate, setUp }) => {
      await setUp();
      expect(customAgentsGate.getCustomAgentsGate()).toBe(gate);

      const { result } = renderMentionHook(true);

      expect(result.current).toBeNull();
    });

    it("offers no row in a chat that cannot use custom agents", () => {
      const { result } = renderMentionHook(false);

      expect(result.current).toBeNull();
    });

    it(`checks the license with trigger custom_agents, then shows the dialog tagged custom_agent_mention, once when chosen twice meanwhile (${ISSUE})`, async () => {
      const { requestUrl, reply } = holdLicenseCheck();
      const { result } = renderMentionHook(true);

      act(() => result.current?.choose());
      act(() => result.current?.choose());
      reply(REFUSED_403);
      await awaitRunningLicenseCheck();

      expect(requestUrl).toHaveBeenCalledTimes(1);
      expect(sentBody(requestUrl).trigger).toBe("custom_agents");
      expect(CustomAgentsUpsellModal).toHaveBeenCalledWith(
        expect.anything(),
        "custom_agent_mention"
      );
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });

    it(`keeps the locked Teammates row in a vault with agents, and opens the dialog for them when it is chosen (${LOCKED_AGENTS_ISSUE})`, async () => {
      answerLicenseChecks(REFUSED_403);
      const { result } = renderMentionHook(true, AGENTS);
      expect(result.current?.option).toMatchObject({
        title: "Teammates",
        lockedNote: "Supporter preview",
      });
      expect(result.current?.agents).toEqual(AGENTS);

      act(() => result.current?.choose());
      await awaitRunningLicenseCheck();

      expect(LockedAgentsUpsellModal).toHaveBeenCalledWith(expect.anything(), AGENTS);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });

    it(`drops the row, opening nothing else, once a license with custom_agents is entered after the dialog (${ISSUE})`, async () => {
      answerLicenseChecks(REFUSED_403);
      const { result } = renderMentionHook(true);
      act(() => result.current?.choose());
      await awaitRunningLicenseCheck();

      setSettings({ plusLicenseKey: "supporter-key" });
      mockSignedClaims(["multi_agent", "custom_agents"]);
      await act(() => applyEntitlement("license-entitlement-token"));

      expect(result.current).toBeNull();
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
    });
  });
});
