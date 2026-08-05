import type { InstallState } from "@/agentMode/session/types";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  OpencodeConfigView,
  type OpencodeConfigActions,
  type OpencodeConfigViewProps,
  type OpencodeManagedInfo,
} from "./OpencodeConfigView";

const MANAGED: OpencodeManagedInfo = {
  platform: "darwin-arm64",
  version: "0.15.6",
  destination: "~/.obsidian-copilot/opencode",
  run: { kind: "idle" },
};

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "managed",
  currentVersion: "0.14.2",
  minVersion: "0.15.6",
  message: "opencode v0.14.2 is not supported. Copilot requires opencode v0.15.6 or newer.",
};

const IN_USE_MANAGED =
  "The managed binary is in use right now — apply a path here to switch to it.";
const IN_USE_CUSTOM =
  "Your own binary is in use right now — download the managed copy to switch to it.";

const makeActions = (): jest.Mocked<OpencodeConfigActions> => ({
  install: jest.fn(),
  cancelInstall: jest.fn(),
  uninstall: jest.fn(),
  upgrade: jest.fn(),
  saveCustomPath: jest.fn().mockResolvedValue(null),
  clearCustomPath: jest.fn().mockResolvedValue(undefined),
  detectCustomPath: jest.fn().mockResolvedValue(null),
});

const renderView = (
  overrides: Partial<OpencodeConfigViewProps> = {}
): { actions: jest.Mocked<OpencodeConfigActions>; onSourceChange: jest.Mock } => {
  const actions = overrides.actions ?? makeActions();
  const onSourceChange = jest.fn();
  render(
    <OpencodeConfigView
      state={{ kind: "absent" }}
      source="managed"
      onSourceChange={onSourceChange}
      activeSource={null}
      managed={MANAGED}
      customPath=""
      upgradeRun={{ kind: "idle" }}
      actions={actions}
      onClose={jest.fn()}
      {...overrides}
    />
  );
  return { actions: actions as jest.Mocked<OpencodeConfigActions>, onSourceChange };
};

