import type { CodexBinaryManager } from "@/agentMode/backends/codex/CodexBinaryManager";
import {
  CodexConfigContainer,
  CodexInstallModal,
} from "@/agentMode/backends/codex/CodexInstallModal";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
import { ManagedInstallOperationInFlightError } from "@/agentMode/backends/shared/managedInstall";
import type { ManagedInstallActionState } from "@/agentMode/session/types";
import { DEFAULT_SETTINGS } from "@/constants";
import { logError } from "@/logger";
import {
  getSettings,
  settingsAtom,
  settingsStore,
  type CodexBackendSettings,
} from "@/settings/model";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App, Notice } from "obsidian";
import React from "react";

jest.mock("@/context", () => ({ useApp: jest.fn().mockReturnValue({}) }));
jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));
jest.mock("@/agentMode/backends/codex/descriptor", () => ({
  CodexBackendDescriptor: { getInstallState: jest.fn() },
  detectCodexAcpPath: jest.fn().mockResolvedValue(null),
  codexAcpDetectionSearchDirs: () => [],
  getCodexBinaryManager: jest.fn(),
}));

const mockConfirm = jest.fn();
let mockOnConfirm: () => Promise<void>;
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation((_app, confirm, content) => {
    mockOnConfirm = confirm;
    mockConfirm(content);
    return { open: jest.fn() };
  }),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/368";

function setCodexSettings(codex: CodexBackendSettings = {}): void {
  jest
    .mocked(CodexBackendDescriptor.getInstallState)
    .mockReturnValue(
      codex.binaryPath
        ? { kind: "ready", source: codex.binarySource ?? "custom" }
        : { kind: "absent" }
    );
  settingsStore.set(settingsAtom, {
    ...DEFAULT_SETTINGS,
    agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: { codex } },
  });
}

function makeManager() {
  let state: ManagedInstallActionState = { kind: "idle" };
  const runtimeRunning = { kind: "installing", progress: null };
  const listeners = new Set<() => void>();
  const manager = {
    getDataDir: () => "/home/user/.obsidian-copilot/codex",
    getRuntimeState: () => (state.kind === "running" ? runtimeRunning : state),
    getActionState: () => state,
    subscribeRuntimeState: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    install: jest.fn().mockResolvedValue(undefined),
    cancelCurrentOperation: jest.fn(),
    setCustomBinaryPath: jest.fn().mockResolvedValue(undefined),
    uninstall: jest.fn().mockResolvedValue(undefined),
    downloadsSize: jest.fn().mockResolvedValue(2048),
  };
  return {
    manager,
    render: () =>
      render(
        <CodexConfigContainer
          manager={manager as unknown as CodexBinaryManager}
          onClose={jest.fn()}
        />
      ),
    publish: (next: ManagedInstallActionState) =>
      act(() => {
        state = next;
        listeners.forEach((listener) => listener());
      }),
  };
}

