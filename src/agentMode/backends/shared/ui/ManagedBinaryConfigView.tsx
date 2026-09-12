import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import type { BackendAuthStatus, InstallState } from "@/agentMode/session/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
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
  | { kind: "running"; label: string; percent?: number }
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
  /** Whether this operation supports cancellation. Defaults to true. */
  canCancel?: boolean;
  /** Retained managed files may exist while a custom binary is active. */
  hasDownloads?: boolean;
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

export interface ManagedBinaryConfigProps {
  /** Readiness of the configured binary; drives the header badge and the warning strip. */
  state: InstallState;
  /** Account status for auth-capable agents; null while probing. */
  authStatus?: BackendAuthStatus | null;
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

/**
 * The managed-download body: what would be installed where, and the buttons that
 * act on it. Renders the download progress and its Cancel while an install runs.
 */
interface ManagedBinaryInstallProps {
  managed: ManagedBinaryInfo;
  /** Whether the managed copy is the binary in use, which is what turns Install into Reinstall. */
  installed: boolean;
  /** Switching an existing installation is maintenance, not the next setup step. */
  hasActiveInstallation: boolean;
  actions: ManagedBinaryConfigActions;
}

const ManagedBinaryInstall: React.FC<ManagedBinaryInstallProps> = ({
  managed,
  installed,
  hasActiveInstallation,
  actions,
}) => {
  const { run } = managed;

  // Keep cancellation available while the shared installer owns the operation.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
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
      {/* Preflight is off, so the browser's own `dl` margins and 40px `dd` indent
          would survive and push the values out of their grid track. */}
      <dl className="tw-my-0 tw-grid tw-grid-cols-[max-content_1fr] tw-gap-x-4 tw-gap-y-1 tw-text-sm [&>dd]:tw-ml-0">
        <dt className="tw-text-muted">Platform</dt>
        <dd className="tw-font-mono">{managed.platform}</dd>
        <dt className="tw-text-muted">Version</dt>
        <dd className="tw-font-mono">v{managed.version} (pinned)</dd>
        <dt className="tw-text-muted">Destination</dt>
        <dd className="tw-break-all tw-font-mono">{managed.destination}</dd>
      </dl>
      {/* Failed downloads must leave their explanation beside the retry action.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/368 */}
      {run.kind === "error" && (
        <pre className="tw-my-0 tw-max-h-32 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary tw-p-2 tw-text-xs tw-text-error">
          {run.message}
        </pre>
      )}
      {/* Existing installation actions must not compete with sign-in or Done.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/407 */}
      <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
        <Button
          variant={hasActiveInstallation ? "secondary" : "default"}
          size={hasActiveInstallation ? "sm" : "default"}
          onClick={actions.install}
        >
          {/* Retained downloads are not a first install; switching still runs installation.
              https://github.com/Brevilabs/obsidian-copilot-private/issues/379 */}
          {installed
            ? "Reinstall"
            : managed.hasDownloads
              ? "Reinstall & use managed"
              : "Download & install"}
        </Button>
        {/* Switching to a custom binary must not hide removal of retained downloads.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/379 */}
        {(managed.hasDownloads ?? installed) && (
          <Button variant="secondary" size="sm" onClick={actions.uninstall}>
            Uninstall
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
}) => {
  // Setup cannot imply completion while installation or required sign-in is pending.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/407
  const running = managed.run.kind === "running" || upgradeRun.kind === "running";
  const ready =
    state.kind === "ready" &&
    !running &&
    (authStatus === undefined || authStatus?.signedIn === true);

  return (
    <ConfigDialogShell
      title={title}
      state={state}
      authStatus={authStatus}
      status={
        running ? (
          <Badge variant="outline">
            {managed.run.kind === "running" && managed.canCancel === false
              ? "Checking…"
              : "Installing…"}
          </Badge>
        ) : undefined
      }
      footer={
        <Button variant={ready ? "default" : "secondary"} onClick={onClose}>
          {ready ? "Done" : "Close"}
        </Button>
      }
      warning={
        <ConfigWarningStrip
          state={state}
          // Keep update progress and failures attached to the shared warning.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
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
      <ConfigSection title="Installation management">
        <SegmentedControl
          aria-label={`${binaryName} binary source`}
          // Flex items are blockified, which would stretch the control across the
          // band and leave the segments floating in an empty track.
          className={cn("tw-self-start")}
          options={SOURCE_OPTIONS}
          value={source}
          onChange={onSourceChange}
          // Prevent path edits from competing with the running install.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
          disabled={managed.run.kind === "running"}
        />
        {/* Browsing another setup option must identify the binary still in use until a switch succeeds.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/368 */}
        {activeSource !== null && activeSource !== source ? (
          <div
            role="status"
            className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-3 tw-text-sm"
          >
            <Info aria-hidden className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
            <p className="tw-my-0 tw-text-normal">
              {/* Custom selection leaves managed downloads on disk until explicitly removed.
                https://github.com/Brevilabs/obsidian-copilot-private/issues/379 */}
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
        {source === "managed" ? (
          <>
            <ManagedBinaryInstall
              managed={managed}
              installed={activeSource === "managed"}
              hasActiveInstallation={activeSource !== null}
              actions={actions}
            />
          </>
        ) : (
          <>
            <BinaryPathSetting
              binaryName={binaryName}
              placeholder={customPathPlaceholder}
              initialPath={customPath}
              secondaryActions={activeSource !== null}
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
};
