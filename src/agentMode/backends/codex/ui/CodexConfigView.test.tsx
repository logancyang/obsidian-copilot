import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  CodexConfigView,
  type CodexConfigActions,
  type CodexConfigViewProps,
  type CodexManagedInfo,
} from "./CodexConfigView";
import { CODEX_AUTH_COMMAND, CODEX_ACP_PINNED_VERSION } from "@/agentMode/backends/codex/cliSetup";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/368";
const MANAGED: CodexManagedInfo = {
  platform: "darwin-arm64",
  version: CODEX_ACP_PINNED_VERSION,
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
      expect(screen.getByText(`v${CODEX_ACP_PINNED_VERSION} (pinned)`)).toBeTruthy();
      expect(screen.getByText("~/.obsidian-copilot/codex")).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "My own binary" }));
      expect(onSourceChange).toHaveBeenCalledWith("custom");
      expect(actions.install).not.toHaveBeenCalled();
      expect(actions.saveCustomPath).not.toHaveBeenCalled();
      rerender(<CodexConfigView {...props} source="custom" />);
      expect(screen.getByRole("textbox")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Download & install" })).toBeNull();
    });

    it(`keeps sign-in instructions available on either source tab: ${ISSUE}`, () => {
      const { props, rerender } = renderView();
      expect(screen.getByText("Sign in")).toBeTruthy();
      expect(
        screen.getByText(
          (_, el) => el?.tagName === "CODE" && !!el.textContent?.includes(CODEX_AUTH_COMMAND)
        )
      ).toBeTruthy();
      rerender(<CodexConfigView {...props} source="custom" />);
      expect(screen.getByText("Sign in")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    });

    it(`offers reinstall and uninstall for the active managed copy: ${ISSUE}`, () => {
      const { actions } = renderView({
        state: { kind: "ready", source: "managed" },
        activeSource: "managed",
      });
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
          managed={{ ...MANAGED, run: { kind: "error", message: "npm unavailable" } }}
        />
      );
      expect(screen.getByText("npm unavailable")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      expect(actions.install).toHaveBeenCalledTimes(1);
    });

    it(`offers an in-dialog update for an incompatible managed adapter: ${ISSUE}`, () => {
      const { actions } = renderView({
        state: {
          kind: "incompatible",
          source: "managed",
          currentVersion: "1.9.0",
          minVersion: CODEX_ACP_PINNED_VERSION,
          message: "Update required",
        },
        activeSource: "managed",
      });
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
      expect(actions.upgrade).toHaveBeenCalledTimes(1);
    });

    it(`shows the existing active source while configuring the other and preserves custom auto-detection: ${ISSUE}`, async () => {
      const { actions } = renderView({
        source: "custom",
        state: { kind: "ready", source: "managed" },
        activeSource: "managed",
      });
      expect(
        screen.getByText(
          "The managed binary is in use right now — apply a path here to switch to it."
        )
      ).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Auto-detect" }));
      });
      expect(actions.detectCustomPath).toHaveBeenCalledTimes(1);
    });
  });
});
