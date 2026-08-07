jest.mock("@/agentMode/backends/opencode/descriptor", () => ({
  detectOpencodeCliPath: jest.fn().mockResolvedValue(null),
}));

const mockConfirmModals: Array<{
  onConfirm: () => void | Promise<void>;
  content: string;
  open: jest.Mock;
}> = [];
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation((_app, onConfirm, content) => {
    const instance = { onConfirm, content: String(content), open: jest.fn() };
    mockConfirmModals.push(instance);
    return instance;
  }),
}));

import { DEFAULT_SETTINGS } from "@/constants";
import {
  AbortError,
  OperationInFlightError,
  type OpencodeBinaryManager,
  type ProgressEvent,
  type RuntimeState,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { OpencodeConfigContainer } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import { getSettings, settingsAtom, settingsStore } from "@/settings/model";
import type { OpencodeBackendSettings } from "@/settings/model";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App, Notice } from "obsidian";
import React from "react";

// A path computeInstallState's on-disk existence check accepts without stubbing fs.
const EXISTING_BINARY_PATH = __filename;

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

const makeManager = (): {
  manager: OpencodeBinaryManager;
  installCalls: Array<{ signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void }>;
  installDeferred: () => Deferred<{ version: string; path: string }>;
  publish: (state: RuntimeState) => void;
  cancelCurrentOperation: jest.Mock;
  upgradeManaged: jest.Mock;
  upgradeCustomBinary: jest.Mock;
  setCustomBinaryPath: jest.Mock;
  uninstall: jest.Mock;
} => {
  const installCalls: Array<{ signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void }> = [];
  const deferreds: Deferred<{ version: string; path: string }>[] = [];
  const upgradeManaged = jest.fn().mockResolvedValue({ version: "1.16.0", path: "/managed" });
  const upgradeCustomBinary = jest.fn().mockResolvedValue({ version: "1.16.0", path: "/custom" });
  const setCustomBinaryPath = jest.fn().mockResolvedValue(undefined);
  const uninstall = jest.fn().mockResolvedValue(undefined);
  const cancelCurrentOperation = jest.fn();

  // The dialog reads progress off the manager now, so the fake has to be a
  // store: `subscribeRuntimeState`/`getRuntimeState` must keep stable
  // identities or `useSyncExternalStore` resubscribes on every commit.
  let runtime: RuntimeState = { kind: "idle" };
  const listeners = new Set<() => void>();
  const publish = (state: RuntimeState) => {
    runtime = state;
    act(() => listeners.forEach((notify) => notify()));
  };

  const manager = {
    subscribeRuntimeState: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getRuntimeState: () => runtime,
    cancelCurrentOperation,
    install: jest.fn((opts: { signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void }) => {
      installCalls.push(opts);
      publish({ kind: "installing", progress: null });
      return new Promise<{ version: string; path: string }>((resolve, reject) => {
        deferreds.push({ resolve, reject });
      });
    }),
    upgradeManaged,
    upgradeCustomBinary,
    setCustomBinaryPath,
    uninstall,
    downloadsSize: jest.fn().mockResolvedValue(2048),
    getDataDir: jest.fn().mockReturnValue("/home/user/.obsidian-copilot/opencode"),
  } as unknown as OpencodeBinaryManager;
  return {
    manager,
    installCalls,
    installDeferred: () => deferreds[deferreds.length - 1],
    publish,
    cancelCurrentOperation,
    upgradeManaged,
    upgradeCustomBinary,
    setCustomBinaryPath,
    uninstall,
  };
};

const setOpencodeSettings = (opencode: OpencodeBackendSettings | undefined): void => {
  settingsStore.set(settingsAtom, {
    ...DEFAULT_SETTINGS,
    agentMode: {
      ...DEFAULT_SETTINGS.agentMode,
      backends: opencode ? { opencode } : {},
    },
  });
};

const renderContainer = (manager: OpencodeBinaryManager) =>
  render(
    <OpencodeConfigContainer
      manager={manager}
      hostPlatform="darwin"
      hostArch="arm64"
      app={{} as App}
      onClose={jest.fn()}
    />
  );

const noticeMessages = (): string[] =>
  (Notice as unknown as jest.Mock).mock.calls.map((c) => String(c[0]));

