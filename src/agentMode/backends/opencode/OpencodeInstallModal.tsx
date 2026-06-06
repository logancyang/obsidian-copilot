import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ConfigDialogShell";
import { InstallStatusLine } from "@/agentMode/backends/shared/installStatus";
import {
  AbortError,
  computeInstallState,
  InstallOptions,
  isOpencodeVersionOutdated,
  ProgressEvent,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import type { OpencodeBinaryManager } from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { detectOpencodeCliPath } from "@/agentMode/backends/opencode/descriptor";
import type { InstallState } from "@/agentMode/session/types";
import { ReactModal } from "@/components/modals/ReactModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBinaryPathForDisplay } from "@/utils/binaryPath";
import { OPENCODE_MIN_ACP_VERSION, OPENCODE_PINNED_VERSION } from "@/constants";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { App, Notice } from "obsidian";
import React from "react";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const phaseLabel = (e: ProgressEvent | null): string => {
  if (!e) return "Starting…";
  switch (e.phase) {
    case "resolve":
      return e.message;
    case "download":
      if (e.total) {
        const pct = Math.floor((e.received / e.total) * 100);
        return `Downloading ${e.assetName} — ${formatBytes(e.received)} / ${formatBytes(e.total)} (${pct}%)`;
      }
      return `Downloading ${e.assetName} — ${formatBytes(e.received)}`;
    case "extract":
      return e.message;
    case "done":
      return "Done";
  }
};

const phaseProgress = (e: ProgressEvent | null): number | undefined => {
  if (!e) return undefined;
  if (e.phase === "download" && e.total) {
    return Math.min(100, Math.floor((e.received / e.total) * 100));
  }
  if (e.phase === "extract") return 98;
  if (e.phase === "done") return 100;
  return undefined;
};

type RunState =
  | { kind: "idle" }
  | { kind: "running"; progress: ProgressEvent | null }
  | { kind: "error"; message: string };

type LocalInstallState = ReturnType<typeof computeInstallState>;

/**
 * The managed-download section of the opencode dialog. Owns the
 * download/extract progress sub-state; on success the settings change
 * re-renders the parent (which reads `computeInstallState` via
 * `useSettingsValue`), so it doesn't need to report completion upward.
 */
const OpencodeManagedInstall: React.FC<{
  manager: OpencodeBinaryManager;
  hostPlatform: string;
  hostArch: string;
  local: LocalInstallState;
  app: App;
}> = ({ manager, hostPlatform, hostArch, local, app }) => {
  const [run, setRun] = React.useState<RunState>({ kind: "idle" });
  const abortRef = React.useRef<AbortController | null>(null);

  const startInstall = React.useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ kind: "running", progress: null });
    const opts: InstallOptions = {
      signal: controller.signal,
      onProgress: (e) => setRun({ kind: "running", progress: e }),
    };
    manager
      .install(opts)
      .then(({ version }) => {
        setRun({ kind: "idle" });
        new Notice(`opencode v${version} installed.`);
      })
      .catch((err: unknown) => {
        if (err instanceof AbortError || (err as Error)?.name === "AbortError") {
          setRun({ kind: "idle" });
          return;
        }
        setRun({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  }, [manager]);

  const cancelInstall = React.useCallback(() => abortRef.current?.abort(), []);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  // Uninstall fully reclaims opencode: it removes every downloaded copy — all
  // versions under ~/.obsidian-copilot/opencode AND the old pre-migration copy
  // inside the vault — and clears managed settings. The in-vault sweep lets a
  // preview tester move off the synced binary in one click (Uninstall, then
  // Install). The confirm shows the reclaimable size.
  const handleUninstall = React.useCallback(async () => {
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

  if (run.kind === "running") {
    const pct = phaseProgress(run.progress);
    return (
      <div className="tw-flex tw-flex-col tw-gap-2">
        <p className="tw-text-sm">{phaseLabel(run.progress)}</p>
        <Progress value={pct ?? 0} />
        <div className="tw-flex tw-justify-end">
          <Button variant="ghost" size="default" onClick={cancelInstall}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const isManaged = local.kind === "installed" && local.source === "managed";

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <dl className="tw-grid tw-grid-cols-[max-content_1fr] tw-gap-x-4 tw-gap-y-1 tw-text-sm">
        <dt className="tw-text-muted">Platform</dt>
        <dd className="tw-font-mono">
          {hostPlatform}-{hostArch}
        </dd>
        <dt className="tw-text-muted">Version</dt>
        <dd className="tw-font-mono">v{OPENCODE_PINNED_VERSION} (pinned)</dd>
        <dt className="tw-text-muted">Destination</dt>
        <dd className="tw-break-all tw-font-mono tw-text-xs">
          {formatBinaryPathForDisplay(manager.getDataDir())}
        </dd>
      </dl>
      {run.kind === "error" && (
        <pre className="tw-max-h-32 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary tw-p-2 tw-text-xs tw-text-error">
          {run.message}
        </pre>
      )}
      <div className="tw-flex tw-justify-end tw-gap-2">
        {isManaged ? (
          <>
            <Button variant="secondary" size="default" onClick={startInstall}>
              Reinstall
            </Button>
            <Button variant="destructive" size="default" onClick={handleUninstall}>
              Uninstall
            </Button>
          </>
        ) : (
          <Button variant="default" size="default" onClick={startInstall}>
            Download &amp; install
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * Configure dialog for the opencode backend. Presents the two clearly-separated
 * setup paths: download the managed binary, or point at your own binary on
 * disk. Always accessible so users can switch between them.
 */
const OpencodeConfigBody: React.FC<{
  manager: OpencodeBinaryManager;
  hostPlatform: string;
  hostArch: string;
  app: App;
  onClose: () => void;
}> = ({ manager, hostPlatform, hostArch, app, onClose }) => {
  const settings = useSettingsValue();
  const local = computeInstallState(settings.agentMode?.backends?.opencode);
  // Narrow once so `.path` is reachable; `isCustom`/`customPath` derive from it.
  const customInstall = local.kind === "installed" && local.source === "custom" ? local : null;
  const isCustom = customInstall !== null;
  const customPath = customInstall?.path ?? "";

  const sessionState: InstallState =
    local.kind === "installed" ? { kind: "ready", source: local.source } : { kind: "absent" };
  const detail = local.kind === "installed" ? `opencode v${local.version}` : undefined;

  const installedVersion = local.kind === "installed" ? local.version : null;
  const outdated = !!installedVersion && isOpencodeVersionOutdated(installedVersion);
  const [upgradeRun, setUpgradeRun] = React.useState<RunState>({ kind: "idle" });
  const handleUpgrade = React.useCallback(() => {
    setUpgradeRun({ kind: "running", progress: null });
    const action = isCustom
      ? manager.upgradeCustomBinary()
      : manager.upgradeManaged({
          onProgress: (e) => setUpgradeRun({ kind: "running", progress: e }),
        });
    action
      .then(({ version }) => {
        setUpgradeRun({ kind: "idle" });
        new Notice(`opencode upgraded to v${version}.`);
      })
      .catch((err: unknown) => {
        logError("[AgentMode] opencode upgrade failed", err);
        setUpgradeRun({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  }, [manager, isCustom]);

  const onSaveCustomPath = React.useCallback(
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
    <ConfigDialogShell
      status={<InstallStatusLine state={sessionState} detail={detail} />}
      onClose={onClose}
    >
      {outdated && (
        <div
          className={cn(
            "tw-flex tw-flex-col tw-gap-2 tw-rounded tw-bg-callout-warning/20 tw-p-3",
            "tw-text-sm tw-text-warning"
          )}
          role="alert"
        >
          <span>
            opencode v{installedVersion} is out of date. Update to v{OPENCODE_MIN_ACP_VERSION}+ —
            older versions can&apos;t report their models to the picker.
          </span>
          {upgradeRun.kind === "running" ? (
            <>
              <p className="tw-my-0 tw-text-xs">{phaseLabel(upgradeRun.progress)}</p>
              <Progress value={phaseProgress(upgradeRun.progress) ?? 0} />
            </>
          ) : (
            <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
              {upgradeRun.kind === "error" && (
                <span className="tw-text-xs tw-text-error">{upgradeRun.message}</span>
              )}
              <Button variant="default" size="sm" onClick={handleUpgrade}>
                {isCustom ? "Run opencode upgrade" : "Upgrade to latest"}
              </Button>
            </div>
          )}
        </div>
      )}
      <ConfigSection title="Download managed binary">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Let Copilot download and manage the official opencode binary from its GitHub repo.
        </p>
        {isCustom && (
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            A custom binary is active (below). Download a managed copy to switch.
          </p>
        )}
        <OpencodeManagedInstall
          manager={manager}
          hostPlatform={hostPlatform}
          hostArch={hostArch}
          local={local}
          app={app}
        />
      </ConfigSection>

      <ConfigSection title="Use your own binary">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Point Agent Mode at a binary you already have on disk. Useful for self-builders or
          air-gapped machines.
        </p>
        <BinaryPathSetting
          binaryName="opencode"
          placeholder="/absolute/path/to/opencode"
          initialPath={customPath}
          notFoundHint="opencode not found. Install it natively (`~/.opencode/bin/opencode[.exe]`), via bun/npm, or paste a custom path manually."
          onSave={onSaveCustomPath}
          onClear={clearCustomPath}
          persistOnAutoDetect
          detect={detectOpencodeCliPath}
        />
      </ConfigSection>
    </ConfigDialogShell>
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
      <OpencodeConfigBody
        manager={this.manager}
        hostPlatform={this.hostInfo.platform}
        hostArch={this.hostInfo.arch}
        app={this.app}
        onClose={close}
      />
    );
  }
}
