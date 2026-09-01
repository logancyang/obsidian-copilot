import { render, screen } from "@testing-library/react";
import React from "react";
import { AntigravityConfigView, type AntigravityConfigViewProps } from "./AntigravityConfigView";
import {
  ANTIGRAVITY_AUTH_COMMAND,
  ANTIGRAVITY_INSTALL_COMMAND,
} from "@/agentMode/backends/antigravity/cliSetup";

const DEFAULT_PROMPT = process.platform === "win32" ? "PS> " : "$ ";

/** Match the `<code>` block that renders exactly this command behind the shell prompt. */
const commandBlock =
  (command: string) =>
  (_content: string, element: Element | null): boolean =>
    element?.tagName === "CODE" && element.textContent === `${DEFAULT_PROMPT}${command}`;

const renderView = (overrides: Partial<AntigravityConfigViewProps> = {}): void => {
  render(
    <AntigravityConfigView
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
};

describe("AntigravityConfigView", () => {
  describe("AntigravityConfigView()", () => {
    it("leads with the binary path and demotes the setup steps below it", () => {
      renderView({ binaryPath: "/usr/local/bin/antigravity-acp" });

      const input = screen.getByDisplayValue("/usr/local/bin/antigravity-acp");
      const steps = screen.getByText("Don't have it yet?");
      expect(input.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("numbers installing and signing in as the two steps of the fallback block", () => {
      renderView();

      expect(screen.getByText("Install it")).toBeTruthy();
      expect(screen.getByText("Sign in")).toBeTruthy();
      expect(screen.getByText(commandBlock(ANTIGRAVITY_INSTALL_COMMAND))).toBeTruthy();
      expect(screen.getByText(commandBlock(ANTIGRAVITY_AUTH_COMMAND))).toBeTruthy();
    });

    it("has no in-app sign-in, because Antigravity inherits auth from agy CLI", () => {
      renderView();

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("shows no warning strip while the adapter is healthy", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        binaryPath: "/usr/local/bin/antigravity-acp",
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
    });
  });
});
