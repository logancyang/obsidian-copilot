import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import type { BackendAuthStatus, InstallState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info } from "lucide-react";
import React from "react";

export type ManagedBinarySource = "managed" | "custom";

export type ManagedBinaryRunState =
  | { kind: "idle" }
  | { kind: "running"; label: string; percent?: number }
  | { kind: "error"; message: string };

export interface ManagedBinaryInfo {
  platform: string;
  version: string;
  destination: string;
  run: ManagedBinaryRunState;
  canCancel?: boolean;
  hasDownloads?: boolean;
}

export interface ManagedBinaryConfigActions {
  install: () => void;
  cancelInstall: () => void;
  uninstall: () => void;
  upgrade: () => void;
  saveCustomPath: (path: string) => Promise<string | null>;
  clearCustomPath: () => Promise<void>;
  detectCustomPath: () => Promise<string | null>;
}

export interface ManagedBinaryConfigProps {
  state: InstallState;
  authStatus?: BackendAuthStatus | null;
  source: ManagedBinarySource;
  onSourceChange: (source: ManagedBinarySource) => void;
  activeSource: ManagedBinarySource | null;
  managed: ManagedBinaryInfo;
  customPath: string;
  upgradeRun: ManagedBinaryRunState;
  actions: ManagedBinaryConfigActions;
  onClose: () => void;
  searchedDirs?: () => string[];
}

export interface ManagedBinaryConfigViewProps extends ManagedBinaryConfigProps {
  title: string;
  binaryName: string;
  managedDescription: React.ReactNode;
  customDescription: React.ReactNode;
  customPathPlaceholder: string;
  customPathNotFoundHint: string;
  upgradeLabel: string;
  children?: React.ReactNode;
}

const SOURCE_OPTIONS: SegmentedControlOption<ManagedBinarySource>[] = [
  { label: "Managed by Copilot", value: "managed" },
  { label: "My own binary", value: "custom" },
];

interface ManagedBinaryInstallProps {
  managed: ManagedBinaryInfo;
  installed: boolean;
  actions: ManagedBinaryConfigActions;
}

const ManagedBinaryInstall: React.FC<ManagedBinaryInstallProps> = ({
  managed,
  installed,
  actions,
}) => {
  const { run } = managed;

  if (run.kind === "running") {
    return (
      <div className="tw-flex tw-flex-col tw-gap-2">
        <p className="tw-my-0 tw-text-sm">{run.label}</p>
        <Progress value={run.percent} />
        {/* Configuration operations hold the lock but cannot safely be interrupted.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/379 */}
        {managed.canCancel !== false && (
          <div className="tw-flex tw-justify-end">
            <Button variant="ghost" size="default" onClick={actions.cancelInstall}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <dl className="tw-my-0 tw-grid tw-grid-cols-[max-content_1fr] tw-gap-x-4 tw-gap-y-1 tw-text-sm [&>dd]:tw-ml-0">
        <dt className="tw-text-muted">Platform</dt>
        <dd className="tw-font-mono">{managed.platform}</dd>
        <dt className="tw-text-muted">Version</dt>
        <dd className="tw-font-mono">v{managed.version} (pinned)</dd>
        <dt className="tw-text-muted">Destination</dt>
        <dd className="tw-break-all tw-font-mono">{managed.destination}</dd>
      </dl>
      {run.kind === "error" && (
        <pre className="tw-my-0 tw-max-h-32 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary tw-p-2 tw-text-xs tw-text-error">
          {run.message}
        </pre>
      )}
      <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
        <Button
          variant={installed ? "secondary" : "default"}
          size="default"
          onClick={actions.install}
        >
          {installed
            ? "Reinstall"
            : managed.hasDownloads
              ? "Reinstall & use managed"
              : "Download & install"}
        </Button>
        {(managed.hasDownloads ?? installed) && (
          <Button variant="destructive" size="default" onClick={actions.uninstall}>
            Uninstall
          </Button>
        )}
      </div>
    </div>
  );
};

export const ManagedBinaryConfigView: React.FC<ManagedBinaryConfigViewProps> = ({
  state,
  authStatus,
  source,
  onSourceChange,
  activeSource,
  managed,
  customPath,
  upgradeRun,
  actions,
  onClose,
  title,
  binaryName,
  managedDescription,
  customDescription,
  customPathPlaceholder,
  customPathNotFoundHint,
  searchedDirs,
  upgradeLabel,
  children,
}) => (
  <ConfigDialogShell
    title={title}
    state={state}
    authStatus={authStatus}
    warning={
      <ConfigWarningStrip
        state={state}
        action={
          upgradeRun.kind === "running" ? (
            <>
              <p className="tw-my-0 tw-text-xs">{upgradeRun.label}</p>
              <Progress value={upgradeRun.percent} />
            </>
          ) : (
            <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
              {upgradeRun.kind === "error" && (
                <span className="tw-text-xs tw-text-error">{upgradeRun.message}</span>
              )}
              <Button variant="default" size="sm" onClick={actions.upgrade}>
                {upgradeLabel}
              </Button>
            </div>
          )
        }
      />
    }
    onClose={onClose}
  >
    <ConfigSection>
      <SegmentedControl
        aria-label={`${binaryName} binary source`}
        className={cn("tw-self-start")}
        options={SOURCE_OPTIONS}
        value={source}
        onChange={onSourceChange}
        disabled={managed.run.kind === "running"}
      />
      {activeSource !== null && activeSource !== source ? (
        <div
          role="status"
          className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-3 tw-text-sm"
        >
          <Info aria-hidden className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
          <p className="tw-my-0 tw-text-normal">
            {activeSource === "custom"
              ? managed.hasDownloads
                ? "Your own binary is currently in use. Copilot's managed downloads are still on this computer. Reinstall to switch to Managed by Copilot, or uninstall to free up space."
                : "Your own binary is currently in use. Download and install the managed copy to switch to Managed by Copilot."
              : "The Copilot-managed binary is currently in use. Apply your own binary path below to switch to it."}
          </p>
        </div>
      ) : (
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          {source === "managed" ? managedDescription : customDescription}
        </p>
      )}
      {source === "custom" && (
        <div
          role="note"
          className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-bg-callout-warning/20 tw-p-3 tw-text-sm tw-border-warning/40"
        >
          <AlertTriangle aria-hidden className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning" />
          <p className="tw-my-0 tw-text-normal">
            Copilot is tested with the version managed by Copilot. Other versions may not work
            correctly. We recommend Managed by Copilot.
          </p>
        </div>
      )}
      {source === "managed" ? (
        <>
          <ManagedBinaryInstall
            managed={managed}
            installed={activeSource === "managed"}
            actions={actions}
          />
        </>
      ) : (
        <>
          <BinaryPathSetting
            binaryName={binaryName}
            placeholder={customPathPlaceholder}
            initialPath={customPath}
            notFoundHint={customPathNotFoundHint}
            onSave={actions.saveCustomPath}
            onClear={actions.clearCustomPath}
            persistOnAutoDetect
            detect={actions.detectCustomPath}
            searchedDirs={searchedDirs}
          />
        </>
      )}
    </ConfigSection>
    {children}
  </ConfigDialogShell>
);
