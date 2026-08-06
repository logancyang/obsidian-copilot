import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download } from "lucide-react";
import React from "react";

/** What the row shows, already reduced from install progress to display values. */
export type OpencodeAbsentInstallState =
  | { kind: "idle" }
  | { kind: "detecting" }
  | { kind: "installing"; label: string; percent: number }
  | { kind: "error"; message: string };

/**
 * The row's four actions. Injected rather than reached for so this view stays
 * free of the binary manager and plugin, which is what lets it into the gallery.
 */
export interface OpencodeAbsentInstallActionsProps {
  state: OpencodeAbsentInstallState;
  /** Download and install the pinned release. */
  onInstall: () => void;
  /** Abort a download in progress — the only path that cancels one. */
  onCancel: () => void;
  /** Detect an opencode already on this device and adopt it. */
  onAdoptExisting: () => void;
  /** Open the Configure dialog, where a path can be typed by hand. */
  onConfigure: () => void;
}

/**
 * The actions shown in the opencode settings row while no binary is installed:
 * download, adopt an existing one, live progress with cancel, and the failure
 * state. Purely presentational — the container owns the install lifecycle.
 */
export const OpencodeAbsentInstallView: React.FC<OpencodeAbsentInstallActionsProps> = ({
  state,
  onInstall,
  onCancel,
  onAdoptExisting,
  onConfigure,
}) => {
  if (state.kind === "installing") {
    return (
      <div className="tw-flex tw-w-56 tw-shrink-0 tw-items-center tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1">
          <span className="tw-truncate tw-text-xs tw-text-muted" title={state.label}>
            {state.label}
          </span>
          <Progress value={state.percent} />
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-shrink-0 tw-flex-col tw-items-end tw-gap-1">
      <div className="tw-flex tw-items-center tw-gap-2">
        {/* Both actions write the same backend binary path, so they must not
            race — a detect landing mid-download would flip the row to ready
            under a download the user asked for. The download leads: it is the
            one action a first-run user is meant to take. */}
        <Button
          variant="default"
          size="default"
          onClick={onInstall}
          disabled={state.kind === "detecting"}
        >
          <Download className="tw-size-4" />
          {state.kind === "error" ? "Try again" : "Download opencode"}
        </Button>
        {state.kind === "error" ? (
          // Detection only walks the well-known install locations and PATH, so a
          // binary somewhere else can only be reached by typing its path — and
          // the row hides its usual Configure entry point while absent. Without
          // this the failure message would name a button that isn't on screen.
          <Button variant="ghost" size="default" onClick={onConfigure}>
            Configure
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="default"
            onClick={onAdoptExisting}
            disabled={state.kind === "detecting"}
          >
            {state.kind === "detecting" ? "Looking…" : "I already have it"}
          </Button>
        )}
      </div>
      {state.kind === "error" && (
        <span className="tw-max-w-xs tw-text-right tw-text-xs tw-text-error">{state.message}</span>
      )}
    </div>
  );
};
