import type { PlanUsageReading } from "@/agentMode";
import type { ConnectorLogin, LoginOutcome } from "@/connectors/oauth/connectorAuth";
import { CopilotAccount, type CopilotAccountDeps } from "@/copilotAccount/copilotAccount";
import { applyAccountLicense, isAccountLicense, removeLicense } from "@/plusUtils";
import { resetSettings, getSettings, setSettings } from "@/settings/model";
import type { App } from "obsidian";
import * as desktopRuntime from "@/utils/desktopRuntime";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const mockApp = {};
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  useApp: () => mockApp,
}));

let mockPlugin: { copilotAccount?: CopilotAccount } = {};
jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  usePlugin: () => mockPlugin,
}));

const mockReadPlanUsage = jest.fn<Promise<PlanUsageReading>, []>();
jest.mock("@/agentMode", () => ({
  CopilotPlusUsageReader: class {
    readPlanUsage() {
      return mockReadPlanUsage();
    }
  },
}));

const mockValidateLicenseKey = jest.fn<Promise<{ isValid: boolean | undefined }>, unknown[]>();
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      validateLicenseKey: (...args: unknown[]) => mockValidateLicenseKey(...args),
    }),
  },
}));

const mockOpenWelcome = jest.fn();
jest.mock("@/components/modals/CopilotPlusWelcomeModal", () => ({
  CopilotPlusWelcomeModal: class {
    open() {
      mockOpenWelcome();
    }
  },
}));

interface ConfirmRequest {
  onConfirm: () => void;
  content: string;
  title: string;
}
const confirmRequests: ConfirmRequest[] = [];
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    constructor(_app: unknown, onConfirm: () => void, content: string, title: string) {
      confirmRequests.push({ onConfirm, content, title });
    }
    open() {}
  },
}));

const mockOpenedInSystemBrowser: string[] = [];
jest.mock("@/utils/electronShell", () => ({
  openLinkInSystemBrowser: (event: { preventDefault(): void; currentTarget: { href: string } }) => {
    event.preventDefault();
    mockOpenedInSystemBrowser.push(event.currentTarget.href);
  },
}));

import { PlusSettings } from "./PlusSettings";

const KEY_FIELD_PLACEHOLDER = "Enter your license key";

const DISCORD_INVITE_TEXT =
  "You're invited to the Copilot Discord: help from the team and other users.";

const USAGE_READING: PlanUsageReading = {
  kind: "usage",
  planUsage: {
    windows: [
      { id: "five_hour", label: "5h", percent: 12 },
      { id: "weekly", label: "Weekly", percent: 34 },
    ],
    updatedAt: 1,
  },
};

function accountAuth({ hasLogin }: { hasLogin: boolean }) {
  return {
    hasLogin: jest.fn(() => hasLogin),
    login: jest.fn(),
    accessToken: jest.fn(async () => ({ status: "unreachable" as const })),
    disconnect: jest.fn(async () => {}),
    receiveReturnLink: jest.fn(),
  } satisfies CopilotAccountDeps["auth"];
}

function finishedLogin(outcome: LoginOutcome): ConnectorLogin {
  return {
    connectionId: "copilot-account",
    serviceName: "Copilot",
    outcome: Promise.resolve(outcome),
    loginUrl: () => null,
    cancel: () => {},
  };
}

function provideAccount(auth: CopilotAccountDeps["auth"]): CopilotAccount {
  const account = new CopilotAccount({
    app: mockApp as App,
    auth,
    websiteOrigin: "https://www.obsidiancopilot.com",
    installId: () => "install-1",
    openUrl: jest.fn(),
  });
  mockPlugin = { copilotAccount: account };
  return account;
}

function storeActiveLicense(): void {
  setSettings({ plusLicenseKey: "stored-key", isPaidUser: true, entitlementExpiresAt: 0 });
}