describe("OpencodeConfigView", () => {
  describe("OpencodeConfigView()", () => {
    it("offers the two binary sources as one mutually exclusive choice", () => {
      renderView();

      const group = screen.getByRole("radiogroup", { name: "opencode binary source" });
      const options = screen.getAllByRole("radio");
      expect(group.contains(options[0])).toBe(true);
      expect(options.map((o) => o.textContent)).toEqual(["Managed by Copilot", "My own binary"]);
      expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    });

    it("reports a source switch upward without persisting or destroying anything", () => {
      const { actions, onSourceChange } = renderView({
        state: { kind: "ready", source: "custom" },
        activeSource: "custom",
        customPath: "/opt/homebrew/bin/opencode",
      });

      fireEvent.click(screen.getByRole("radio", { name: "Managed by Copilot" }));

      expect(onSourceChange).toHaveBeenCalledWith("managed");
      expect(actions.saveCustomPath).not.toHaveBeenCalled();
      expect(actions.clearCustomPath).not.toHaveBeenCalled();
      expect(actions.install).not.toHaveBeenCalled();
      expect(actions.uninstall).not.toHaveBeenCalled();
      expect(actions.upgrade).not.toHaveBeenCalled();
    });

    it("names the active source only when it differs from the source being viewed", () => {
      renderView({ source: "managed", activeSource: "custom" });

      expect(screen.getByText(IN_USE_CUSTOM)).toBeTruthy();
      expect(screen.queryByText(IN_USE_MANAGED)).toBeNull();
    });

    it("names the managed binary when the custom path is being viewed instead", () => {
      renderView({ source: "custom", activeSource: "managed" });

      expect(screen.getByText(IN_USE_MANAGED)).toBeTruthy();
      expect(screen.queryByText(IN_USE_CUSTOM)).toBeNull();
    });

    it("omits the in-use note when the viewed source is the active one", () => {
      renderView({ source: "managed", activeSource: "managed" });

      expect(screen.queryByText(IN_USE_CUSTOM)).toBeNull();
      expect(screen.queryByText(IN_USE_MANAGED)).toBeNull();
    });

    it("omits the in-use note when nothing is installed yet", () => {
      renderView({ source: "custom", activeSource: null });

      expect(screen.queryByText(IN_USE_MANAGED)).toBeNull();
      expect(screen.queryByText(IN_USE_CUSTOM)).toBeNull();
    });

    it("shows the download target and a single install action when nothing is managed yet", () => {
      const { actions } = renderView();

      expect(screen.getByText("darwin-arm64")).toBeTruthy();
      expect(screen.getByText("v0.15.6 (pinned)")).toBeTruthy();
      expect(screen.getByText("~/.obsidian-copilot/opencode")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      expect(actions.install).toHaveBeenCalledTimes(1);
    });

    it("swaps the install action for Reinstall and Uninstall once the managed copy is in use", () => {
      const { actions } = renderView({
        state: { kind: "ready", source: "managed" },
        activeSource: "managed",
      });

      expect(screen.queryByRole("button", { name: "Download & install" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Reinstall" }));
      fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));

      expect(actions.install).toHaveBeenCalledTimes(1);
      expect(actions.uninstall).toHaveBeenCalledTimes(1);
    });

    it("replaces the managed controls with progress and a Cancel while an install runs", () => {
      const { actions } = renderView({
        managed: {
          ...MANAGED,
          run: { kind: "running", label: "Extracting archive…", percent: 98 },
        },
      });

      expect(screen.getByText("Extracting archive…")).toBeTruthy();
      expect(screen.getByRole("progressbar")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Download & install" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(actions.cancelInstall).toHaveBeenCalledTimes(1);
    });

    it("keeps the source choice disabled while a managed install is running", () => {
      const { onSourceChange } = renderView({
        managed: {
          ...MANAGED,
          run: { kind: "running", label: "Extracting archive…", percent: 98 },
        },
      });

      const customSource = screen.getByRole<HTMLButtonElement>("radio", {
        name: "My own binary",
      });
      expect(customSource.disabled).toBe(true);
      fireEvent.click(customSource);
      expect(onSourceChange).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });

    it("surfaces a failed install without hiding the retry", () => {
      renderView({ managed: { ...MANAGED, run: { kind: "error", message: "tar exited with 1" } } });

      expect(screen.getByText("tar exited with 1")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
    });

    it("renders the path field with Auto-detect and Apply when no custom path is set", async () => {
      const { actions } = renderView({ source: "custom" });

      const input = screen.getByPlaceholderText<HTMLInputElement>("/absolute/path/to/opencode");
      expect(input.value).toBe("");
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

      fireEvent.change(input, { target: { value: "/usr/local/bin/opencode" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });
      expect(actions.saveCustomPath).toHaveBeenCalledWith("/usr/local/bin/opencode");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Auto-detect" }));
      });
      expect(actions.detectCustomPath).toHaveBeenCalledTimes(1);
    });

    it("offers Clear instead of Apply once a custom path is applied", async () => {
      const { actions } = renderView({
        source: "custom",
        state: { kind: "ready", source: "custom" },
        activeSource: "custom",
        customPath: "/opt/homebrew/bin/opencode",
      });

      expect(
        screen.getByPlaceholderText<HTMLInputElement>("/absolute/path/to/opencode").value
      ).toBe("/opt/homebrew/bin/opencode");
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      });
      expect(actions.clearCustomPath).toHaveBeenCalledTimes(1);
    });

    it("surfaces the outdated message with an in-dialog upgrade for the managed binary", () => {
      const { actions } = renderView({ state: OUTDATED, activeSource: "managed" });

      expect(screen.getByRole("alert").textContent).toContain("is not supported");
      fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest" }));
      expect(actions.upgrade).toHaveBeenCalledTimes(1);
    });

    it("labels the upgrade as the custom binary's own command when that is the active source", () => {
      renderView({ state: { ...OUTDATED, source: "custom" }, activeSource: "custom" });

      expect(screen.getByRole("button", { name: "Run opencode upgrade" })).toBeTruthy();
    });

    it("replaces the upgrade button with its progress while the upgrade runs", () => {
      renderView({
        state: OUTDATED,
        activeSource: "managed",
        upgradeRun: { kind: "running", label: "Resolving platform asset…", percent: 0 },
      });

      expect(screen.getByText("Resolving platform asset…")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Upgrade to latest" })).toBeNull();
    });

    it("keeps the upgrade button beside the reason it failed", () => {
      renderView({
        state: OUTDATED,
        activeSource: "managed",
        upgradeRun: { kind: "error", message: "GitHub API rate-limited" },
      });

      expect(screen.getByText("GitHub API rate-limited")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Upgrade to latest" })).toBeTruthy();
    });

    it("shows no warning strip while the install state is healthy", () => {
      renderView({ state: { kind: "ready", source: "managed" }, activeSource: "managed" });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
    });
  });
});
