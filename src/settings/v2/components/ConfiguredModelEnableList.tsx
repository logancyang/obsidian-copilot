import {
  mapProviderToOpencodeId,
  ModelEnableList,
  type BackendDescriptor,
  type ModelEnableGroup,
} from "@/agentMode";
import { logError } from "@/logger";
import {
  backendsAtom,
  configuredModelsAtom,
  copilotPlusCatalogAtom,
  providersAtom,
  useModelManagement,
  type AgentType,
} from "@/modelManagement";
import { shouldPreviewCopilotModels } from "@/lib/lockedCopilotEntries";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import React from "react";
import { buildModelEnableGroups, partitionCandidates } from "./configuredModelGrouping";

interface ConfiguredModelEnableListProps {
  descriptor: BackendDescriptor;
}

const EMPTY_ENABLED: readonly string[] = Object.freeze([]);

const isOpencodeRoutableProvider = (
  provider: Parameters<typeof mapProviderToOpencodeId>[0]
): boolean => mapProviderToOpencodeId(provider) !== null;

export const ConfiguredModelEnableList: React.FC<ConfiguredModelEnableListProps> = ({
  descriptor,
}) => {
  const api = useModelManagement();
  const agentType = descriptor.id as AgentType;

  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const providers = useAtomValue(providersAtom, { store: settingsStore });
  const backends = useAtomValue(backendsAtom, { store: settingsStore });

  const [query, setQuery] = React.useState("");

  const enabledIds = React.useMemo(() => {
    const list = backends[agentType]?.enabledModels ?? EMPTY_ENABLED;
    return new Set(list);
  }, [backends, agentType]);

  const isOpencode = descriptor.id === "opencode";

  const partition = React.useMemo(
    () =>
      partitionCandidates(
        configuredModels,
        providers,
        enabledIds,
        agentType,
        isOpencode,
        isOpencodeRoutableProvider
      ),
    [configuredModels, providers, enabledIds, agentType, isOpencode]
  );

  const copilotProviderMissing = shouldPreviewCopilotModels(providers);
  const copilotPlusCatalog = useAtomValue(copilotPlusCatalogAtom, { store: settingsStore });

  const groups = React.useMemo<ModelEnableGroup[]>(
    () =>
      buildModelEnableGroups(
        partition,
        isOpencode,
        query,
        copilotProviderMissing,
        copilotPlusCatalog
      ),
    [partition, isOpencode, query, copilotProviderMissing, copilotPlusCatalog]
  );

  const handleToggle = React.useCallback(
    (id: string, enabled: boolean) => {
      const run = enabled
        ? api.backendConfigRegistry.enableModel(agentType, id)
        : api.backendConfigRegistry.disableModel(agentType, id);
      run.catch((err) => logError(`[AgentMode] toggle model ${id} for ${agentType} failed`, err));
    },
    [api, agentType]
  );

  const emptyState =
    descriptor.id === "opencode" ? (
      <span>
        No models configured yet. Add a provider on the{" "}
        <span className="tw-font-medium">Models (BYOK)</span> tab, or sign in to an opencode
        subscription, to curate models here.
      </span>
    ) : (
      <span>
        No models reported yet. Sign in / install the {descriptor.displayName} CLI and reload, or
        open a chat session with this agent.
      </span>
    );

  return (
    <ModelEnableList
      groups={groups}
      onToggle={handleToggle}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={`Search ${descriptor.displayName} models…`}
      emptyState={emptyState}
      defaultOpenGroupKey={groups[0]?.key}
    />
  );
};