describe("OpencodeInstallModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirmModals.length = 0;
    setOpencodeSettings(undefined);
  });

  describe("OpencodeConfigContainer()", () => {
    it("opens on the managed source when nothing was ever configured", () => {
      const { manager } = makeManager();
      renderContainer(manager);

      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
      expect(screen.queryByPlaceholderText("/absolute/path/to/opencode")).toBeNull();
    });

    it("opens on the persisted source and pre-fills the saved custom path", () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.16.0",
        binarySource: "custom",
      });
      const { manager } = makeManager();
      renderContainer(manager);

      const input = screen.getByPlaceholderText<HTMLInputElement>("/absolute/path/to/opencode");
      expect(input.value).toBe(EXISTING_BINARY_PATH);
    });

    it("keeps the persisted binary intact across a managed/custom browse round trip", () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.16.0",
        binarySource: "custom",
      });
      const { manager, setCustomBinaryPath } = makeManager();
      renderContainer(manager);

      fireEvent.click(screen.getByRole("radio", { name: "Managed by Copilot" }));
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();

      fireEvent.click(screen.getByRole("radio", { name: "My own binary" }));
      expect(
        screen.getByPlaceholderText<HTMLInputElement>("/absolute/path/to/opencode").value
      ).toBe(EXISTING_BINARY_PATH);
      expect(setCustomBinaryPath).not.toHaveBeenCalled();
      expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(EXISTING_BINARY_PATH);
    });

    it("translates download progress events into the label and percent it renders", async () => {
      const { manager, publish, installDeferred } = makeManager();
      renderContainer(manager);

      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      expect(screen.getByText("Starting…")).toBeTruthy();

      // Progress arrives through the manager's runtime state now, so the row
      // and this dialog show the same run rather than each tracking its own.
      publish({
        kind: "installing",
        progress: {
          phase: "download",
          received: 300,
          total: 1000,
          assetName: "opencode-darwin-arm64.zip",
        },
      });
      expect(
        screen.getByText("Downloading opencode-darwin-arm64.zip — 300 B / 1000 B (30%)")
      ).toBeTruthy();

      await act(async () => {
        installDeferred().resolve({ version: "1.16.0", path: "/managed/opencode" });
      });
      publish({ kind: "idle" });
      expect(noticeMessages()).toContain("opencode v1.16.0 installed.");
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
    });

    it("cancels through the manager so closing the dialog cannot kill the run", async () => {
      const { manager, cancelCurrentOperation, publish, installDeferred } = makeManager();
      const { unmount } = renderContainer(manager);

      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(cancelCurrentOperation).toHaveBeenCalled();

      await act(async () => {
        installDeferred().reject(new AbortError());
      });
      publish({ kind: "idle" });
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
      expect(screen.queryByText("Aborted")).toBeNull();

      // Unmounting is not a cancellation: the settings row may still be showing
      // this same operation.
      cancelCurrentOperation.mockClear();
      unmount();
      expect(cancelCurrentOperation).not.toHaveBeenCalled();
    });

    it("surfaces an install failure and keeps the retry available", async () => {
      const { manager, publish, installDeferred } = makeManager();
      renderContainer(manager);

      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      await act(async () => {
        installDeferred().reject(new Error("tar exited with 1"));
      });
      publish({ kind: "error", message: "tar exited with 1" });

      expect(screen.getByText("tar exited with 1")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
    });

    it("upgrades an outdated managed binary through the managed re-download", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.15.12",
        binarySource: "managed",
      });
      const { manager, upgradeManaged, upgradeCustomBinary } = makeManager();
      renderContainer(manager);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest" }));
      });

      expect(upgradeManaged).toHaveBeenCalledTimes(1);
      expect(upgradeCustomBinary).not.toHaveBeenCalled();
      expect(noticeMessages()).toContain("opencode upgraded to v1.16.0.");
    });
    it("drops a failed upgrade's reason once an install has replaced the binary", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.15.12",
        binarySource: "managed",
      });
      const { manager, upgradeManaged, installDeferred, publish } = makeManager();
      upgradeManaged.mockRejectedValue(new Error("tar exited with 1"));
      renderContainer(manager);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest" }));
      });
      expect(screen.getByText("tar exited with 1")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Reinstall" }));
      await act(async () => {
        installDeferred().resolve({ version: "1.16.0", path: "/managed" });
      });
      publish({ kind: "idle" });

      // The reason described a binary this install has replaced. It survives a
      // *failed* install on purpose: nothing changed, so it is still true.
      expect(screen.queryByText("tar exited with 1")).toBeNull();
    });

    it("leaves a running install visible when an upgrade loses the race for it", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.15.12",
        binarySource: "managed",
      });
      const { manager, upgradeManaged } = makeManager();
      upgradeManaged.mockRejectedValue(new OperationInFlightError());
      renderContainer(manager);

      // The reinstall takes the lock; the upgrade clicked underneath it never
      // owns the run, so it must not take the run's display with it.
      fireEvent.click(screen.getByRole("button", { name: "Reinstall" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest" }));
      });

      expect(screen.getAllByRole("progressbar")).toHaveLength(1);
      expect(noticeMessages().join(" ")).toContain("already running");
    });

    it("treats a cancelled upgrade as cancelled, not as a failure", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.15.12",
        binarySource: "managed",
      });
      const { manager, upgradeManaged } = makeManager();
      upgradeManaged.mockRejectedValue(new AbortError());
      renderContainer(manager);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest" }));
      });

      // Cancel is the user's own doing; the strip must go back to offering the
      // upgrade rather than reporting "Aborted" as a failure.
      expect(screen.queryByText("Aborted")).toBeNull();
      expect(screen.getByRole("button", { name: "Upgrade to latest" })).toBeTruthy();
    });

    it("drops a failed upgrade's reason once another binary is applied", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.15.12",
        binarySource: "managed",
      });
      const { manager, upgradeManaged } = makeManager();
      upgradeManaged.mockRejectedValue(new Error("GitHub API rate-limited"));
      renderContainer(manager);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest" }));
      });
      expect(screen.getByText("GitHub API rate-limited")).toBeTruthy();

      fireEvent.click(screen.getByRole("radio", { name: "My own binary" }));
      fireEvent.change(screen.getByPlaceholderText("/absolute/path/to/opencode"), {
        target: { value: "/opt/homebrew/bin/opencode" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      // The reason belonged to the managed download, not to the binary now in play.
      expect(screen.queryByText("GitHub API rate-limited")).toBeNull();
    });

    it("upgrades an outdated custom binary through its own upgrade command", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.15.12",
        binarySource: "custom",
      });
      const { manager, upgradeManaged, upgradeCustomBinary } = makeManager();
      renderContainer(manager);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Run opencode upgrade" }));
      });

      expect(upgradeCustomBinary).toHaveBeenCalledTimes(1);
      expect(upgradeManaged).not.toHaveBeenCalled();
    });

    it("persists an applied custom path through the manager and confirms it", async () => {
      const { manager, setCustomBinaryPath } = makeManager();
      renderContainer(manager);

      fireEvent.click(screen.getByRole("radio", { name: "My own binary" }));
      fireEvent.change(screen.getByPlaceholderText("/absolute/path/to/opencode"), {
        target: { value: "/usr/local/bin/opencode" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      expect(setCustomBinaryPath).toHaveBeenCalledWith("/usr/local/bin/opencode");
      expect(noticeMessages()).toContain("Custom opencode binary path saved.");
    });

    it("shows the manager's rejection reason when a custom path fails validation", async () => {
      const { manager, setCustomBinaryPath } = makeManager();
      setCustomBinaryPath.mockRejectedValue(new Error("not executable"));
      renderContainer(manager);

      fireEvent.click(screen.getByRole("radio", { name: "My own binary" }));
      fireEvent.change(screen.getByPlaceholderText("/absolute/path/to/opencode"), {
        target: { value: "/bad/opencode" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      });

      expect(screen.getByText("not executable")).toBeTruthy();
      expect(noticeMessages()).not.toContain("Custom opencode binary path saved.");
    });

    it("clears the persisted custom path through the manager", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.16.0",
        binarySource: "custom",
      });
      const { manager, setCustomBinaryPath } = makeManager();
      renderContainer(manager);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      });

      expect(setCustomBinaryPath).toHaveBeenCalledWith(null);
      expect(noticeMessages()).toContain("Custom opencode path cleared.");
    });

    it("explains a clear that lost the binary-path lock instead of failing silently", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.16.0",
        binarySource: "custom",
      });
      const { manager, setCustomBinaryPath } = makeManager();
      setCustomBinaryPath.mockRejectedValue(new OperationInFlightError());
      renderContainer(manager);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      });

      // The caller awaits this with no catch of its own, so an unreported
      // rejection would leave the button resetting with nothing said.
      expect(noticeMessages().join(" ")).toContain("Couldn't clear the custom path");
      expect(noticeMessages()).not.toContain("Custom opencode path cleared.");
    });

    it("names the operation that won when a download loses the race", async () => {
      const { manager, installDeferred } = makeManager();
      renderContainer(manager);

      fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
      await act(async () => {
        installDeferred().reject(new OperationInFlightError());
      });

      // This is the one failure the shared runtime state cannot render: it
      // belongs to the operation that won, not to this dialog.
      expect(noticeMessages().join(" ")).toContain("already running");
    });

    it("uninstalls only after the size-annotated confirmation is accepted", async () => {
      setOpencodeSettings({
        binaryPath: EXISTING_BINARY_PATH,
        binaryVersion: "1.16.0",
        binarySource: "managed",
      });
      const { manager, uninstall } = makeManager();
      renderContainer(manager);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
      });

      expect(mockConfirmModals).toHaveLength(1);
      expect(mockConfirmModals[0].content).toContain("2.0 KB");
      expect(mockConfirmModals[0].open).toHaveBeenCalledTimes(1);
      expect(uninstall).not.toHaveBeenCalled();

      await act(async () => {
        await mockConfirmModals[0].onConfirm();
      });
      expect(uninstall).toHaveBeenCalledTimes(1);
      expect(noticeMessages()).toContain("opencode uninstalled (freed 2.0 KB).");
    });
  });
});
