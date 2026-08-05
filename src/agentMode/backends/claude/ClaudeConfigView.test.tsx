import type { InstallState } from "@/agentMode/session/types";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ClaudeConfigView, type ClaudeConfigViewProps } from "./ClaudeConfigView";
import { CLAUDE_AUTH_COMMAND, CLAUDE_INSTALL_COMMAND } from "./cliSetup";

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "2.1.205",
  minVersion: "2.1.206",
  message: "Claude 2.1.205 is not supported. Copilot requires 2.1.206 or newer.",
};

/** Match the `<code>` block that renders exactly this command behind the shell prompt. */
const commandBlock =
  (command: string) =>
  (_content: string, element: Element | null): boolean =>
    element?.tagName === "CODE" && element.textContent === `$ ${command}`;

const renderView = (overrides: Partial<ClaudeConfigViewProps> = {}): HTMLElement => {
  const { container } = render(
    <ClaudeConfigView
      state={{ kind: "absent" }}
      binaryPath=""
      onSavePath={jest.fn().mockResolvedValue(null)}
      onClearPath={jest.fn()}
      detect={jest.fn().mockResolvedValue(null)}
      searchedDirs={() => []}
      onClose={jest.fn()}
      {...overrides}
    />
  );
  return container;
};

describe("ClaudeConfigView", () => {
  describe("ClaudeConfigView()", () => {
    it("leads with the binary path and demotes the setup steps below it", () => {
      renderView({ binaryPath: "/usr/local/bin/claude" });

      const input = screen.getByDisplayValue("/usr/local/bin/claude");
      const steps = screen.getByText("Don't have it yet?");
      expect(input.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("numbers installing and signing in as the two steps of the fallback block", () => {
      renderView();

      expect(screen.getByText("Install it")).toBeTruthy();
      expect(screen.getByText("Sign in")).toBeTruthy();
      expect(screen.getByText(commandBlock(CLAUDE_INSTALL_COMMAND))).toBeTruthy();
      expect(screen.getByText(commandBlock(CLAUDE_AUTH_COMMAND))).toBeTruthy();
    });

    it("offers the in-app sign-in beside the command when the backend can run it", () => {
      const onSignIn = jest.fn();
      renderView({ auth: { onSignIn, signingIn: false } });

      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    });

    it("blocks a second sign-in while one is already running", () => {
      renderView({ auth: { onSignIn: jest.fn(), signingIn: true } });

      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Signing in…" }).disabled).toBe(
        true
      );
    });

    it("shows the command alone when Copilot cannot drive the sign-in", () => {
      renderView({ auth: undefined });

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
      expect(screen.getByText(commandBlock(CLAUDE_AUTH_COMMAND))).toBeTruthy();
    });

    it("points an unsupported version at the install command instead of an upgrade button", () => {
      renderView({ state: OUTDATED, binaryPath: "/usr/local/bin/claude" });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Claude 2.1.205 is not supported");
      expect(alert.textContent).toContain("install command below");
      expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    });

    it("shows no warning strip while the CLI is healthy", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        binaryPath: "/usr/local/bin/claude",
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
    });
  });
});
