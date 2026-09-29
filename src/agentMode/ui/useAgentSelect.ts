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

export interface AgentSelectState {
  rows: readonly AgentSelectRow[];
  selectedId: BackendId;
  select: (id: BackendId) => void;
  cta: AgentSelectCta;
  runCta: () => void;
}

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
    if (!manager || manager.getIsStarting()) return;
    manager.setDefaultBackend(id);
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] agent select start failed", e);
    });
  }, [cta.action, manager, plugin, selectedRow.id]);

  return { rows, selectedId, select: setPickedId, cta, runCta };
}
