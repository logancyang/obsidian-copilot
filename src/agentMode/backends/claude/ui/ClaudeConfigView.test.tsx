import type { InstallState } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ClaudeConfigView, type ClaudeConfigViewProps } from "./ClaudeConfigView";
import { CLAUDE_INSTALL_COMMAND } from "@/agentMode/backends/claude/cliSetup";

const CLAUDE_AUTH_COMMAND = "claude auth login --claudeai";
const DEFAULT_PROMPT = process.platform === "win32" ? "PS> " : "$ ";

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "2.1.205",
  minVersion: "2.1.206",
  message: "Claude 2.1.205 is not supported. Copilot requires 2.1.206 or newer.",
};

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
      auth={{
        terminalCommand: "claude auth login --claudeai",
        onSignOut: () => undefined,
        signingOut: false,
        status: { signedIn: false },
        onSignIn: jest.fn(),
        signingIn: false,
        url: null,
      }}
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
      const steps = screen.getByText("Install Claude Code");
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

    it("separates installation and authentication while hiding terminal sign-in until ready: https://github.com/Brevilabs/obsidian-copilot-private/issues/379", () => {
      renderView();
      expect(screen.getByRole("heading", { name: "Install Claude Code" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Authentication" })).toBeTruthy();
      expect(screen.getByText(commandBlock(CLAUDE_INSTALL_COMMAND))).toBeTruthy();
      expect(screen.queryByText(commandBlock(CLAUDE_AUTH_COMMAND))).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 keeps cancellation and Retry outside the copyable command so narrow dialogs can wrap", () => {
      const onCancel = jest.fn();
      const onSignIn = jest.fn();
      renderView({
        state: { kind: "ready", source: "custom" },
        auth: {
          terminalCommand: "claude auth login --claudeai",
          onSignOut: () => undefined,
          signingOut: false,
          status: { signedIn: false },
          onSignIn,
          signingIn: true,
          url: null,
          onCancel,
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(
        screen
          .getByText(commandBlock(CLAUDE_AUTH_COMMAND))
          .parentElement?.contains(screen.getByRole("button", { name: "Cancel sign-in" }))
      ).toBe(false);
    });

    it("points an unsupported custom binary at its saved path instead of an upgrade button", () => {
      renderView({
        state: OUTDATED,
        binaryPath: "/usr/local/bin/claude",
        hasBinaryPathOverride: true,
      });

      const alert = screen.getAllByRole("alert")[0];
      expect(alert.textContent).toContain("Claude 2.1.205 is not supported");
      expect(alert.textContent).toContain("Update the binary at the saved path");
      expect(alert.textContent).toContain("clear the override");
      expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    });

    it("shows sign-in required without an install warning for a healthy signed-out CLI: https://github.com/Brevilabs/obsidian-copilot-private/issues/379", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        binaryPath: "/usr/local/bin/claude",
        hasBinaryPathOverride: true,
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Sign in required")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
  });
});
