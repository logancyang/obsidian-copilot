import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  CodexConfigView,
  type CodexConfigActions,
  type CodexConfigViewProps,
  type CodexManagedInfo,
} from "./CodexConfigView";
import { CODEX_BUNDLE_VERSION } from "@/agentMode/backends/codex/cliSetup";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/368";
const MANAGED: CodexManagedInfo = {
  platform: "darwin-arm64",
  version: CODEX_BUNDLE_VERSION,
  destination: "~/.obsidian-copilot/codex",
  run: { kind: "idle" },
};
const makeActions = (): jest.Mocked<CodexConfigActions> => ({
  install: jest.fn(),
  cancelInstall: jest.fn(),
  uninstall: jest.fn(),
  upgrade: jest.fn(),
  saveCustomPath: jest.fn().mockResolvedValue(null),
  clearCustomPath: jest.fn().mockResolvedValue(undefined),
  detectCustomPath: jest.fn().mockResolvedValue(null),
});
const renderView = (overrides: Partial<CodexConfigViewProps> = {}) => {
  const actions = makeActions();
  const onSourceChange = jest.fn();
  const props: CodexConfigViewProps = {
    auth: {
      terminalCommand: "codex-acp cli login",
      onSignOut: () => undefined,
      signingOut: false,
      status: { signedIn: false },
      onSignIn: () => undefined,
      signingIn: false,
      url: null,
    },
    state: { kind: "absent" },
    source: "managed",
    onSourceChange,
    activeSource: null,
    managed: MANAGED,
    customPath: "",
    upgradeRun: { kind: "idle" },
    actions,
    onClose: jest.fn(),
    ...overrides,
  };
  return { ...render(<CodexConfigView {...props} />), props, actions, onSourceChange };
};

