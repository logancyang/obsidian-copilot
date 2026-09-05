import { render, screen } from "@testing-library/react";
import React from "react";
import { CodexConfigView, type CodexConfigViewProps } from "./CodexConfigView";
import { CODEX_AUTH_COMMAND } from "@/agentMode/backends/codex/cliSetup";

const DEFAULT_PROMPT = process.platform === "win32" ? "PS> " : "$ ";

/** Match the `<code>` block that renders exactly this command behind the shell prompt. */
const commandBlock =
  (command: string) =>
  (_content: string, element: Element | null): boolean =>
    element?.tagName === "CODE" && element.textContent === `${DEFAULT_PROMPT}${command}`;

const renderView = (overrides: Partial<CodexConfigViewProps> = {}): void => {
  render(
    <CodexConfigView
      state={{ kind: "absent" }}
      installRun={{ kind: "idle" }}
      onInstall={jest.fn()}
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
      const steps = screen.getByText("Adapter setup");
      expect(input.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("offers the managed adapter before the adapter-owned sign-in", () => {
      renderView();

      expect(screen.getByText("Managed by Copilot")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
      expect(screen.getByText("Sign in")).toBeTruthy();
      expect(screen.getByText(commandBlock(CODEX_AUTH_COMMAND))).toBeTruthy();
    });

    it("has no in-app sign-in, because Codex exposes no auth capability", () => {
      renderView();

      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it("shows no warning strip while the adapter is healthy", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        binaryPath: "/usr/local/bin/codex-acp",
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Switch to managed" })).toBeTruthy();
    });

    it("offers a managed adapter reinstall when the pinned version is already ready", () => {
      renderView({ state: { kind: "ready", source: "managed" } });

      expect(screen.getByRole("button", { name: "Reinstall" })).toBeTruthy();
    });

    it("shares progress and Retry for the managed operation", () => {
      const onInstall = jest.fn();
      const { rerender } = render(
        <CodexConfigView
          state={{ kind: "absent" }}
          installRun={{ kind: "running", label: "Installing…", percent: 30 }}
          onInstall={onInstall}
          binaryPath=""
          onSavePath={jest.fn().mockResolvedValue(null)}
          onClearPath={jest.fn()}
          detect={jest.fn().mockResolvedValue(null)}
          searchedDirs={() => []}
          onClose={jest.fn()}
        />
      );

      expect(screen.getByRole("button", { name: "Installing… 30%" }).hasAttribute("disabled")).toBe(
        true
      );
      rerender(
        <CodexConfigView
          state={{ kind: "absent" }}
          installRun={{ kind: "error", message: "npm unavailable" }}
          onInstall={onInstall}
          binaryPath=""
          onSavePath={jest.fn().mockResolvedValue(null)}
          onClearPath={jest.fn()}
          detect={jest.fn().mockResolvedValue(null)}
          searchedDirs={() => []}
          onClose={jest.fn()}
        />
      );
      screen.getByRole("button", { name: "Retry" }).click();
      expect(screen.getByText("npm unavailable")).toBeTruthy();
      expect(onInstall).toHaveBeenCalledTimes(1);
    });
  });
});
