import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompanionSetupView, type CompanionSetupViewProps } from "./CompanionSetupView";

describe("CompanionSetupView", () => {
  describe("CompanionSetupView()", () => {
    const props = (): CompanionSetupViewProps => ({
      displayName: "Grok",
      binaryPath: "",
      busy: false,
      output: "",
      consent: false,
      onInstall: jest.fn(),
      onCheck: jest.fn(),
      onSignIn: jest.fn(),
      onSavePath: jest.fn().mockResolvedValue(undefined),
      onConsent: jest.fn(),
    });
    it("offers install and detection before enabling sign-in", () => {
      const input = props();
      render(<CompanionSetupView {...input} />);
      fireEvent.click(screen.getByRole("button", { name: "Install / update" }));
      expect(input.onInstall).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);
    });
    it("saves the entered path without losing spaces", () => {
      const input = props();
      render(<CompanionSetupView {...input} />);
      fireEvent.change(screen.getByLabelText("CLI path"), {
        target: { value: " C:\\My Agents\\grok.exe " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save path" }));
      expect(input.onSavePath).toHaveBeenCalledWith("C:\\My Agents\\grok.exe");
    });
    it("explains automatic tool execution before Antigravity consent", () => {
      const input = props();
      render(<CompanionSetupView {...input} automaticTools />);
      expect(screen.getByRole("alert").textContent).toContain("cannot ask before each tool");
      fireEvent.click(
        screen.getByRole("button", { name: "Enable automatic tools for this vault" })
      );
      expect(input.onConsent).toHaveBeenCalledTimes(1);
    });
    it("prevents repeated setup operations while an operation runs", () => {
      render(<CompanionSetupView {...props()} busy output="Downloading" />);
      expect(
        screen.getByRole("button", { name: "Install / update" }).hasAttribute("disabled")
      ).toBe(true);
      expect(screen.getAllByRole("status").map((item) => item.textContent)).toEqual([
        "Working…",
        "Downloading",
      ]);
    });
  });
});
