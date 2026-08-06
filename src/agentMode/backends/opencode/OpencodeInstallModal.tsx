import {
  OpencodeConfigView,
  type OpencodeBinarySource,
  type OpencodeRunState,
} from "@/agentMode/backends/opencode/ui/OpencodeConfigView";
import {
  AbortError,
  computeInstallState,
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

  const [installRun, setInstallRun] = React.useState<OpencodeRunState>({ kind: "idle" });
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const install = React.useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setInstallRun(runningState(null));
    manager
      .install({ signal: controller.signal, onProgress: (e) => setInstallRun(runningState(e)) })
      .then(({ version }) => {
        setInstallRun({ kind: "idle" });
        new Notice(`opencode v${version} installed.`);
      })
      .catch((err: unknown) => {
        if (err instanceof AbortError || (err as Error)?.name === "AbortError") {
          setInstallRun({ kind: "idle" });
          return;
        }
        setInstallRun(errorState(err));
      });
  }, [manager]);

  const cancelInstall = React.useCallback(() => abortRef.current?.abort(), []);

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
  }, [app, manager]);

  const [upgradeRun, setUpgradeRun] = React.useState<OpencodeRunState>({ kind: "idle" });
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
      new Notice("Custom opencode binary path saved.");
      return null;
    },
    [manager]
  );

  const clearCustomPath = React.useCallback(async (): Promise<void> => {
    await manager.setCustomBinaryPath(null);
    new Notice("Custom opencode path cleared.");
  }, [manager]);

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
