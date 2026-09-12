import type { InstallState } from "@/agentMode/session/types";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigActions,
  type ManagedBinaryConfigViewProps,
  type ManagedBinaryInfo,
} from "./ManagedBinaryConfigView";

const MANAGED: ManagedBinaryInfo = {
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
  "The Copilot-managed binary is currently in use. Apply your own binary path below to switch to it.";
const IN_USE_CUSTOM =
  "Your own binary is currently in use. Download and install the managed copy to switch to Managed by Copilot.";

const makeActions = (): jest.Mocked<ManagedBinaryConfigActions> => ({
  install: jest.fn(),
  cancelInstall: jest.fn(),
  uninstall: jest.fn(),
  upgrade: jest.fn(),
  saveCustomPath: jest.fn().mockResolvedValue(null),
  clearCustomPath: jest.fn().mockResolvedValue(undefined),
  detectCustomPath: jest.fn().mockResolvedValue(null),
});

const renderView = (
  overrides: Partial<ManagedBinaryConfigViewProps> = {}
): {
  actions: jest.Mocked<ManagedBinaryConfigActions>;
  onSourceChange: jest.Mock;
  unmount: () => void;
} => {
  const actions = overrides.actions ?? makeActions();
  const onSourceChange = jest.fn();
  const view = render(
    <ManagedBinaryConfigView
      title="Configure opencode"
      binaryName="opencode"
      managedDescription="Download opencode."
      customDescription="Use your own binary."
      customPathPlaceholder="/absolute/path/to/opencode"
      customPathNotFoundHint="No binary found."
      upgradeLabel={
        overrides.activeSource === "custom" ? "Run opencode upgrade" : "Upgrade to latest"
      }
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
  return {
    actions: actions as jest.Mocked<ManagedBinaryConfigActions>,
    onSourceChange,
    unmount: view.unmount,
  };
};

describe("ManagedBinaryConfigView", () => {
  describe("ManagedBinaryConfigView()", () => {
    it.each<Partial<ManagedBinaryConfigViewProps>>([
      {},
      { state: { kind: "checking", source: "managed" } },
      { state: { kind: "ready", source: "managed" }, authStatus: null },
      { state: { kind: "ready", source: "managed" }, authStatus: { signedIn: false } },
      {
        state: { kind: "ready", source: "managed" },
        managed: { ...MANAGED, run: { kind: "running", label: "Downloading…" } },
      },
      { state: OUTDATED, upgradeRun: { kind: "running", label: "Updating…" } },
    ])(
      "keeps incomplete setup dismissible as Close for %j (https://github.com/Brevilabs/obsidian-copilot-private/issues/407)",
      (overrides) => {
        const onClose = jest.fn();
        const { actions } = renderView({ ...overrides, onClose });
        expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(actions.cancelInstall).not.toHaveBeenCalled();
        expect(actions.uninstall).not.toHaveBeenCalled();
      }
    );

    it.each([undefined, { signedIn: true }])(
      "offers Done for a ready binary with satisfied or unnecessary authentication %j (https://github.com/Brevilabs/obsidian-copilot-private/issues/407)",
      (authStatus) => {
        const onClose = jest.fn();
        renderView({
          state: { kind: "ready", source: "managed" },
          activeSource: "managed",
          authStatus,
          onClose,
        });
        expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(onClose).toHaveBeenCalledTimes(1);
      }
    );

    it("shows Checking during non-cancellable configuration without preventing Close (https://github.com/Brevilabs/obsidian-copilot-private/issues/407)", () => {
      const onClose = jest.fn();
      renderView({
        managed: { ...MANAGED, canCancel: false, run: { kind: "running", label: "Configuring…" } },
        onClose,
      });
      expect(screen.queryByText("Not set up")).toBeNull();
      expect(screen.getByText("Checking…")).toBeTruthy();
      expect(screen.getByText("Configuring…")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("shows Installing instead of a stale readiness badge while keeping upgrade warnings (https://github.com/Brevilabs/obsidian-copilot-private/issues/407)", () => {
      renderView({ state: OUTDATED, upgradeRun: { kind: "running", label: "Updating…" } });
      expect(screen.getByText("Installing…")).toBeTruthy();
      expect(screen.queryByText("Upgrade required")).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain(OUTDATED.message);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/398 discards detection after leaving the custom binary control", async () => {
      let finishDetection!: (path: string) => void;
      const actions = makeActions();
      actions.detectCustomPath.mockReturnValue(
        new Promise((resolve) => {
          finishDetection = resolve;
        })
      );
      const custom = renderView({ source: "custom", actions });
      fireEvent.click(screen.getByRole("button", { name: "Auto-detect" }));
      expect(actions.detectCustomPath).toHaveBeenCalledTimes(1);
      custom.unmount();
      renderView({ source: "managed", actions });
      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      expect(actions.install).toHaveBeenCalledTimes(1);
      await act(async () => {
        finishDetection("/usr/local/bin/opencode");
      });
      expect(actions.saveCustomPath).not.toHaveBeenCalled();
    });
    it("offers the two binary sources as one mutually exclusive choice (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView();

      const group = screen.getByRole("radiogroup", { name: "opencode binary source" });
      const options = screen.getAllByRole("radio");
      expect(group.contains(options[0])).toBe(true);
      expect(options.map((o) => o.textContent)).toEqual(["Managed by Copilot", "My own binary"]);
      expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    });

    it("reports a source switch upward without persisting or destroying anything (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
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

    it("names the active source only when it differs from the source being viewed (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({ source: "managed", activeSource: "custom" });

      expect(screen.getByRole("status").textContent).toBe(IN_USE_CUSTOM);
      expect(screen.queryByText("Download opencode.")).toBeNull();
      expect(screen.queryByText(IN_USE_MANAGED)).toBeNull();
    });

    it("names the managed binary when the custom path is being viewed instead (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({ source: "custom", activeSource: "managed" });

      expect(screen.getByRole("status").textContent).toBe(IN_USE_MANAGED);
      expect(screen.queryByText(IN_USE_CUSTOM)).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 keeps noncancellable configuration progress visible without Cancel", () => {
      renderView({
        managed: {
          ...MANAGED,
          canCancel: false,
          run: { kind: "running", label: "Configuring…", percent: 0 },
        },
      });
      expect(screen.getByText("Configuring…")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.getByRole<HTMLButtonElement>("radio", { name: "My own binary" }).disabled).toBe(
        true
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 removes retained downloads without replacing a custom selection", () => {
      const { actions } = renderView({
        activeSource: "custom",
        managed: { ...MANAGED, hasDownloads: true },
      });
      fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
      expect(actions.uninstall).toHaveBeenCalledTimes(1);
      expect(actions.install).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toContain(
        "Copilot's managed downloads are still on this computer."
      );
      fireEvent.click(screen.getByRole("button", { name: "Reinstall & use managed" }));
      expect(actions.install).toHaveBeenCalledTimes(1);
    });

    it("omits the in-use note when the viewed source is the active one (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({ source: "managed", activeSource: "managed" });

      expect(screen.queryByText(IN_USE_CUSTOM)).toBeNull();
      expect(screen.queryByText(IN_USE_MANAGED)).toBeNull();
    });

    it("omits the in-use note when nothing is installed yet (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({ source: "custom", activeSource: null });

      expect(screen.queryByText(IN_USE_MANAGED)).toBeNull();
      expect(screen.queryByText(IN_USE_CUSTOM)).toBeNull();
    });

    it("shows the download target and a single install action when nothing is managed yet (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      const { actions } = renderView();

      expect(screen.getByText("darwin-arm64")).toBeTruthy();
      expect(screen.getByText("v0.15.6 (pinned)")).toBeTruthy();
      expect(screen.getByText("~/.obsidian-copilot/opencode")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      expect(actions.install).toHaveBeenCalledTimes(1);
    });

    it("swaps the install action for Reinstall and Uninstall once the managed copy is in use (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
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

    it("replaces the managed controls with progress and a Cancel while an install runs (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
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

    it("keeps the source choice disabled while a managed install is running (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
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

    it("surfaces a failed install without hiding the retry (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({ managed: { ...MANAGED, run: { kind: "error", message: "tar exited with 1" } } });

      expect(screen.getByText("tar exited with 1")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
    });

    it.each([null, "managed"] as const)(
      "keeps path detection and Apply available with active source %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/407)",
      async (activeSource) => {
        const { actions } = renderView({ source: "custom", activeSource });

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
      }
    );

    it("offers Clear instead of Apply once a custom path is applied (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", async () => {
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

    it("surfaces the outdated message with an in-dialog upgrade for the managed binary (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      const { actions } = renderView({ state: OUTDATED, activeSource: "managed" });

      expect(screen.getByRole("alert").textContent).toContain("is not supported");
      fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest" }));
      expect(actions.upgrade).toHaveBeenCalledTimes(1);
    });

    it("labels the upgrade as the custom binary's own command when that is the active source (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({ state: { ...OUTDATED, source: "custom" }, activeSource: "custom" });

      expect(screen.getByRole("button", { name: "Run opencode upgrade" })).toBeTruthy();
    });

    it("replaces the upgrade button with its progress while the upgrade runs (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({
        state: OUTDATED,
        activeSource: "managed",
        upgradeRun: { kind: "running", label: "Resolving platform asset…", percent: 0 },
      });

      expect(screen.getByText("Resolving platform asset…")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Upgrade to latest" })).toBeNull();
    });

    it("keeps the upgrade button beside the reason it failed (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({
        state: OUTDATED,
        activeSource: "managed",
        upgradeRun: { kind: "error", message: "GitHub API rate-limited" },
      });

      expect(screen.getByText("GitHub API rate-limited")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Upgrade to latest" })).toBeTruthy();
    });

    it("shows no warning strip while the install state is healthy (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", () => {
      renderView({ state: { kind: "ready", source: "managed" }, activeSource: "managed" });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Ready")).toBeTruthy();
    });
  });
});
