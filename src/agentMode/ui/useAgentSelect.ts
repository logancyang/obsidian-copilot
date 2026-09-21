import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import {
  backendDisplayOrder,
  backendRegistry,
  RECOMMENDED_BACKEND_ID,
} from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId } from "@/agentMode/session/types";
import {
  buildAgentSelectRows,
  resolveAgentSelectCta,
  type AgentSelectCta,
  type AgentSelectRow,
} from "@/agentMode/ui/agentSelectModel";
import {
  useBackendInstallStates,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import { logError } from "@/logger";
import React from "react";
import type CopilotPlugin from "@/main";

/** Everything the agent select view renders and the one action it commits. */
export interface AgentSelectState {
  rows: readonly AgentSelectRow[];
  selectedId: BackendId;
  /** Highlight a different agent. Local only — nothing is persisted until `runCta`. */
  select: (id: BackendId) => void;
  cta: AgentSelectCta;
  /** Start a chat on the selected agent, or open its Configure dialog. */
  runCta: () => void;
}

/**
 * Wire the agent select view to the registry, live install states, and the
 * session manager. Derivation lives in `agentSelectModel`; this hook only owns
 * the transient selection and turns the resolved call to action into an effect.
 * @param plugin - Plugin instance backing readiness subscriptions and Configure dialogs.
 * @param manager - Session manager that commits the choice and spawns the chat.
 */
export function useAgentSelect(
  plugin: CopilotPlugin,
  manager: AgentSessionManager | null | undefined
): AgentSelectState {
  const subscribe = React.useCallback(
    (listener: () => void) => manager?.subscribe(listener) ?? (() => {}),
    [manager]
  );
  const getIsStarting = React.useCallback(() => manager?.getIsStarting() ?? false, [manager]);
  const isStarting = React.useSyncExternalStore(subscribe, getIsStarting, getIsStarting);
  const descriptors = backendDisplayOrder();
  const states = useBackendInstallStates(plugin);
  // Until the user picks a row, the selection follows whichever backend would
  // actually run, so the view opens on the agent the CTA would act upon.
  const sessionBackendId = useSessionBackendDescriptor(manager).id;
  const [pickedId, setPickedId] = React.useState<BackendId | null>(null);
  const selectedId = pickedId ?? sessionBackendId;

  const selectedDescriptor = backendRegistry[selectedId];
  const auth = useBackendAuthState(selectedDescriptor);
  const rows = React.useMemo(
    () =>
      buildAgentSelectRows(descriptors, states, RECOMMENDED_BACKEND_ID).map((row) => {
        // Installation stays authoritative; only an installed selected agent
        // needs its sign-in checked before exposing Start chat.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/532
        if (row.id !== selectedId || row.status !== "installed" || !selectedDescriptor.auth)
          return row;
        if (auth.checking || auth.status === null) return { ...row, status: "checking" as const };
        if (!auth.status.signedIn)
          return {
            ...row,
            status: "signed-out" as const,
            statusMessage: `${row.name} not signed in`,
          };
        return row;
      }),
    [descriptors, states, selectedId, selectedDescriptor.auth, auth.status, auth.checking]
  );
  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0];
  const cta = React.useMemo<AgentSelectCta>(() => {
    const resolved = resolveAgentSelectCta(selectedRow);
    // A pending first launch is shared by scope, so Start could reuse the wrong
    // agent's promise. Configure can remain available while that launch settles.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/532
    if (resolved.action === "start" && isStarting) {
      return {
        action: "wait",
        label: "Starting…",
        note: "Wait for the current agent launch to finish.",
      };
    }
    return resolved;
  }, [selectedRow, isStarting]);

  const runCta = React.useCallback(() => {
    const id = selectedRow.id;
    if (cta.action === "wait") return;
    if (cta.action === "configure") {
      backendRegistry[id].openInstallUI(plugin);
      return;
    }
    // Recheck at click time in case another pane started a launch after render.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/532
    if (!manager || manager.getIsStarting()) return;
    // Persisting the choice is the point: without it the next launch would drop
    // the user back here instead of on the agent they deliberately picked.
    manager.setDefaultBackend(id);
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] agent select start failed", e);
    });
  }, [cta.action, manager, plugin, selectedRow.id]);

  return { rows, selectedId, select: setPickedId, cta, runCta };
}
