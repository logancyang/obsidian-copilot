import {
  detectOpencodeCliPath,
  getOpencodeBinaryManager,
  OpencodeBackendDescriptor,
} from "@/agentMode/backends/opencode/descriptor";
import { phaseLabel, phaseProgress } from "@/agentMode/backends/opencode/installProgress";
import {
  AbortError,
  type ProgressEvent,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import {
  OpencodeAbsentInstallView,
  type OpencodeAbsentInstallState,
} from "@/agentMode/backends/opencode/ui/OpencodeAbsentInstallView";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import React from "react";

/** What the row's action cluster is currently doing. */
type Run =
  | { kind: "idle" }
  | { kind: "detecting" }
  | { kind: "installing"; progress: ProgressEvent | null }
  | { kind: "error"; message: string };

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isAbort = (e: unknown): boolean =>
  e instanceof AbortError || (e as Error | undefined)?.name === "AbortError";

/**
 * Work that persists the opencode binary path, held at module scope rather than
 * in the row that started it.
 *
 * Both members write the same setting: the managed install lands a downloaded
 * binary, and adopting an existing one saves a custom path. Either can outlive
 * the row — this row unmounts routinely, since the panel flips to "ready" on
 * success and switching agent sub-tabs drops the whole panel (`TabContent`
 * renders null when unselected). Parked in component state, that work would
 * either die with the row or keep running invisibly, and a remounted row would
 * offer the *other* writer while the first was still about to land. Whichever
 * settled last would win, leaving settings naming a source the user did not
 * choose last.
 *
 * Holding it here is what makes the row's state a view of the work rather than
 * a private copy of it: the work survives a tab switch, any row can show it,
 * and while it runs no row offers either action.
 */
type InFlightWork =
  | { kind: "installing"; controller: AbortController; progress: ProgressEvent | null }
  | { kind: "detecting" };

let inFlight: InFlightWork | null = null;

/** The `Run` a freshly mounted row should start from. */
const stateOf = (work: InFlightWork | null): Run => {
  if (!work) return { kind: "idle" };
  return work.kind === "installing"
    ? { kind: "installing", progress: work.progress }
    : { kind: "detecting" };
};

/**
 * Every mounted row. The work outlives any one of them, so it cannot hold a
 * `setState` from the row that happened to start it — it publishes here and
 * whichever row is on screen picks it up.
 */
const rows = new Set<(state: Run) => void>();

/**
 * Announce a state to whatever row is mounted. Every transition goes through
 * here, not just progress: a row that mounts mid-download would otherwise never
 * learn the install finished, and would sit on a progress bar whose Cancel
 * button no longer points at anything.
 */
const publish = (state: Run): void => {
  rows.forEach((notify) => notify(state));
};

/** Test seam: no production caller, since a real install always settles. */
export function __resetInFlightInstallForTests(): void {
  inFlight = null;
}

/**
 * Inline install actions for opencode, rendered by the generic backend panel
 * while the binary is absent. opencode is the one backend the plugin can
 * install itself, so this owns the whole first-run path — download, progress,
 * cancel, retry, and adopting an existing binary — and the Configure dialog
 * stays reserved for upgrade, uninstall, and custom paths.
 */
export const OpencodeAbsentInstallActions: React.FC<{ plugin: CopilotPlugin }> = ({ plugin }) => {
  // Adopt an install already running, so returning to this tab shows progress
  // Start from whatever work is already running, so returning to this tab shows
  // it rather than an action that would start a competing one.
  const [run, setRun] = React.useState<Run>(() => stateOf(inFlight));

  React.useEffect(() => {
    // Subscribe unconditionally: this row may start the work itself, or may
    // mount into work already running. Either way it reaches the row here.
    const onWorkState = (state: Run) => setRun(state);
    rows.add(onWorkState);
    return () => {
      rows.delete(onWorkState);
    };
  }, []);

  const startInstall = React.useCallback(() => {
    const task: InFlightWork = {
      kind: "installing",
      controller: new AbortController(),
      progress: null,
    };
    inFlight = task;
    publish({ kind: "installing", progress: null });
    getOpencodeBinaryManager(plugin)
      .install({
        signal: task.controller.signal,
        onProgress: (e) => {
          // Recorded on the task as well as published, so a row that mounts
          // later starts from the current progress rather than zero.
          task.progress = e;
          publish({ kind: "installing", progress: e });
        },
      })
      .then(({ version }) => {
        inFlight = null;
        publish({ kind: "idle" });
        new Notice(`opencode v${version} installed.`);
      })
      .catch((err: unknown) => {
        inFlight = null;
        if (isAbort(err)) {
          publish({ kind: "idle" });
          return;
        }
        logError("[AgentMode] inline opencode install failed", err);
        publish({ kind: "error", message: describeError(err) });
      });
  }, [plugin]);

  // Adopting an existing binary is one detect plus the same validation the
  // Configure dialog runs (file exists, executable, answers `--version`), so a
  // binary that can't actually run is rejected here rather than at ACP boot.
  //
  // Shared rather than row-local even though nothing here is cancellable: the
  // detect ends in `setCustomBinaryPath`, which writes the same setting a
  // managed install does. A row that unmounted mid-detect would leave that
  // write invisible, and the next row would offer Download on top of it.
  const adoptExisting = React.useCallback(() => {
    inFlight = { kind: "detecting" };
    publish({ kind: "detecting" });
    void (async () => {
      try {
        const found = await detectOpencodeCliPath();
        if (!found) {
          inFlight = null;
          publish({
            kind: "error",
            message: "Couldn't find opencode on this device. Use Configure to enter its path.",
          });
          return;
        }
        await getOpencodeBinaryManager(plugin).setCustomBinaryPath(found);
        inFlight = null;
        publish({ kind: "idle" });
        new Notice(`Using the opencode at ${found}.`);
      } catch (e) {
        inFlight = null;
        logError("[AgentMode] adopting an existing opencode failed", e);
        publish({ kind: "error", message: describeError(e) });
      }
    })();
  }, [plugin]);

  const state: OpencodeAbsentInstallState =
    run.kind === "installing"
      ? {
          kind: "installing",
          label: phaseLabel(run.progress),
          percent: phaseProgress(run.progress) ?? 0,
        }
      : run;

  return (
    <OpencodeAbsentInstallView
      state={state}
      onInstall={startInstall}
      onCancel={() => {
        if (inFlight?.kind === "installing") inFlight.controller.abort();
      }}
      onAdoptExisting={adoptExisting}
      onConfigure={() => OpencodeBackendDescriptor.openInstallUI(plugin)}
    />
  );
};
