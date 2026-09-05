import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import type { InstallState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import React from "react";

/** Which of the two setup paths a binary came from. Mirrors the persisted `binarySource`. */
export type ManagedBinarySource = "managed" | "custom";

/**
 * Display-ready progress of a long-running binary-manager call. The container
 * pre-formats the label and percentage so this view never has to interpret a
 * manager `ProgressEvent`.
 */
export type ManagedBinaryRunState =
  | { kind: "idle" }
  | { kind: "running"; label: string; percent: number }
  | { kind: "error"; message: string };

/** What the managed download would install here, plus any install in flight. */
export interface ManagedBinaryInfo {
  /** Host target the pinned release asset is picked for, e.g. `darwin-arm64`. */
  platform: string;
  /** Pinned binary version the managed download installs. */
  version: string;
  /** Display-formatted install root. */
  destination: string;
  run: ManagedBinaryRunState;
}

/** Every side effect the dialog can trigger, supplied by the container so the view stays pure. */
export interface ManagedBinaryConfigActions {
  /** Download and install the pinned managed binary; also backs Reinstall. */
  install: () => void;
  /** Abort an install in flight. */
  cancelInstall: () => void;
  /** Reclaim every downloaded managed copy. Owns its own confirmation step. */
  uninstall: () => void;
  /** Upgrade whichever binary is active — the managed download or the user's own. */
  upgrade: () => void;
  /** Validate and persist a user-supplied path. Resolves to an error message, or null on success. */
  saveCustomPath: (path: string) => Promise<string | null>;
  /** Forget the user-supplied path. */
  clearCustomPath: () => Promise<void>;
  /** Look for a binary already present on this machine. */
  detectCustomPath: () => Promise<string | null>;
}

export interface ManagedBinaryConfigViewProps {
  /** Readiness of the configured binary; drives the header badge and the warning strip. */
  state: InstallState;
  /**
   * The setup path currently being viewed. Local view state: switching it shows
   * the other path's controls and persists nothing.
   */
  source: ManagedBinarySource;
  onSourceChange: (source: ManagedBinarySource) => void;
  /** Source of the binary actually in use, or null when none is installed. */
  activeSource: ManagedBinarySource | null;
  managed: ManagedBinaryInfo;
  /** Persisted custom binary path; empty when the active install isn't a custom one. */
  customPath: string;
  /** Progress/error of the in-dialog upgrade offered by the warning strip. */
  upgradeRun: ManagedBinaryRunState;
  actions: ManagedBinaryConfigActions;
  onClose: () => void;
  title: string;
  binaryName: string;
  managedDescription: React.ReactNode;
  customDescription: React.ReactNode;
  customPathPlaceholder: string;
  customPathNotFoundHint: string;
  searchedDirs?: () => string[];
  upgradeLabel: string;
  children?: React.ReactNode;
}

const SOURCE_OPTIONS: SegmentedControlOption<ManagedBinarySource>[] = [
  { label: "Managed by Copilot", value: "managed" },
  { label: "My own binary", value: "custom" },
];

/**
 * The managed-download body: what would be installed where, and the buttons that
 * act on it. Renders the download progress and its Cancel while an install runs.
 */
interface ManagedBinaryInstallProps {
  managed: ManagedBinaryInfo;
  /** Whether the managed copy is the binary in use, which is what turns Install into Reinstall. */
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
        <div className="tw-flex tw-justify-end">
          <Button variant="ghost" size="default" onClick={actions.cancelInstall}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {/* Preflight is off, so the browser's own `dl` margins and 40px `dd` indent
          would survive and push the values out of their grid track. */}
      <dl className="tw-my-0 tw-grid tw-grid-cols-[max-content_1fr] tw-gap-x-4 tw-gap-y-1 tw-text-sm [&>dd]:tw-ml-0">
        <dt className="tw-text-muted">Platform</dt>
        <dd className="tw-font-mono">{managed.platform}</dd>
        <dt className="tw-text-muted">Version</dt>
        <dd className="tw-font-mono">v{managed.version} (pinned)</dd>
        <dt className="tw-text-muted">Destination</dt>
        <dd className="tw-break-all tw-font-mono tw-text-xs">{managed.destination}</dd>
      </dl>
      {run.kind === "error" && (
        <pre className="tw-my-0 tw-max-h-32 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary tw-p-2 tw-text-xs tw-text-error">
          {run.message}
        </pre>
      )}
      <div className="tw-flex tw-justify-end tw-gap-2">
        {installed ? (
          <>
            <Button variant="secondary" size="default" onClick={actions.install}>
              Reinstall
            </Button>
            <Button variant="destructive" size="default" onClick={actions.uninstall}>
              Uninstall
            </Button>
          </>
        ) : (
          <Button variant="default" size="default" onClick={actions.install}>
            Download &amp; install
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * Shared managed/custom configuration body. The selected tab only chooses which
 * controls are visible; containers own installation, path changes, and notices.
 */
export const ManagedBinaryConfigView: React.FC<ManagedBinaryConfigViewProps> = ({
  state,
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
        // Flex items are blockified, which would stretch the control across the
        // band and leave the segments floating in an empty track.
        className={cn("tw-self-start")}
        options={SOURCE_OPTIONS}
        value={source}
        onChange={onSourceChange}
        disabled={managed.run.kind === "running"}
      />
      {source === "managed" ? (
        <>
          <p className="tw-my-0 tw-text-sm tw-text-muted">{managedDescription}</p>
          {activeSource === "custom" && (
            <p className="tw-my-0 tw-text-sm tw-text-muted">
              Your own binary is in use right now — download the managed copy to switch to it.
            </p>
          )}
          <ManagedBinaryInstall
            managed={managed}
            installed={activeSource === "managed"}
            actions={actions}
          />
        </>
      ) : (
        <>
          <p className="tw-my-0 tw-text-sm tw-text-muted">{customDescription}</p>
          {activeSource === "managed" && (
            <p className="tw-my-0 tw-text-sm tw-text-muted">
              The managed binary is in use right now — apply a path here to switch to it.
            </p>
          )}
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
