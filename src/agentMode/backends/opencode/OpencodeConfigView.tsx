import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ConfigDialogShell";
import type { InstallState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import React from "react";

/** Which of the two setup paths a binary came from. Mirrors the persisted `binarySource`. */
export type OpencodeBinarySource = "managed" | "custom";

/**
 * Display-ready progress of a long-running binary-manager call. The container
 * pre-formats the label and percentage so this view never has to interpret a
 * manager `ProgressEvent`.
 */
export type OpencodeRunState =
  | { kind: "idle" }
  | { kind: "running"; label: string; percent: number }
  | { kind: "error"; message: string };

/** What the managed download would install here, plus any install in flight. */
export interface OpencodeManagedInfo {
  /** Host target the pinned release asset is picked for, e.g. `darwin-arm64`. */
  platform: string;
  /** Pinned opencode version the managed download installs. */
  version: string;
  /** Display-formatted install root. */
  destination: string;
  run: OpencodeRunState;
}

/** Every side effect the dialog can trigger, supplied by the container so the view stays pure. */
export interface OpencodeConfigActions {
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
  /** Look for an opencode binary already present on this machine. */
  detectCustomPath: () => Promise<string | null>;
}

export interface OpencodeConfigViewProps {
  /** Readiness of the configured binary; drives the header badge and the warning strip. */
  state: InstallState;
  /**
   * The setup path currently being viewed. Local view state: switching it shows
   * the other path's controls and persists nothing.
   */
  source: OpencodeBinarySource;
  onSourceChange: (source: OpencodeBinarySource) => void;
  /** Source of the binary actually in use, or null when none is installed. */
  activeSource: OpencodeBinarySource | null;
  managed: OpencodeManagedInfo;
  /** Persisted custom binary path; empty when the active install isn't a custom one. */
  customPath: string;
  /** Progress/error of the in-dialog upgrade offered by the warning strip. */
  upgradeRun: OpencodeRunState;
  actions: OpencodeConfigActions;
  onClose: () => void;
}

const SOURCE_OPTIONS: SegmentedControlOption<OpencodeBinarySource>[] = [
  { label: "Managed by Copilot", value: "managed" },
  { label: "My own binary", value: "custom" },
];

/**
 * The managed-download body: what would be installed where, and the buttons that
 * act on it. Renders the download progress and its Cancel while an install runs.
 */
const OpencodeManagedInstall: React.FC<{
  managed: OpencodeManagedInfo;
  /** Whether the managed copy is the binary in use, which is what turns Install into Reinstall. */
  installed: boolean;
  actions: OpencodeConfigActions;
}> = ({ managed, installed, actions }) => {
  const { run } = managed;

  if (run.kind === "running") {
    return (
      <div className="tw-flex tw-flex-col tw-gap-2">
        <p className="tw-text-sm">{run.label}</p>
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
      <dl className="tw-grid tw-grid-cols-[max-content_1fr] tw-gap-x-4 tw-gap-y-1 tw-text-sm">
        <dt className="tw-text-muted">Platform</dt>
        <dd className="tw-font-mono">{managed.platform}</dd>
        <dt className="tw-text-muted">Version</dt>
        <dd className="tw-font-mono">v{managed.version} (pinned)</dd>
        <dt className="tw-text-muted">Destination</dt>
        <dd className="tw-break-all tw-font-mono tw-text-xs">{managed.destination}</dd>
      </dl>
      {run.kind === "error" && (
        <pre className="tw-max-h-32 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary tw-p-2 tw-text-xs tw-text-error">
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
 * Configure dialog body for the opencode backend. Opens on the one choice that
 * decides everything below it — managed download or your own binary — and shows
 * only the selected path's controls instead of stacking both.
 *
 * Pure props, so the gallery and unit tests can drive every state;
 * `OpencodeInstallModal` supplies the settings reads, binary manager, and notices.
 */
export const OpencodeConfigView: React.FC<OpencodeConfigViewProps> = ({
  state,
  source,
  onSourceChange,
  activeSource,
  managed,
  customPath,
  upgradeRun,
  actions,
  onClose,
}) => (
  <ConfigDialogShell
    title="Configure opencode"
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
                {activeSource === "custom" ? "Run opencode upgrade" : "Upgrade to latest"}
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
        aria-label="opencode binary source"
        options={SOURCE_OPTIONS}
        value={source}
        onChange={onSourceChange}
      />
      {source === "managed" ? (
        <>
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            Let Copilot download and manage the official opencode binary from its GitHub repo.
          </p>
          {activeSource === "custom" && (
            <p className="tw-my-0 tw-text-sm tw-text-muted">
              Your own binary is in use right now — download the managed copy to switch to it.
            </p>
          )}
          <OpencodeManagedInstall
            managed={managed}
            installed={activeSource === "managed"}
            actions={actions}
          />
        </>
      ) : (
        <>
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            Point Agent Mode at a binary you already have on disk. Useful for self-builders or
            air-gapped machines.
          </p>
          {activeSource === "managed" && (
            <p className="tw-my-0 tw-text-sm tw-text-muted">
              The managed binary is in use right now — apply a path here to switch to it.
            </p>
          )}
          <BinaryPathSetting
            binaryName="opencode"
            placeholder="/absolute/path/to/opencode"
            initialPath={customPath}
            notFoundHint="opencode not found. Install it natively (`~/.opencode/bin/opencode[.exe]`), via bun/npm, or paste a custom path manually."
            onSave={actions.saveCustomPath}
            onClear={actions.clearCustomPath}
            persistOnAutoDetect
            detect={actions.detectCustomPath}
          />
        </>
      )}
    </ConfigSection>
  </ConfigDialogShell>
);
