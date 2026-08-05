import type { InstallState } from "@/agentMode/session/types";
import { render, screen } from "@testing-library/react";
import React from "react";
import { CodexConfigView, type CodexConfigViewProps } from "./CodexConfigView";
import { CODEX_AUTH_COMMAND, CODEX_INSTALL_COMMAND } from "./cliSetup";

const DEFAULT_PROMPT = process.platform === "win32" ? "PS> " : "$ ";

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "0.4.1",
  minVersion: "0.5.0",
  message: "codex-acp 0.4.1 is not supported. Copilot requires 0.5.0 or newer.",
};

/** Match the `<code>` block that renders exactly this command behind the shell prompt. */
const commandBlock =
  (command: string) =>
  (_content: string, element: Element | null): boolean =>
    element?.tagName === "CODE" && element.textContent === `${DEFAULT_PROMPT}${command}`;

const renderView = (overrides: Partial<CodexConfigViewProps> = {}): void => {
  render(
    <CodexConfigView
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

describe("CodexConfigView", () => {
  describe("CodexConfigView()", () => {
    it("leads with the binary path and demotes the setup steps below it", () => {
      renderView({ binaryPath: "/usr/local/bin/codex-acp" });

      const input = screen.getByDisplayValue("/usr/local/bin/codex-acp");
      const steps = screen.getByText("Don't have it yet?");
      expect(input.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("numbers installing and signing in as the two steps of the fallback block", () => {
      renderView();

      expect(screen.getByText("Install it")).toBeTruthy();
      expect(screen.getByText("Sign in")).toBeTruthy();
      expect(screen.getByText(commandBlock(CODEX_INSTALL_COMMAND))).toBeTruthy();
      expect(screen.getByText(commandBlock(CODEX_AUTH_COMMAND))).toBeTruthy();
    });

    it("has no in-app sign-in, because Codex exposes no auth capability", () => {
      renderView();

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("points an unsupported version at the install command instead of an upgrade button", () => {
      renderView({ state: OUTDATED, binaryPath: "/usr/local/bin/codex-acp" });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("codex-acp 0.4.1 is not supported");
      expect(alert.textContent).toContain("install command below");
      expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    });

    it("shows no warning strip while the adapter is healthy", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        binaryPath: "/usr/local/bin/codex-acp",
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
    });
  });
});
