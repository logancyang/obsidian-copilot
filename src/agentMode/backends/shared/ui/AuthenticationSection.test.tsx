import {
  AuthenticationSection,
  type AuthenticationState,
} from "@/agentMode/backends/shared/ui/AuthenticationSection";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/379";
const auth: AuthenticationState = {
  status: { signedIn: false },
  signingIn: false,
  signingOut: false,
  url: null,
  terminalCommand: "agent login",
  onSignIn: jest.fn(),
  onSignOut: jest.fn(),
};

describe("AuthenticationSection", () => {
  describe("AuthenticationSection()", () => {
    it(`shows the same browser action and an expanded terminal alternative when signed out: ${ISSUE}`, () => {
      const { container } = render(
        <AuthenticationSection ready unavailableMessage="Install agent first." auth={auth} />
      );
      expect(
        screen.getByRole("heading", { name: "Authentication" }).parentElement?.textContent
      ).toBe("AuthenticationNot signed in");
      expect(screen.getByText("Sign in using a terminal instead")).toBeTruthy();
      expect(container.querySelector("details")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Sign in with your browser" }));
      expect(auth.onSignIn).toHaveBeenCalledTimes(1);
    });
    it(`shows the account and sign-out without terminal instructions after authentication: ${ISSUE}`, () => {
      const { rerender } = render(
        <AuthenticationSection
          ready
          unavailableMessage="Install agent first."
          auth={{ ...auth, status: { signedIn: true, label: "zero@example.com" } }}
        />
      );
      expect(
        screen.getByRole("heading", { name: "Authentication" }).parentElement?.textContent
      ).toBe("AuthenticationSigned in");
      expect(screen.getByText("Signed in as zero@example.com.")).toBeTruthy();
      expect(screen.queryByText("Sign in using a terminal instead")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(auth.onSignOut).toHaveBeenCalledTimes(1);
      rerender(
        <AuthenticationSection
          ready
          unavailableMessage="Install agent first."
          auth={{ ...auth, status: { signedIn: true }, signingOut: true }}
        />
      );
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Signing out…" }).disabled).toBe(
        true
      );
      rerender(
        <AuthenticationSection
          ready
          unavailableMessage="Install agent first."
          auth={{ ...auth, status: { signedIn: true }, failed: true }}
        />
      );
      expect(screen.getByText("Sign-out didn't complete. Try again.")).toBeTruthy();
    });
    it(`hides terminal commands until the initial status is known: ${ISSUE}`, () => {
      render(
        <AuthenticationSection
          ready
          unavailableMessage="Install agent first."
          auth={{ ...auth, status: null }}
        />
      );
      expect(screen.getByRole("status").textContent).toBe("Checking…");
      expect(screen.queryByText("Sign in using a terminal instead")).toBeNull();
    });
    it(`requires an installed CLI before offering authentication: ${ISSUE}`, () => {
      render(
        <AuthenticationSection
          ready={false}
          unavailableMessage="Install agent first."
          auth={auth}
        />
      );
      expect(screen.getByRole("alert").textContent).toBe("Install agent first.");
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