describe("PlusSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmRequests.length = 0;
    mockOpenedInSystemBrowser.length = 0;
    mockPlugin = {};
    resetSettings();
    setSettings({ discordInviteDismissed: undefined });
    removeLicense();
    mockReadPlanUsage.mockResolvedValue(USAGE_READING);
  });

  afterEach(() => {
    mockPlugin.copilotAccount?.dispose();
    jest.restoreAllMocks();
  });

  describe("PlusSettings()", () => {
    it("offers the license key field, Apply and See plans while no license is stored", () => {
      render(<PlusSettings />);

      expect(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "See plans" })).toBeTruthy();
      expect(mockReadPlanUsage).not.toHaveBeenCalled();
    });

    it("drops the key row and welcomes the user once an applied key turns out active — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
      mockValidateLicenseKey.mockImplementation(async () => {
        setSettings({ isPaidUser: true });
        return { isValid: true };
      });
      render(<PlusSettings />);

      fireEvent.change(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER), {
        target: { value: "fresh-key" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      expect(getSettings().plusLicenseKey).toBe("fresh-key");
      expect(mockOpenWelcome).toHaveBeenCalledTimes(1);
      expect(screen.queryByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeNull();
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
    });

    it("says nothing about a key while its validation is still in flight, then reports the verdict", async () => {
      setSettings({ plusLicenseKey: "lapsed-key", isPaidUser: false });
      let resolveValidation: (result: { isValid: boolean }) => void = () => {};
      mockValidateLicenseKey.mockReturnValue(
        new Promise((resolve) => {
          resolveValidation = resolve;
        })
      );
      render(<PlusSettings />);
      expect(screen.getByText("Inactive")).toBeTruthy();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      expect(mockValidateLicenseKey).toHaveBeenCalledWith(mockApp, { trigger: "manual" });
      expect(screen.queryByText("Inactive")).toBeNull();

      await act(async () => {
        resolveValidation({ isValid: false });
      });

      expect(screen.getByText("Inactive")).toBeTruthy();
      expect(screen.getByText("Invalid license key")).toBeTruthy();
    });

    it("shows the 5-hour and weekly usage read when the settings open with an active license", async () => {
      storeActiveLicense();

      render(<PlusSettings />);

      const usageLine = await screen.findByRole("list", { name: "Usage" });
      expect(
        within(usageLine)
          .getAllByRole("listitem")
          .map((item) => item.textContent)
      ).toEqual(["5h 12% used", "Weekly 34% used"]);
      expect(screen.queryByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeNull();
    });

    it("shows Remove license without numbers when the usage read has no allowance windows — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
      mockReadPlanUsage.mockResolvedValue({ kind: "unavailable" });
      storeActiveLicense();

      render(<PlusSettings />);

      await waitFor(() => expect(mockReadPlanUsage).toHaveBeenCalledTimes(1));
      await act(async () => {
        await mockReadPlanUsage.mock.results[0].value;
      });
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Usage" })).toBeNull();
    });

    it("reads no usage on mobile, where the usage reader cannot load, and offers Remove license alone — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
      jest.spyOn(desktopRuntime, "isDesktopRuntime").mockReturnValue(false);
      storeActiveLicense();

      render(<PlusSettings />);
      await act(async () => {
        await import("@/agentMode");
      });

      expect(mockReadPlanUsage).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Usage" })).toBeNull();
    });

    it("removes the license after a confirmation that the plan is unaffected, restoring an empty key row", async () => {
      storeActiveLicense();
      render(<PlusSettings />);
      await screen.findByRole("list", { name: "Usage" });

      fireEvent.click(screen.getByRole("button", { name: "Remove license" }));
      expect(confirmRequests).toHaveLength(1);
      expect(confirmRequests[0].title).toBe("Remove license?");
      expect(confirmRequests[0].content).toContain("Your plan itself is not affected.");
      expect(getSettings().plusLicenseKey).toBe("stored-key");

      act(() => {
        confirmRequests[0].onConfirm();
      });

      expect(getSettings().plusLicenseKey).toBe("");
      expect(getSettings().isPaidUser).toBe(false);
      expect(screen.getByPlaceholderText<HTMLInputElement>(KEY_FIELD_PLACEHOLDER).value).toBe("");
      expect(screen.queryByRole("list", { name: "Usage" })).toBeNull();
    });

    it("keeps the applied key and its plan, and says what happened, when a sign-in fails — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
      storeActiveLicense();
      const auth = accountAuth({ hasLogin: false });
      auth.login.mockReturnValue(finishedLogin({ status: "failed", reason: "unreachable" }));
      provideAccount(auth);
      render(<PlusSettings />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      });

      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "Couldn't reach the Copilot website. Check your connection."
      );
      expect(getSettings().plusLicenseKey).toBe("stored-key");
      expect(getSettings().isPaidUser).toBe(true);
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
    });

    it("reads the signed-in account each time the settings open", async () => {
      const auth = accountAuth({ hasLogin: true });
      provideAccount(auth);

      render(<PlusSettings />);

      await waitFor(() => expect(auth.accessToken).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("button", { name: "Account" }).textContent).toBe("Signed in");
    });

    it("signs out from the account menu and leaves a pasted license key in place", async () => {
      storeActiveLicense();
      const auth = accountAuth({ hasLogin: true });
      provideAccount(auth);
      render(<PlusSettings />);

      fireEvent.keyDown(screen.getByRole("button", { name: "Account" }), { key: "Enter" });
      await act(async () => {
        fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
      });

      expect(auth.disconnect).toHaveBeenCalledWith("copilot-account");
      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
      expect(getSettings().plusLicenseKey).toBe("stored-key");
    });

    it("offers no Remove license for a license that came from the account — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
      applyAccountLicense("account-key");
      setSettings({ isPaidUser: true });
      provideAccount(accountAuth({ hasLogin: true }));

      render(<PlusSettings />);

      await screen.findByRole("list", { name: "Usage" });
      expect(screen.queryByRole("button", { name: "Remove license" })).toBeNull();
    });

    it("leaves the key field empty rather than showing the account's key when that license is inactive — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      applyAccountLicense("account-key");
      provideAccount(accountAuth({ hasLogin: true }));

      render(<PlusSettings />);

      expect(screen.getByPlaceholderText<HTMLInputElement>(KEY_FIELD_PLACEHOLDER).value).toBe("");
    });

    it("applies a typed key as the user's own, even one matching the key the account last applied — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
      setSettings({ accountLicenseKey: "typed-key" });
      mockValidateLicenseKey.mockResolvedValue({ isValid: false });
      render(<PlusSettings />);

      fireEvent.change(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER), {
        target: { value: "typed-key" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      expect(getSettings().plusLicenseKey).toBe("typed-key");
      expect(isAccountLicense(getSettings())).toBe(false);
    });

    it("checks the account again when the user comes back to Obsidian from See plans — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
      const openPage = jest.spyOn(window, "open").mockReturnValue(null);
      const auth = accountAuth({ hasLogin: true });
      provideAccount(auth);
      render(<PlusSettings />);
      await waitFor(() => expect(auth.accessToken).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("button", { name: "See plans" }));
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => expect(auth.accessToken).toHaveBeenCalledTimes(2));
      expect(openPage).toHaveBeenCalledWith(expect.stringContaining("/pricing"), "_blank");
      openPage.mockRestore();
    });

    it("offers no Sign in where Copilot has no account sign-in", () => {
      render(<PlusSettings />);

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });
    it("invites the user to the Discord after sign-in and, once closed, never again, also after signing out and in — https://github.com/Brevilabs/obsidian-copilot-private/issues/925", async () => {
      const auth = accountAuth({ hasLogin: false });
      auth.login.mockReturnValue(finishedLogin({ status: "connected" }));
      provideAccount(auth);
      render(<PlusSettings />);
      expect(screen.queryByText(DISCORD_INVITE_TEXT)).toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      });
      expect(screen.getByText(DISCORD_INVITE_TEXT)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Hide the Discord invite" }));
      expect(getSettings().discordInviteDismissed).toBe(true);
      expect(screen.queryByText(DISCORD_INVITE_TEXT)).toBeNull();

      fireEvent.keyDown(screen.getByRole("button", { name: "Account" }), { key: "Enter" });
      await act(async () => {
        fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      });
      expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
      expect(screen.queryByText(DISCORD_INVITE_TEXT)).toBeNull();
    });

    it("opens the Discord invite and puts the invite away for good from Join Discord", async () => {
      provideAccount(accountAuth({ hasLogin: true }));
      render(<PlusSettings />);

      fireEvent.click(await screen.findByRole("link", { name: "Join Discord" }));

      expect(mockOpenedInSystemBrowser).toEqual(["https://discord.gg/5byWwcq5Qq"]);
      expect(getSettings().discordInviteDismissed).toBe(true);
      expect(screen.queryByText(DISCORD_INVITE_TEXT)).toBeNull();
    });
  });
});
