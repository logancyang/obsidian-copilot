import type { CopilotAccountState } from "@/copilotAccount/copilotAccount";
import type { AccountControlProps } from "@/copilotAccount/ui/AccountControl";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { CopilotLicenseSection, type CopilotLicenseSectionProps } from "./CopilotLicenseSection";

function accountIn(state: CopilotAccountState): AccountControlProps {
  return {
    state,
    onSignIn: jest.fn(),
    onOpenSignInPage: jest.fn(),
    onCancelSignIn: jest.fn(),
    onRefreshPlan: jest.fn(),
    onSignOut: jest.fn(),
  };
}

const SIGNED_OUT: CopilotAccountState = { status: "signed-out", failure: null };

const PLUS_PROFILE = { email: "you@example.com", name: "You", plan: "plus" };

const KEY_FIELD_PLACEHOLDER = "Enter your license key";

function renderSection(overrides: Partial<CopilotLicenseSectionProps> = {}) {
  const props: CopilotLicenseSectionProps = {
    license: { status: "none" },
    licenseKey: "",
    onLicenseKeyChange: jest.fn(),
    isApplying: false,
    onApply: jest.fn(),
    applyError: null,
    onSeePlans: jest.fn(),
    usageWindows: null,
    onRemoveLicense: jest.fn(),
    account: null,
    ...overrides,
  };
  render(<CopilotLicenseSection {...props} />);
  return props;
}

