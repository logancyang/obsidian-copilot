import type { ClientView } from "@/agentMode/protocol/ClientView";
import {
  baseModelIdOf,
  buildEffortSibling,
  buildPickerEntries,
  type PickerActiveSession,
} from "@/agentMode/protocol/pickerEntries";
import { useClientView } from "@/agentMode/protocol/react";
import { selectVisibleMessages } from "@/agentMode/protocol/selectors";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { BackendSummary, PickerModel, SessionState } from "@/agentMode/protocol/state";
import type { ModelState } from "@/agentMode/session/types";
import { useAgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import {
  buildEffortOptionsByModelKey,
  reportSwitchFailure,
  toModelSelectorEntry,
  type PickerEffortOptions,
} from "@/agentMode/ui/agentModelPickerHelpers";
import { useSessionSlice } from "@/agentMode/ui/hooks/useSessionSlice";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel } from "@/lib/model-key";
import { logError } from "@/logger";
import { Notice } from "obsidian";
import { useMemo } from "react";

export interface AgentModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
  effort?: {
    options: PickerEffortOptions;
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  };
  effortOptionsByModelKey?: Record<string, PickerEffortOptions>;
  commitSelection?: (modelKey: string, effort: string | null) => void;
}

interface ActiveSessionSlice {
  modelState: ModelState | null;
  hasHistory: boolean;
}

const selectActiveSlice = (session: SessionState): ActiveSessionSlice => ({
  modelState: session.backendState?.model ?? null,
  hasHistory: selectVisibleMessages(session).length > 0,
});

const sameSlice = (a: ActiveSessionSlice, b: ActiveSessionSlice): boolean =>
  a.modelState === b.modelState && a.hasHistory === b.hasHistory;

const keyOf = (model: PickerModel): string => getModelKeyFromModel(toModelSelectorEntry(model));

/**
 * The agent, model and effort choices for the composer, drawn from the host's picker catalog and
 * this client's own active session, and applied through commands. Returns null until the client
 * has the host's state.
 *
 * A pick on another agent replaces the shown session with one on that agent (or creates one when
 * none is shown), and the desktop then remembers that agent as its default. Both happen in this
 * client: the host applies the pick and never changes settings.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function useAgentModelPicker(
  client: SessionClient,
  view: ClientView
): AgentModelPickerOverride | null {
  const { host, activeTab } = useClientView(client, view);
  const persist = useAgentPaneCapabilities().persistDefaults;
  const slice = useSessionSlice(client, activeTab?.id ?? null, selectActiveSlice, sameSlice);

  return useMemo(() => {
    if (!host) return null;
    const { backends } = host;
    const active: PickerActiveSession | null =
      activeTab && slice
        ? {
            backendId: activeTab.backendId,
            hasHistory: slice.hasHistory,
            modelState: slice.modelState,
          }
        : null;
    const { entries, selected } = buildPickerEntries(backends, active);
    const entryByKey = new Map(entries.map((entry) => [keyOf(entry), entry]));

    const crossBackend = (target: BackendSummary, baseModelId: string, effort: string | null) => {
      void (async () => {
        const projectId = activeTab?.projectId ?? view.getProjectScope();
        const result = activeTab
          ? await client.command({
              name: "applySelection",
              sessionId: activeTab.id,
              backendId: target.id,
              baseModelId,
              effort,
            })
          : await client.command({
              name: "createSession",
              backendId: target.id,
              projectId,
              seedSelection: { baseModelId, effort },
            });
        if (!result.ok) {
          logError(`[AgentMode] cross-backend pick failed (${result.code}): ${result.message}`);
          new Notice(`Failed to start ${target.displayName}. See console for details.`);
          return;
        }
        view.activate({ id: result.value.sessionId, projectId });
        persist?.setDefaultBackend(target.id);
      })();
    };

    const sameBackend = (baseModelId: string, effort?: string | null) => {
      if (!activeTab) return;
      void (async () => {
        const result = await client.command({
          name: "applySelection",
          sessionId: activeTab.id,
          backendId: activeTab.backendId,
          baseModelId,
          ...(effort !== undefined ? { effort } : {}),
        });
        if (!result.ok) reportSwitchFailure(result, "model");
      })();
    };

    const resolve = (entry: PickerModel) => {
      const target = backends.find((backend) => backend.id === entry.backendId);
      if (!entry.backendId || !target) {
        logError("[AgentMode] picker entry references unknown backend", entry.backendId);
        return null;
      }
      return { target, backendId: entry.backendId, baseModelId: baseModelIdOf(entry) };
    };

    const onChange = (modelKey: string): void => {
      const entry = entryByKey.get(modelKey);
      if (!entry) return;
      const resolved = resolve(entry);
      if (!resolved) return;
      if (!resolved.baseModelId) {
        new Notice("Could not resolve a model id for this selection.");
        return;
      }
      if (!activeTab || activeTab.backendId !== resolved.backendId) {
        crossBackend(
          resolved.target,
          resolved.baseModelId,
          resolved.target.defaultSelection?.effort ?? null
        );
        return;
      }
      persist?.setDefaultBackend(resolved.backendId);
      if (activeTab.canSwitchModel === false) {
        new Notice("This agent doesn't support runtime model switching.");
        return;
      }
      sameBackend(resolved.baseModelId);
    };

    const commitSelection = (modelKey: string, effort: string | null): void => {
      const entry = entryByKey.get(modelKey);
      if (!entry) return;
      if (!baseModelIdOf(entry) || !entry.backendId) {
        onChange(modelKey);
        return;
      }
      const resolved = resolve(entry);
      if (!resolved?.baseModelId) return;
      if (!activeTab || activeTab.backendId !== resolved.backendId) {
        crossBackend(resolved.target, resolved.baseModelId, effort);
        return;
      }
      if (activeTab.canSwitchModel === false) {
        new Notice("This agent doesn't support runtime model switching.");
        return;
      }
      sameBackend(resolved.baseModelId, effort);
    };

    const sibling = active
      ? buildEffortSibling(slice?.modelState ?? null, activeTab?.canSwitchEffort ?? null)
      : null;
    const effortOptionsByModelKey = buildEffortOptionsByModelKey(backends, entries);

    return {
      models: entries.map(toModelSelectorEntry),
      value: selected ? keyOf(selected) : "",
      disabled: false,
      effort:
        sibling && activeTab
          ? {
              options: [...sibling.options],
              value: sibling.value,
              disabled: sibling.disabled,
              onChange: (value) => {
                void client
                  .command({
                    name: "applySelection",
                    sessionId: activeTab.id,
                    backendId: activeTab.backendId,
                    effort: value,
                  })
                  .then((result) => {
                    if (!result.ok) reportSwitchFailure(result, "effort");
                  });
              },
            }
          : undefined,
      effortOptionsByModelKey,
      onChange,
      commitSelection,
    };
  }, [host, activeTab, slice, client, view, persist]);
}