describe("CodexInstallModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setCodexSettings();
    jest.mocked(CodexBackendDescriptor.getInstallState).mockReturnValue({ kind: "absent" });
  });

  describe("CodexInstallModal", () => {
    describe("constructor()", () => {
      it("hosts the shared dialog in the native full-bleed modal", () => {
        expect(new CodexInstallModal(new App()).modalEl.className).toBe(
          "modal copilot-modal-full-bleed"
        );
      });
    });
  });

  describe("CodexConfigContainer()", () => {
    it(`defaults new setups to managed and starts the manager's install for ${ISSUE}`, async () => {
      const fixture = makeManager();
      fixture.render();
      expect(screen.queryByRole("textbox")).toBeNull();
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Download & install" }))
      );
      expect(fixture.manager.install).toHaveBeenCalledTimes(1);
    });

    it(`opens existing unannotated paths on custom and preserves them while browsing tabs for ${ISSUE}`, () => {
      setCodexSettings({ binaryPath: "/my/codex-acp" });
      const fixture = makeManager();
      fixture.render();
      expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("/my/codex-acp");
      fireEvent.click(screen.getByRole("radio", { name: "Managed by Copilot" }));
      expect(screen.queryByRole("textbox")).toBeNull();
      fireEvent.click(screen.getByRole("radio", { name: "My own binary" }));
      expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("/my/codex-acp");
      expect(getSettings().agentMode.backends?.codex?.binaryPath).toBe("/my/codex-acp");
      expect(fixture.manager.setCustomBinaryPath).not.toHaveBeenCalled();
    });

    it(`offers a first install when a persisted managed adapter is missing for ${ISSUE}`, () => {
      setCodexSettings({ binaryPath: "/missing/codex-acp", binarySource: "managed" });
      jest.mocked(CodexBackendDescriptor.getInstallState).mockReturnValue({ kind: "absent" });
      makeManager().render();
      expect(screen.getByRole("button", { name: "Download & install" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Reinstall" })).toBeNull();
    });

    it(`saves and clears custom paths through the shared manager for ${ISSUE}`, async () => {
      setCodexSettings({ binaryPath: "/my/codex-acp", binarySource: "custom" });
      const fixture = makeManager();
      fixture.render();
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "/new/codex-acp" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
      expect(fixture.manager.setCustomBinaryPath).toHaveBeenCalledWith("/new/codex-acp");
      act(() => setCodexSettings({ binaryPath: "/new/codex-acp", binarySource: "custom" }));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear" })));
      expect(fixture.manager.setCustomBinaryPath).toHaveBeenCalledWith(null);
    });

    it(`shows validation and clear failures without claiming a path change for ${ISSUE}`, async () => {
      setCodexSettings({ binaryPath: "/my/codex-acp", binarySource: "custom" });
      const fixture = makeManager();
      fixture.manager.setCustomBinaryPath.mockRejectedValue(new Error("invalid adapter"));
      fixture.render();
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "/bad/codex-acp" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
      expect(screen.getByText("invalid adapter")).toBeTruthy();
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "/my/codex-acp" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear" })));
      expect(Notice).toHaveBeenCalledWith("Couldn't clear the custom path: invalid adapter");
    });

    it(`reopens an active managed install with progress and Cancel while a custom adapter remains selected for ${ISSUE}`, () => {
      setCodexSettings({ binaryPath: "/my/codex-acp", binarySource: "custom" });
      const fixture = makeManager();
      const view = fixture.render();
      fixture.publish({ kind: "running", label: "Installing package", percent: 30 });
      expect(screen.getByText("Installing package")).toBeTruthy();
      view.unmount();
      fixture.render();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByText("Installing package")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(fixture.manager.cancelCurrentOperation).toHaveBeenCalledTimes(1);
      expect(getSettings().agentMode.backends?.codex?.binaryPath).toBe("/my/codex-acp");
    });

    it(`subscribes to installs started elsewhere and only cancels explicitly for ${ISSUE}`, () => {
      const fixture = makeManager();
      const { unmount } = fixture.render();
      fixture.publish({ kind: "running", label: "Installing package", percent: 30 });
      expect(screen.getByRole("progressbar")).toBeTruthy();
      expect(screen.getByText("Installing package")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(fixture.manager.cancelCurrentOperation).toHaveBeenCalledTimes(1);
      unmount();
      expect(fixture.manager.cancelCurrentOperation).toHaveBeenCalledTimes(1);
    });

    it.each([
      [new Error("Archive download failed"), true, false],
      [Object.assign(new Error("cancelled"), { name: "AbortError" }), false, false],
      [new ManagedInstallOperationInFlightError("Codex adapter"), true, true],
    ])(
      `reports install failures and competing operations but treats cancellation as intentional for ${ISSUE}: %s`,
      async (error, logged, noticed) => {
        const fixture = makeManager();
        fixture.manager.install.mockRejectedValue(error);
        fixture.render();
        await act(async () =>
          fireEvent.click(screen.getByRole("button", { name: "Download & install" }))
        );
        expect(jest.mocked(logError).mock.calls.length > 0).toBe(logged);
        expect(jest.mocked(Notice).mock.calls.length > 0).toBe(noticed);
      }
    );

    it(`uses the same install action for a managed update for ${ISSUE}`, async () => {
      setCodexSettings({ binaryPath: "/managed/codex-acp", binarySource: "managed" });
      jest.mocked(CodexBackendDescriptor.getInstallState).mockReturnValue({
        kind: "incompatible",
        source: "managed",
        message: "Update required",
        currentVersion: "1.9.0-r1",
        minVersion: "1.10.0-r1",
      });
      const fixture = makeManager();
      fixture.render();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Update" })));
      expect(fixture.manager.install).toHaveBeenCalledTimes(1);
    });

    it(`requires the size-annotated uninstall confirmation before removing managed copies for ${ISSUE}`, async () => {
      setCodexSettings({ binaryPath: "/managed/codex-acp", binarySource: "managed" });
      const fixture = makeManager();
      fixture.render();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Uninstall" })));
      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining("2.0 KB"));
      expect(fixture.manager.uninstall).not.toHaveBeenCalled();
      await act(async () => mockOnConfirm());
      expect(fixture.manager.uninstall).toHaveBeenCalledTimes(1);
    });

    it(`reports uninstall failures to the user for ${ISSUE}`, async () => {
      setCodexSettings({ binaryPath: "/managed/codex-acp", binarySource: "managed" });
      const fixture = makeManager();
      fixture.manager.uninstall.mockRejectedValue(new Error("permission denied"));
      fixture.render();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Uninstall" })));
      await act(async () => mockOnConfirm());
      expect(Notice).toHaveBeenCalledWith(
        "Couldn't uninstall the Codex adapter: permission denied"
      );
    });

    it(`reports a downloads inspection failure before offering uninstall for ${ISSUE}`, async () => {
      setCodexSettings({ binaryPath: "/managed/codex-acp", binarySource: "managed" });
      const fixture = makeManager();
      fixture.manager.downloadsSize.mockRejectedValue(new Error("unreadable directory"));
      fixture.render();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Uninstall" })));
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Couldn't inspect Codex downloads: unreadable directory");
    });
  });
});
