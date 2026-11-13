import type { AccountProfile, CopilotAccountState } from "@/copilotAccount/copilotAccount";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { AccountControl, type AccountControlProps } from "./AccountControl";

const mockOpenedInSystemBrowser: string[] = [];
jest.mock("@/utils/electronShell", () => ({
  openLinkInSystemBrowser: (event: { preventDefault(): void; currentTarget: { href: string } }) => {
    event.preventDefault();
    mockOpenedInSystemBrowser.push(event.currentTarget.href);
  },
}));

const FREE_PROFILE: AccountProfile = {
  email: "you@example.com",
  name: "Your Name",
  plan: "free",
};

function signedIn(profile: AccountProfile | null): CopilotAccountState {
  return { status: "signed-in", profile };
}

function renderControl(state: CopilotAccountState) {
  const props: AccountControlProps = {
    state,
    onSignIn: jest.fn(),
    onOpenSignInPage: jest.fn(),
    onCancelSignIn: jest.fn(),
    onRefreshPlan: jest.fn(),
    onSignOut: jest.fn(),
  };
  render(<AccountControl {...props} />);
  return props;
}

function openMenu(pillName: string): void {
  fireEvent.keyDown(screen.getByRole("button", { name: pillName }), { key: "Enter" });
}

describe("AccountControl", () => {
  describe("AccountControl()", () => {
    it("offers Sign in while signed out", () => {
      const props = renderControl({ status: "signed-out", failure: null });

      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      expect(props.onSignIn).toHaveBeenCalledTimes(1);
    });

    it("asks the user to finish in the browser, with Open page and Cancel, while signing in", () => {
      const props = renderControl({ status: "signing-in" });

      expect(screen.getByRole("status").textContent).toBe("Finish signing in in your browser");
      fireEvent.click(screen.getByRole("button", { name: "Open page" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(props.onOpenSignInPage).toHaveBeenCalledTimes(1);
      expect(props.onCancelSignIn).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("shows a free account as a Free pill with the account's initial in place of Sign in", () => {
      renderControl(signedIn(FREE_PROFILE));

      const pill = screen.getByRole("button", { name: "Account, Free plan" });
      expect(pill.textContent).toBe("YFree");
      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("names the paid plan on the pill, and a lifetime purchase Lifetime", () => {
      renderControl(signedIn({ ...FREE_PROFILE, plan: "believer" }));

      expect(screen.getByRole("button", { name: "Account, Lifetime plan" })).toBeTruthy();
    });

    it("shows a paid plan under its own name", () => {
      renderControl(signedIn({ ...FREE_PROFILE, plan: "plus" }));

      expect(screen.getByRole("button", { name: "Account, Plus plan" }).textContent).toContain(
        "Plus"
      );
    });

    it("reads Signed in on the pill until the account's plan has been read", () => {
      renderControl(signedIn(null));

      expect(screen.getByRole("button", { name: "Account" }).textContent).toBe("Signed in");
    });

    it("opens a menu with the account's email, Dashboard, Refresh plan and Sign out from the pill", async () => {
      const props = renderControl(signedIn(FREE_PROFILE));

      openMenu("Account, Free plan");

      expect(await screen.findByText("you@example.com")).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Dashboard" }).getAttribute("href")).toBe(
        "https://www.obsidiancopilot.com/dashboard?utm_source=obsidian_copilot&utm_medium=license_settings"
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Refresh plan" }));
      expect(props.onRefreshPlan).toHaveBeenCalledTimes(1);
      openMenu("Account, Free plan");
      fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
      expect(props.onSignOut).toHaveBeenCalledTimes(1);
    });

    it("opens Dashboard in the system browser and closes the menu", async () => {
      renderControl(signedIn(FREE_PROFILE));
      openMenu("Account, Free plan");

      fireEvent.click(await screen.findByRole("menuitem", { name: "Dashboard" }));

      expect(mockOpenedInSystemBrowser).toEqual([
        "https://www.obsidiancopilot.com/dashboard?utm_source=obsidian_copilot&utm_medium=license_settings",
      ]);
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    });
  });
});
