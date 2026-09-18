import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentBackendHeader } from "./AgentBackendHeader";
import meta, {
  NotInstalled,
  Running,
  Retry,
  Indeterminate,
  SignInRequired,
  CheckingSignIn,
  SignedIn,
} from "./AgentBackendHeader.stories";

describe("AgentBackendHeader", () => {
  describe("AgentBackendHeader()", () => {
    it.each(["opencode", "Claude", "Codex"])(
      "renders %s through the shared icon, name, path, and Configure props",
      (displayName) => {
        const onConfigure = jest.fn();
        const resolvedPath = `/usr/local/bin/${displayName.toLowerCase()}`;
        render(
          <AgentBackendHeader
            {...meta.args}
            displayName={displayName}
            Icon={() => <svg aria-label={`${displayName} icon`} />}
            resolvedPath={resolvedPath}
            installState={{ kind: "ready", source: "custom" }}
            authStatus={{ signedIn: true }}
            onConfigure={onConfigure}
          />
        );
        expect(screen.getByLabelText(`${displayName} icon`)).toBeTruthy();
        expect(screen.getByText(displayName)).toBeTruthy();
        expect(screen.getByText(resolvedPath)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Configure" }));
        expect(onConfigure).toHaveBeenCalledTimes(1);
      }
    );
    it("opens configuration for an absent binary", () => {
      const onConfigure = jest.fn();
      render(
        <AgentBackendHeader {...meta.args} {...NotInstalled.args} onConfigure={onConfigure} />
      );
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(onConfigure).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Recommended")).toBeNull();
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 shows Ready only after the installed agent is signed in", () => {
      const view = render(<AgentBackendHeader {...meta.args} {...SignInRequired.args} />);
      expect(screen.getByText("Sign in required")).toBeTruthy();
      expect(screen.queryByText("Ready")).toBeNull();
      view.rerender(<AgentBackendHeader {...meta.args} {...CheckingSignIn.args} />);
      expect(screen.getByText("Checking sign-in…")).toBeTruthy();
      view.rerender(<AgentBackendHeader {...meta.args} {...SignedIn.args} />);
      expect(screen.getByText("Ready")).toBeTruthy();
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/480 opens configuration without installing and retains access through progress and failure", () => {
      const onConfigure = jest.fn();
      const view = render(<AgentBackendHeader {...meta.args} onConfigure={onConfigure} />);
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(onConfigure).toHaveBeenCalledTimes(1);
      view.rerender(<AgentBackendHeader {...meta.args} {...Running.args} />);
      expect(screen.getByRole("button", { name: "Configure" }).hasAttribute("disabled")).toBe(
        false
      );
      expect(screen.getByText("Downloading opencode.zip (42%)")).toBeTruthy();
      view.rerender(<AgentBackendHeader {...meta.args} {...Indeterminate.args} />);
      expect(screen.getByText("Downloading opencode.zip")).toBeTruthy();
      expect(screen.queryByText(/0%/)).toBeNull();
      view.rerender(
        <AgentBackendHeader {...meta.args} {...Retry.args} onConfigure={onConfigure} />
      );
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(onConfigure).toHaveBeenCalledTimes(2);
    });
  });
});