describe("CodexConfigView", () => {
  describe("CodexConfigView()", () => {
    it(`uses the same mutually exclusive source tabs as OpenCode without mutating the install: ${ISSUE}`, () => {
      const { actions, onSourceChange, rerender, props } = renderView();
      expect(screen.getByRole("radiogroup", { name: "codex-acp binary source" })).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByText("darwin-arm64")).toBeTruthy();
      expect(screen.getByText(`v${CODEX_BUNDLE_VERSION} (pinned)`)).toBeTruthy();
      expect(screen.getByText("~/.obsidian-copilot/codex")).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "My own binary" }));
      expect(onSourceChange).toHaveBeenCalledWith("custom");
      expect(actions.install).not.toHaveBeenCalled();
      expect(actions.saveCustomPath).not.toHaveBeenCalled();
      rerender(<CodexConfigView {...props} source="custom" />);
      expect(screen.getByRole("textbox")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Download & install" })).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 signs in through the installed adapter without a terminal command", () => {
      const onSignIn = jest.fn();
      renderView({
        state: { kind: "ready", source: "managed" },
        auth: {
          terminalCommand: "codex-acp cli login",
          onSignOut: () => undefined,
          signingOut: false,
          status: { signedIn: false },
          onSignIn,
          signingIn: false,
          url: null,
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in with your browser" }));
      expect(onSignIn).toHaveBeenCalled();
      expect(screen.getByText("Sign in using a terminal instead")).toBeTruthy();
    });

    it("shows an authentication warning without browser instructions until an adapter is ready: https://github.com/Brevilabs/obsidian-copilot-private/issues/379", () => {
      renderView({ source: "custom" });
      expect(screen.getByRole("heading", { name: "Authentication" })).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain(
        "Set up a supported Codex adapter above"
      );
      expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
      expect(screen.queryByText(/existing profile and credentials/)).toBeNull();
    });

    it("offers browser authentication for a user-owned adapter: https://github.com/Brevilabs/obsidian-copilot-private/issues/379", () => {
      const onSignIn = jest.fn();
      renderView({
        source: "custom",
        state: { kind: "ready", source: "custom" },
        auth: {
          terminalCommand: "codex-acp cli login",
          onSignOut: () => undefined,
          signingOut: false,
          status: { signedIn: false },
          signingIn: false,
          url: null,
          onSignIn,
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in with your browser" }));
      expect(onSignIn).toHaveBeenCalledTimes(1);
    });

    it("shows profile status beside Authentication and offers sign-out for https://github.com/Brevilabs/obsidian-copilot-private/issues/379", () => {
      const onSignOut = jest.fn();
      const { props, rerender } = renderView({
        state: { kind: "ready", source: "managed" },
        auth: {
          status: { signedIn: true, label: "ChatGPT" },
          signingIn: false,
          url: null,
          onSignIn: jest.fn(),
          terminalCommand: "codex-acp cli login",
          onSignOut,
          signingOut: false,
        },
      });
      expect(
        screen.getByRole("heading", { name: "Authentication" }).parentElement?.textContent
      ).toBe("AuthenticationSigned in");
      expect(screen.queryByText("Signed in.")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(onSignOut).toHaveBeenCalledTimes(1);
      rerender(<CodexConfigView {...props} auth={{ ...props.auth, signingOut: true }} />);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Signing out…" }).disabled).toBe(
        true
      );
      rerender(<CodexConfigView {...props} auth={{ ...props.auth, failed: true }} />);
      expect(screen.getByText("Sign-out didn't complete. Try again.")).toBeTruthy();
      rerender(
        <CodexConfigView {...props} auth={{ ...props.auth, status: { signedIn: false } }} />
      );
      expect(
        screen.getByRole("heading", { name: "Authentication" }).parentElement?.textContent
      ).toBe("AuthenticationNot signed in");
      expect(screen.getByRole("button", { name: "Sign in with your browser" })).toBeTruthy();
    });

    it(`offers reinstall and uninstall for the active managed copy: ${ISSUE}`, () => {
      const { actions } = renderView({
        state: { kind: "ready", source: "managed" },
        activeSource: "managed",
      });
      fireEvent.click(screen.getByRole("button", { name: "Installation details" }));
      fireEvent.click(screen.getByRole("button", { name: "Reinstall" }));
      fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
      expect(actions.install).toHaveBeenCalledTimes(1);
      expect(actions.uninstall).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it(`shows cancellable progress and keeps failed installs retryable: ${ISSUE}`, () => {
      const { props, actions, rerender } = renderView({
        managed: { ...MANAGED, run: { kind: "running", label: "Installing…", percent: 30 } },
      });
      expect(screen.getByRole("progressbar")).toBeTruthy();
      expect(screen.getByText("Installing…")).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>("radio", { name: "My own binary" }).disabled).toBe(
        true
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(actions.cancelInstall).toHaveBeenCalledTimes(1);
      rerender(
        <CodexConfigView
          {...props}
          managed={{ ...MANAGED, run: { kind: "error", message: "Archive download failed" } }}
        />
      );
      expect(screen.getByText("Archive download failed")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      expect(actions.install).toHaveBeenCalledTimes(1);
    });

    it(`offers an in-dialog update for an incompatible managed adapter: ${ISSUE}`, () => {
      const { actions } = renderView({
        state: {
          kind: "incompatible",
          source: "managed",
          currentVersion: "1.9.0-r1",
          minVersion: CODEX_BUNDLE_VERSION,
          message: "Upgrade required",
        },
        activeSource: "managed",
      });
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      expect(actions.upgrade).toHaveBeenCalledTimes(1);
    });

    it(`shows the existing active source while configuring the other and preserves custom auto-detection: ${ISSUE}`, async () => {
      const { actions } = renderView({
        source: "custom",
        state: { kind: "ready", source: "managed" },
        activeSource: "managed",
      });
      fireEvent.click(screen.getByRole("button", { name: "Installation details" }));
      expect(
        screen.getByText(
          "The Copilot-managed binary is currently in use. Apply your own binary path below to switch to it."
        )
      ).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Auto-detect" }));
      });
      expect(actions.detectCustomPath).toHaveBeenCalledTimes(1);
    });
  });
});
