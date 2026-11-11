import { render, screen } from "@testing-library/react";
import React from "react";
import { AntigravityConfigView, type AntigravityConfigViewProps } from "./AntigravityConfigView";

const PROMPT = process.platform === "win32" ? "PS> " : "$ ";
const SIGN_IN = "/home/me/.local/bin/agy acp --login";

function renderView(overrides: Partial<AntigravityConfigViewProps> = {}): void {
  render(
    <AntigravityConfigView
      state={{ kind: "absent" }}
      binaryPath=""
      hasBinaryPathOverride={false}
      onSavePath={jest.fn().mockResolvedValue(null)}
      onClearPath={jest.fn()}
      detect={jest.fn().mockResolvedValue(null)}
      searchedDirs={() => []}
      signInCommand={null}
      onClose={jest.fn()}
      {...overrides}
    />
  );
}

describe("AntigravityConfigView", () => {
  describe("AntigravityConfigView()", () => {
    it("shows the found agy path and the terminal command that signs in to Google", () => {
      renderView({
        state: { kind: "ready", source: "custom" },
        binaryPath: "/home/me/.local/bin/agy",
        signInCommand: SIGN_IN,
      });

      expect(screen.getByDisplayValue("/home/me/.local/bin/agy")).toBeTruthy();
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName === "CODE" && element.textContent === `${PROMPT}${SIGN_IN}`
        )
      ).toBeTruthy();
    });

    it("asks for the CLI to be set up before offering a sign-in command", () => {
      renderView();

      expect(screen.getByText("Set up the Antigravity CLI above to sign in.")).toBeTruthy();
      expect(screen.queryByText(/acp --login/)).toBeNull();
    });
  });
});
