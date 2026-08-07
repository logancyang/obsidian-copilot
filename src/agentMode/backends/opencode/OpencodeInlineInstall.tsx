import { getOpencodeBinaryManager, OpencodeBackendDescriptor } from "./descriptor";
import { phaseLabel, phaseProgress } from "./installProgress";
import { OperationInFlightError } from "./OpencodeBinaryManager";
import {
  OpencodeAbsentInstallView,
  type OpencodeAbsentInstallState,
} from "./ui/OpencodeAbsentInstallView";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import React from "react";

/**
 * Inline install actions for opencode, rendered by the generic backend panel
 * while the binary is absent. opencode is the one backend the plugin can
 * install itself, so this owns the whole first-run path — download, progress,
 * cancel, retry, and adopting an existing binary — and the Configure dialog
 * stays reserved for upgrade, uninstall, and custom paths.
 *
 * The row renders the manager's runtime state and owns none of it. That is what
 * makes it safe for this row to come and go: it unmounts routinely (the panel
 * flips to "ready" on success, and switching agent sub-tabs drops the panel
 * entirely), while a download has to outlive it. Every other entry point that
 * can start a competing operation reads the same state, so whichever surface is
 * on screen shows the one run and offers no rival action.
 */
export const OpencodeAbsentInstallActions: React.FC<{ plugin: CopilotPlugin }> = ({ plugin }) => {
  const manager = React.useMemo(() => getOpencodeBinaryManager(plugin), [plugin]);
  const run = React.useSyncExternalStore(
    manager.subscribeRuntimeState,
    manager.getRuntimeState,
    manager.getRuntimeState
  );

  // The manager already records a failure in its runtime state, where the next
  // row to mount will show it — so a rejection here needs no reporting of its
  // own. `OperationInFlightError` is swallowed entirely: it only means the user
  // reached an action the state says is unavailable.
  const report = (context: string) => (e: unknown) => {
    if (e instanceof OperationInFlightError) return;
    logError(`[AgentMode] ${context}`, e);
  };

  const startInstall = React.useCallback(() => {
    manager
      .install()
      .then(({ version }) => new Notice(`opencode v${version} installed.`))
      .catch(report("inline opencode install failed"));
  }, [manager]);

  const adoptExisting = React.useCallback(() => {
    manager
      .adoptExistingBinary()
      .then((found) => {
        new Notice(
          found
            ? `Using the opencode at ${found}.`
            : "Couldn't find opencode on this device. Use Configure to enter its path."
        );
      })
      .catch(report("adopting an existing opencode failed"));
  }, [manager]);

  const state: OpencodeAbsentInstallState =
    run.kind === "installing"
      ? {
          kind: "installing",
          label: phaseLabel(run.progress),
          percent: phaseProgress(run.progress) ?? 0,
        }
      : // `busy` belongs to operations this row cannot start (upgrade, uninstall,
        // a custom path applied from the dialog). Showing it as a detect keeps
        // both writers off screen without inventing a fifth visual state.
        run.kind === "busy"
        ? { kind: "detecting" }
        : run;

  return (
    <OpencodeAbsentInstallView
      state={state}
      onInstall={startInstall}
      onCancel={() => manager.cancelCurrentOperation()}
      onAdoptExisting={adoptExisting}
      onConfigure={() => OpencodeBackendDescriptor.openInstallUI(plugin)}
    />
  );
};
