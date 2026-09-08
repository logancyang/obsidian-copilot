import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentBackendHeader } from "./AgentBackendHeader";
import meta, {
  Running,
  Retry,
  Indeterminate,
  SignInRequired,
  CheckingSignIn,
  SignedIn,
} from "./AgentBackendHeader.stories";

describe("AgentBackendHeader", () => {
  describe("AgentBackendHeader()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 shows Ready only after the installed agent is signed in", () => {
      const view = render(<AgentBackendHeader {...meta.args} {...SignInRequired.args} />);
      expect(screen.getByText("Sign in required")).toBeTruthy();
      expect(screen.queryByText("Ready")).toBeNull();
      view.rerender(<AgentBackendHeader {...meta.args} {...CheckingSignIn.args} />);
      expect(screen.getByText("Checking sign-in…")).toBeTruthy();
      view.rerender(<AgentBackendHeader {...meta.args} {...SignedIn.args} />);
      expect(screen.getByText("Ready")).toBeTruthy();
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 shows update, shared progress, and retry in the settings row", () => {
      const onUpdate = jest.fn();
      const view = render(<AgentBackendHeader {...meta.args} onUpdate={onUpdate} />);
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      expect(onUpdate).toHaveBeenCalledTimes(1);
      view.rerender(<AgentBackendHeader {...meta.args} {...Running.args} />);
      expect(screen.getByRole("button", { name: "Upgrading…" }).hasAttribute("disabled")).toBe(
        true
      );
      expect(screen.getByText("Downloading opencode.zip (42%)")).toBeTruthy();
      view.rerender(<AgentBackendHeader {...meta.args} {...Indeterminate.args} />);
      expect(screen.getByText("Downloading opencode.zip")).toBeTruthy();
      expect(screen.queryByText(/0%/)).toBeNull();
      view.rerender(<AgentBackendHeader {...meta.args} {...Retry.args} onUpdate={onUpdate} />);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