function usageLineText(): Array<string | null> {
  return within(screen.getByRole("list", { name: "Usage" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("CopilotLicenseSection", () => {
  describe("CopilotLicenseSection()", () => {
    it("offers the key field, Apply and See plans while no license is applied", () => {
      const props = renderSection();

      expect(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "See plans" }));
      expect(props.onSeePlans).toHaveBeenCalledWith(window);
      expect(screen.queryByRole("button", { name: "Remove license" })).toBeNull();
    });

    it("applies the typed key from Apply", () => {
      const props = renderSection({ licenseKey: "typed-key" });

      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      expect(props.onApply).toHaveBeenCalledTimes(1);
    });

    it("explains a rejected key under the key field", () => {
      renderSection({ license: { status: "inactive" }, applyError: "Invalid license key" });

      expect(screen.getByText("Invalid license key")).toBeTruthy();
    });

    it("drops the key row once the license is active, so the key cannot be read back — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", () => {
      renderSection({ license: { status: "active", plan: "plus" }, licenseKey: "secret-key" });

      expect(screen.queryByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeNull();
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
      expect(screen.queryByRole("button", { name: "See plans" })).toBeNull();
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
    });

    it("shows how much of each allowance window is used, in whole percents, separated by a dot", () => {
      renderSection({
        license: { status: "active", plan: "plus" },
        usageWindows: [
          { id: "five_hour", label: "5h", percent: 12.4 },
          { id: "weekly", label: "Weekly", percent: 34 },
        ],
      });

      expect(usageLineText()).toEqual(["5h 12% used", "Weekly 34% used"]);
      expect(screen.getByRole("list", { name: "Usage" }).textContent).toBe(
        "5h 12% used·Weekly 34% used"
      );
    });

    it("shows Remove license without numbers when usage is unavailable — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", () => {
      renderSection({ license: { status: "active", plan: "plus" }, usageWindows: null });

      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Usage" })).toBeNull();
    });

    it("asks to remove the license from Remove license", () => {
      const props = renderSection({ license: { status: "active", plan: "plus" } });

      fireEvent.click(screen.getByRole("button", { name: "Remove license" }));

      expect(props.onRemoveLicense).toHaveBeenCalledTimes(1);
    });

    it("names a lifetime purchase Lifetime rather than its stored plan", () => {
      renderSection({ license: { status: "active", plan: "believer" } });

      expect(screen.getByText("Lifetime")).toBeTruthy();
      expect(screen.queryByText(/believer/i)).toBeNull();
    });

    it("shows a recurring plan under its own name", () => {
      renderSection({ license: { status: "active", plan: "lite" } });

      expect(screen.getByText("lite")).toBeTruthy();
    });

    it("reports a stored key that grants nothing as inactive and keeps the key row to fix it", () => {
      renderSection({ license: { status: "inactive" }, licenseKey: "lapsed-key" });

      expect(screen.getByText("Inactive")).toBeTruthy();
      expect(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Remove license" })).toBeNull();
    });

    it("shows no license verdict while a key is being applied", () => {
      renderSection({ license: { status: "inactive" }, isApplying: true });

      expect(screen.queryByText("Inactive")).toBeNull();
      expect(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeTruthy();
    });

    it("offers Sign in at the right of the title while signed out", () => {
      const account = accountIn(SIGNED_OUT);
      renderSection({ account });

      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      expect(account.onSignIn).toHaveBeenCalledTimes(1);
      expect(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeTruthy();
    });

    it("offers Sign in beside the plan badge when a license key is applied while signed out", () => {
      renderSection({
        license: { status: "active", plan: "plus" },
        account: accountIn(SIGNED_OUT),
      });

      expect(screen.getByText("plus")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
    });

    it("shows the account pill alone in place of the license badge once signed in — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", () => {
      renderSection({
        license: { status: "active", plan: "plus" },
        account: accountIn({
          status: "signed-in",
          profile: { email: "you@example.com", name: "You", plan: "free" },
          notice: null,
        }),
      });

      expect(screen.getByRole("button", { name: "Account, Free plan" })).toBeTruthy();
      expect(screen.queryByText("plus")).toBeNull();
      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("offers no Remove license for a license that came from the account — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      renderSection({
        license: { status: "active", plan: "plus" },
        usageWindows: [{ id: "weekly", label: "Weekly", percent: 34 }],
        onRemoveLicense: null,
        account: accountIn({ status: "signed-in", profile: PLUS_PROFILE, notice: null }),
      });

      expect(usageLineText()).toEqual(["Weekly 34% used"]);
      expect(screen.queryByRole("button", { name: "Remove license" })).toBeNull();
    });

    it("shows no usage row for the account's license when usage cannot be read — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      renderSection({
        license: { status: "active", plan: "plus" },
        usageWindows: null,
        onRemoveLicense: null,
      });

      expect(document.querySelector("section")?.lastElementChild?.textContent).toContain(
        "OpenArtifacts"
      );
    });

    it("confirms, under the plan's name, a license just applied from the account — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      renderSection({
        license: { status: "active", plan: "plus" },
        onRemoveLicense: null,
        account: accountIn({
          status: "signed-in",
          profile: PLUS_PROFILE,
          notice: { kind: "applied", plan: "plus" },
        }),
      });

      expect(screen.getByRole("status").textContent).toBe(
        "You're on Plus. Your license was applied from your account."
      );
    });

    it("says the plan ended while the user stays signed in, with the key row back — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
      renderSection({
        account: accountIn({
          status: "signed-in",
          profile: { ...PLUS_PROFILE, plan: "free" },
          notice: { kind: "ended", plan: "believer" },
        }),
      });

      expect(screen.getByRole("status").textContent).toBe(
        "Your Lifetime plan has ended. You're still signed in, now on the free plan."
      );
      expect(screen.getByRole("button", { name: "Account, Free plan" })).toBeTruthy();
      expect(screen.getByPlaceholderText(KEY_FIELD_PLACEHOLDER)).toBeTruthy();
    });

    it("says a paid plan ended when the plan's name is unknown", () => {
      renderSection({
        account: accountIn({
          status: "signed-in",
          profile: null,
          notice: { kind: "ended", plan: null },
        }),
      });

      expect(screen.getByRole("status").textContent).toBe(
        "Your paid plan has ended. You're still signed in, now on the free plan."
      );
    });

    it("says why the last sign-in didn't finish and keeps the applied license", () => {
      renderSection({
        license: { status: "active", plan: "plus" },
        account: accountIn({ status: "signed-out", failure: "timed-out" }),
      });

      expect(screen.getByRole("alert").textContent).toBe(
        "Sign-in timed out. Try again when you're ready."
      );
      expect(screen.getByText("plus")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    });

    it("offers no Sign in where signing in isn't available", () => {
      renderSection({ account: null });

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("sends the paid plans link to pricing with settings attribution — https://github.com/Brevilabs/obsidian-copilot-private/issues/640", () => {
      renderSection();

      expect(screen.getByRole("link", { name: "Copilot paid plans" }).getAttribute("href")).toBe(
        "https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=settings"
      );
    });

    it("links OpenArtifacts and Miyo from the description with license settings attribution", () => {
      renderSection();

      expect(screen.getByRole("link", { name: "OpenArtifacts" }).getAttribute("href")).toBe(
        "https://openartifacts.ai/?utm_source=obsidian_copilot&utm_medium=license_settings"
      );
      expect(screen.getByRole("link", { name: "Miyo" }).getAttribute("href")).toBe(
        "https://www.miyo.md/?utm_source=obsidian_copilot&utm_medium=license_settings"
      );
    });
  });
});
