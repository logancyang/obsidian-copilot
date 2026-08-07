import type { InstallState } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ClaudeConfigView, type ClaudeConfigViewProps } from "./ClaudeConfigView";
import { CLAUDE_AUTH_COMMAND, CLAUDE_INSTALL_COMMAND } from "@/agentMode/backends/claude/cliSetup";

const DEFAULT_PROMPT = process.platform === "win32" ? "PS> " : "$ ";

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
    element?.tagName === "CODE" && element.textContent === `${DEFAULT_PROMPT}${command}`;

const renderView = (overrides: Partial<ClaudeConfigViewProps> = {}): HTMLElement => {
  const { container } = render(
    <ClaudeConfigView
      state={{ kind: "absent" }}
      binaryPath=""
      hasBinaryPathOverride={false}
      onSavePath={jest.fn().mockResolvedValue(null)}
      onClearPath={jest.fn()}
      detect={jest.fn().mockResolvedValue(null)}
      searchedDirs={() => []}
      auth={{ status: { signedIn: false }, onSignIn: jest.fn(), signingIn: false, url: null }}
      onClose={jest.fn()}
      {...overrides}
    />
  );
  return container;
};

describe("ClaudeConfigView", () => {
  describe("ClaudeConfigView()", () => {
    it("leads with the binary path and demotes the setup steps below it", () => {
      renderView({ binaryPath: "/usr/local/bin/claude", hasBinaryPathOverride: true });

      const input = screen.getByDisplayValue("/usr/local/bin/claude");
      const steps = screen.getByText("Don't have it yet?");
      expect(input.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("shows an auto-detected binary without offering to apply or clear it", () => {
      renderView({
        state: { kind: "ready", source: "managed" },
        binaryPath: "/opt/homebrew/bin/claude",
        hasBinaryPathOverride: false,
      });

      expect(screen.getByDisplayValue("/opt/homebrew/bin/claude")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

      fireEvent.change(screen.getByDisplayValue("/opt/homebrew/bin/claude"), {
        target: { value: "/usr/local/bin/claude" },
      });
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    });

    it("numbers installing and signing in as the two steps of the fallback block", () => {
      renderView();

      expect(screen.getByText("Install it")).toBeTruthy();
      expect(screen.getByText("Sign in", { selector: "div" })).toBeTruthy();
      expect(screen.getByText(commandBlock(CLAUDE_INSTALL_COMMAND))).toBeTruthy();
      expect(screen.getByText(commandBlock(CLAUDE_AUTH_COMMAND))).toBeTruthy();
    });

    it("offers the in-app sign-in beside the command when the backend can run it", () => {
      const onSignIn = jest.fn();
      renderView({
        state: { kind: "ready", source: "custom" },
        auth: { status: { signedIn: false }, onSignIn, signingIn: false, url: null },
      });

      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    });

    it("blocks a second sign-in while one is already running", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        auth: {
          status: { signedIn: false },
          onSignIn: jest.fn(),
          signingIn: true,
          url: null,
        },
      });

      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Signing in…" }).disabled).toBe(
        true
      );
    });

    it("offers the OAuth fallback link when the CLI cannot open a browser", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        auth: {
          status: { signedIn: false },
          onSignIn: jest.fn(),
          signingIn: true,
          url: "https://claude.ai/oauth/authorize?code=example",
        },
      });

      expect(screen.getByRole("link", { name: "Open sign-in page" }).getAttribute("href")).toBe(
        "https://claude.ai/oauth/authorize?code=example"
      );
      expect(screen.queryByRole("button", { name: "Signing in…" })).toBeNull();
    });

    it("hides the in-app sign-in action when the backend is authenticated", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        auth: {
          status: { signedIn: true, label: "zero@example.com" },
          onSignIn: jest.fn(),
          signingIn: false,
          url: null,
        },
      });

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("hides the in-app sign-in action while auth status is still loading", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        auth: { status: null, onSignIn: jest.fn(), signingIn: false, url: null },
      });

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("hides the in-app sign-in action until the Claude binary is ready", () => {
      renderView({
        state: { kind: "absent" },
        auth: {
          status: { signedIn: false },
          onSignIn: jest.fn(),
          signingIn: false,
          url: null,
        },
      });

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("points an unsupported custom binary at its saved path instead of an upgrade button", () => {
      renderView({
        state: OUTDATED,
        binaryPath: "/usr/local/bin/claude",
        hasBinaryPathOverride: true,
      });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Claude 2.1.205 is not supported");
      expect(alert.textContent).toContain("Update the binary at the saved path");
      expect(alert.textContent).toContain("clear the override");
      expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    });

    it("shows no warning strip while the CLI is healthy", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        binaryPath: "/usr/local/bin/claude",
        hasBinaryPathOverride: true,
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
  });
});
