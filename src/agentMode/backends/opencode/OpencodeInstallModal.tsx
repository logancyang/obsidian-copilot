import {
  OpencodeConfigView,
  type OpencodeBinarySource,
  type OpencodeRunState,
} from "@/agentMode/backends/opencode/ui/OpencodeConfigView";
import {
  AbortError,
  computeInstallState,
  OperationInFlightError,
  toOpencodeInstallState,
  type ProgressEvent,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import type { OpencodeBinaryManager } from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { detectOpencodeCliPath } from "@/agentMode/backends/opencode/descriptor";
import { ReactModal } from "@/components/modals/ReactModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { formatBinaryPathForDisplay } from "@/utils/binaryPath";
import { formatBytes } from "@/utils/formatBytes";
import { OPENCODE_PINNED_VERSION } from "@/agentMode/backends/opencode/ui/opencodeVersion";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { App, Notice } from "obsidian";
import React from "react";

/**
 * Turn a binary-manager progress event into the display-ready running state the
 * view renders. `null` is the moment between starting a call and its first event.
 */
const runningState = (e: ProgressEvent | null): OpencodeRunState => {
  if (!e) return { kind: "running", label: "Starting…", percent: 0 };
  switch (e.phase) {
    case "resolve":
      return { kind: "running", label: e.message, percent: 0 };
    case "download": {
      if (!e.total) {
        return {
          kind: "running",
          label: `Downloading ${e.assetName} — ${formatBytes(e.received)}`,
          percent: 0,
        };
      }
      const percent = Math.min(100, Math.floor((e.received / e.total) * 100));
      return {
        kind: "running",
        label: `Downloading ${e.assetName} — ${formatBytes(e.received)} / ${formatBytes(e.total)} (${percent}%)`,
        percent,
      };
    }
    case "extract":
      return { kind: "running", label: e.message, percent: 98 };
    case "done":
      return { kind: "running", label: "Done", percent: 100 };
  }
};

const errorState = (err: unknown): OpencodeRunState => ({
  kind: "error",
  message: err instanceof Error ? err.message : String(err),
});

/**
 * Stateful half of the opencode Configure dialog: the only place that reads
 * settings, drives the binary manager, owns the install/upgrade progress
 * machines, and raises notices. Everything it computes is handed to
 * {@link OpencodeConfigView} as plain data. Exported so tests can drive the
 * container directly against the settings store and a mocked manager.
 */
export const OpencodeConfigContainer: React.FC<{
  manager: OpencodeBinaryManager;
  hostPlatform: string;
  hostArch: string;
  app: App;
  onClose: () => void;
}> = ({ manager, hostPlatform, hostArch, app, onClose }) => {
  const settings = useSettingsValue();
  const opencode = settings.agentMode?.backends?.opencode;
  const local = computeInstallState(opencode);
  const activeSource = local.kind === "installed" ? local.source : null;
  const customPath = local.kind === "installed" && local.source === "custom" ? local.path : "";

  // Seeded from the persisted source, never written back to it: `binarySource`
  // is owned by install() and setCustomBinaryPath(), so browsing the other setup
  // path leaves the user's configured binary and custom path untouched.
  const [source, setSource] = React.useState<OpencodeBinarySource>(
    opencode?.binarySource ?? "managed"
  );

  // Read from the manager rather than kept here: the dialog is one of several
  // surfaces that can start an install, and closing it must not cancel a run
  // the inline settings row is also showing. Cancel is now explicit only.
  const runtime = React.useSyncExternalStore(
    manager.subscribeRuntimeState,
    manager.getRuntimeState,
    manager.getRuntimeState
  );
  const [upgradeRun, setUpgradeRun] = React.useState<OpencodeRunState>({ kind: "idle" });

  /**
   * Drop the last upgrade's outcome, because the binary it described has just
   * been replaced. Called on the success of every operation that changes which
   * binary is in play — never before one, since an operation that fails leaves
   * that outcome as true as it was, and the strip is the only place it is shown.
   */
  const forgetUpgradeOutcome = React.useCallback(() => setUpgradeRun({ kind: "idle" }), []);
  // DESIGN NOTE — `detecting` and `busy` deliberately map to idle, not to
  // `running`. `running` is the shape this dialog uses for a cancellable
  // download: it replaces the whole managed section with a progress bar and a
  // Cancel. None of the operations behind those two kinds takes a signal
  // (their `runExclusive` bodies declare no parameter), so Cancel would be a
  // control that does nothing. The real harm in the
  // reported case was a Download click that reported nothing; that is fixed
  // where it happens, by surfacing `OperationInFlightError` below, instead of
  // by borrowing a state whose meaning does not fit.
  // If a future review flags this again, point them at this note.
  // Mirrors the manager unconditionally. An earlier attempt let a local
  // `upgradeRun` suppress this so a managed upgrade would not draw two progress
  // bars — but a dialog-local value vetoing a shared run produced four defects
  // in as many review rounds, including hiding an install started from another
  // surface. Showing one run twice is a cosmetic cost; hiding it is not.
  const installRun: OpencodeRunState =
    runtime.kind === "installing"
      ? runningState(runtime.progress)
      : runtime.kind === "error"
        ? { kind: "error", message: runtime.message }
        : { kind: "idle" };

  const install = React.useCallback(() => {
    manager
      .install()
      .then(({ version }) => {
        forgetUpgradeOutcome();
        new Notice(`opencode v${version} installed.`);
      })
      .catch((err: unknown) => {
        // Cancellation is not a failure, and a real failure is already in the
        // manager's runtime state, which this dialog renders.
        if (err instanceof AbortError || (err as Error)?.name === "AbortError") return;
        // Losing the race is the one failure the runtime state cannot show:
        // it belongs to the operation that won, which is rendering its own
        // progress elsewhere. Without this the button would look inert.
        if (err instanceof OperationInFlightError) {
          new Notice(err.message);
          return;
        }
        logError("[AgentMode] opencode install failed", err);
      });
  }, [manager, forgetUpgradeOutcome]);

  const cancelInstall = React.useCallback(() => manager.cancelCurrentOperation(), [manager]);

  // Uninstall fully reclaims opencode: it removes every downloaded copy — all
  // versions under ~/.obsidian-copilot/opencode AND the old pre-migration copy
  // inside the vault — and clears managed settings. The in-vault sweep lets a
  // preview tester move off the synced binary in one click (Uninstall, then
  // Install). The confirm shows the reclaimable size.
  const confirmUninstall = React.useCallback(async (): Promise<void> => {
    const bytes = await manager.downloadsSize().catch(() => 0);
    new ConfirmModal(
      app,
      async () => {
        try {
          await manager.uninstall();
          forgetUpgradeOutcome();
          new Notice(`opencode uninstalled${bytes > 0 ? ` (freed ${formatBytes(bytes)})` : ""}.`);
        } catch (e) {
          logError("[AgentMode] uninstall failed", e);
          new Notice(`Uninstall failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      `Remove all downloaded opencode binaries${bytes > 0 ? ` (${formatBytes(bytes)})` : ""}, ` +
        "including any old copy inside your vault? Your custom binary path and BYOK keys are kept.",
      "Uninstall opencode",
      "Uninstall"
    ).open();
  }, [app, manager, forgetUpgradeOutcome]);

  const upgrade = React.useCallback(() => {
    setUpgradeRun(runningState(null));
    // A user-supplied binary upgrades itself in place; the managed one is
    // re-downloaded at the pinned version. Different calls, same button.
    const action =
      activeSource === "custom"
        ? manager.upgradeCustomBinary()
        : manager.upgradeManaged({ onProgress: (e) => setUpgradeRun(runningState(e)) });
    action
      .then(({ version }) => {
        setUpgradeRun({ kind: "idle" });
        new Notice(`opencode upgraded to v${version}.`);
      })
      .catch((err: unknown) => {
        // Cancelling is the user's own doing, and losing the race means this
        // upgrade never owned the run at all. Either way `upgradeRun` must go
        // back to idle: the section below reads a non-idle value as "an upgrade
        // is showing this run", and would otherwise hide the operation that
        // actually holds the manager.
        if (err instanceof AbortError || (err as Error)?.name === "AbortError") {
          setUpgradeRun({ kind: "idle" });
          return;
        }
        if (err instanceof OperationInFlightError) {
          setUpgradeRun({ kind: "idle" });
          new Notice(err.message);
          return;
        }
        logError("[AgentMode] opencode upgrade failed", err);
        setUpgradeRun(errorState(err));
      });
  }, [manager, activeSource]);

  const saveCustomPath = React.useCallback(
    async (path: string): Promise<string | null> => {
      try {
        await manager.setCustomBinaryPath(path);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      forgetUpgradeOutcome();
      new Notice("Custom opencode binary path saved.");
      return null;
    },
    [manager, forgetUpgradeOutcome]
  );

  const clearCustomPath = React.useCallback(async (): Promise<void> => {
    // The caller (`BinaryPathSetting`) awaits this in a try/finally with no
    // catch, so anything thrown here becomes an unhandled rejection the user
    // never sees — and clearing can now fail, because it takes the same
    // binary-path lock every other write does.
    try {
      await manager.setCustomBinaryPath(null);
    } catch (e) {
      new Notice(`Couldn't clear the custom path: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    forgetUpgradeOutcome();
    new Notice("Custom opencode path cleared.");
  }, [manager, forgetUpgradeOutcome]);

  return (
    <OpencodeConfigView
      state={toOpencodeInstallState(local)}
      source={source}
      onSourceChange={setSource}
      activeSource={activeSource}
      managed={{
        platform: `${hostPlatform}-${hostArch}`,
        version: OPENCODE_PINNED_VERSION,
        destination: formatBinaryPathForDisplay(manager.getDataDir()),
        run: installRun,
      }}
      customPath={customPath}
      upgradeRun={upgradeRun}
      actions={{
        install,
        cancelInstall,
        uninstall: () => void confirmUninstall(),
        upgrade,
        saveCustomPath,
        clearCustomPath,
        detectCustomPath: detectOpencodeCliPath,
      }}
      onClose={onClose}
    />
  );
};

/** Configure dialog for the opencode backend. Opened via `descriptor.openInstallUI`. */
export class OpencodeInstallModal extends ReactModal {
  constructor(
    app: App,
    private readonly manager: OpencodeBinaryManager,
    private readonly hostInfo: { platform: string; arch: string }
  ) {
    super(app, "Configure opencode");
    this.modalEl.addClass("copilot-config-modal");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <OpencodeConfigContainer
        manager={this.manager}
        hostPlatform={this.hostInfo.platform}
        hostArch={this.hostInfo.arch}
        app={this.app}
        onClose={close}
      />
    );
  }
}
