import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { CommandBlock, SetupStep } from "./SetupSteps";

const DEFAULT_PROMPT = process.platform === "win32" ? "PS> " : "$ ";

/** Match the `<code>` block that renders exactly this command behind the shell prompt. */
const commandBlock =
  (command: string, prompt = DEFAULT_PROMPT) =>
  (_content: string, element: Element | null): boolean =>
    element?.tagName === "CODE" && element.textContent === `${prompt}${command}`;

describe("SetupSteps", () => {
  describe("CommandBlock()", () => {
    let writeText: jest.Mock;

    beforeEach(() => {
      writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
    });

    it("shows the command behind a shell prompt so it reads as something to run", () => {
      render(<CommandBlock command="codex login" />);

      expect(screen.getByText(commandBlock("codex login"))).toBeTruthy();
    });

    it("identifies PowerShell commands with a PowerShell prompt", () => {
      render(
        <CommandBlock command="irm https://example.com/install.ps1 | iex" shell="powershell" />
      );

      expect(
        screen.getByText(commandBlock("irm https://example.com/install.ps1 | iex", "PS> "))
      ).toBeTruthy();
    });

    it("copies the command verbatim and confirms in the button's own label", () => {
      jest.useFakeTimers();
      try {
        render(<CommandBlock command="npm install -g @anthropic-ai/claude-code" />);

        fireEvent.click(screen.getByRole("button", { name: "Copy" }));

        expect(writeText).toHaveBeenCalledWith("npm install -g @anthropic-ai/claude-code");
        expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

        act(() => {
          jest.advanceTimersByTime(1400);
        });
        expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
      } finally {
        jest.useRealTimers();
      }
    });

    it("renders an in-app alternative beside Copy when one is supplied", () => {
      const onSignIn = jest.fn();
      render(
        <CommandBlock
          command="claude auth login --claudeai"
          action={
            <button type="button" onClick={onSignIn}>
              Sign in
            </button>
          }
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      expect(onSignIn).toHaveBeenCalledTimes(1);
    });

    it("offers only Copy when no in-app alternative exists", () => {
      render(<CommandBlock command="codex login" />);

      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Copy"]);
    });
  });

  describe("SetupStep()", () => {
    it("labels its body with the step's position and title", () => {
      render(
        <SetupStep index={2} title="Sign in">
          <p>body</p>
        </SetupStep>
      );

      expect(screen.getByText("2")).toBeTruthy();
      expect(screen.getByText("Sign in")).toBeTruthy();
      expect(screen.getByText("body")).toBeTruthy();
    });
  });
});
