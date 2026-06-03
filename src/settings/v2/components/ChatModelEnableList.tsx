import { ModelEnableList, type ModelEnableGroup } from "@/agentMode";
import { logError } from "@/logger";
import {
  backendsAtom,
  configuredModelsAtom,
  providersAtom,
  useModelManagement,
} from "@/modelManagement";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import React from "react";
import { buildModelEnableGroups, partitionChatCandidates } from "./configuredModelGrouping";

/** Frozen empty fallback so the untouched chat backend's enabled set is stable. */
const EMPTY_ENABLED: readonly string[] = Object.freeze([]);

/**
 * Curation list for the non-agent "chat" backend (Quick Chat). Sources every
 * BYOK / Copilot Plus configured chat model from the registry and toggles
 * `backends.chat` through `BackendConfigRegistry`. Reuses the shared
 * `ModelEnableList` UI and grouping helpers; agent-origin models are excluded
 * because the chat backend instantiates via LangChain, not an agent CLI.
 */
export const ChatModelEnableList: React.FC = () => {
  const api = useModelManagement();

  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const providers = useAtomValue(providersAtom, { store: settingsStore });
  const backends = useAtomValue(backendsAtom, { store: settingsStore });

  const [query, setQuery] = React.useState("");

  const enabledIds = React.useMemo(
    () => new Set(backends.chat?.enabledModels ?? EMPTY_ENABLED),
    [backends]
  );

  const partition = React.useMemo(
    () => partitionChatCandidates(configuredModels, providers, enabledIds),
    [configuredModels, providers, enabledIds]
  );

  const groups = React.useMemo<ModelEnableGroup[]>(
    () => buildModelEnableGroups(partition, false, query),
    [partition, query]
  );

  const handleToggle = React.useCallback(
    (id: string, enabled: boolean) => {
      const run = enabled
        ? api.backendConfigRegistry.enableModel("chat", id)
        : api.backendConfigRegistry.disableModel("chat", id);
      run.catch((err) => logError(`[QuickChat] toggle model ${id} failed`, err));
    },
    [api]
  );

  const emptyState = (
    <span>
      No models configured yet. Add a provider on the{" "}
      <span className="tw-font-medium">Models (BYOK)</span> tab to populate Quick Chat.
    </span>
  );

  return (
    <ModelEnableList
      groups={groups}
      onToggle={handleToggle}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder="Search chat models…"
      emptyState={emptyState}
    />
  );
};
