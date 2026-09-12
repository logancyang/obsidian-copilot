import {
  mapProviderToOpencodeId,
  ModelEnableList,
  type BackendDescriptor,
  type ModelEnableGroup,
} from "@/agentMode";
import { Button } from "@/components/ui/button";
import { useTab } from "@/contexts/TabContext";
import { logError } from "@/logger";
import {
  backendsAtom,
  configuredModelsAtom,
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
  loading: boolean;
  onConfigure: () => void;
}

/** Frozen empty fallback so an untouched backend's enabled set is a stable reference. */
const EMPTY_ENABLED: readonly string[] = Object.freeze([]);

/**
 * Hoisted to module scope to stay referentially stable across renders (an
 * inline arrow would invalidate the partition memo every render).
 */
const isOpencodeRoutableProvider = (
  provider: Parameters<typeof mapProviderToOpencodeId>[0]
): boolean => mapProviderToOpencodeId(provider) !== null;

/**
 * Renders the shared `ModelEnableList` for one agent backend, sourcing
 * candidates from the `configuredModels` registry and toggling through
 * `BackendConfigRegistry`. opencode shows BYOK/Plus models plus its own
 * agent-origin models; claude/codex show only their agent-origin models.
 * Disabled rows stay visible.
 */
export const ConfiguredModelEnableList: React.FC<ConfiguredModelEnableListProps> = ({
  descriptor,
  loading,
  onConfigure,
}) => {
  const api = useModelManagement();
  const { setSelectedTab } = useTab();
  // A backend's id doubles as its model-management AgentType.
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

  // Ask the provider rows, as both pickers do, rather than letting the grouping
  // infer a missing license from the rows it just built: registering the provider
  // and reconciling its models are separate writes, so a licensed user can hold
  // the provider with nothing under it, and that user must not be shown a locked
  // group telling them a license is required.
  const copilotProviderMissing = shouldPreviewCopilotModels(providers);

  const groups = React.useMemo<ModelEnableGroup[]>(
    () => buildModelEnableGroups(partition, isOpencode, query, copilotProviderMissing),
    [partition, isOpencode, query, copilotProviderMissing]
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

  const emptyState = (
    <>
      <div className="tw-font-medium tw-text-normal">
        {isOpencode ? "No models configured" : "No models reported"}
      </div>
      <div>
        {isOpencode
          ? "Add a provider and models in BYOK settings to populate this list."
          : `Check ${descriptor.displayName} setup and sign-in, then open a chat session to discover models.`}
      </div>
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        {isOpencode ? (
          <Button
            variant="secondary"
            size="sm"
            className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-text-left"
            onClick={() => setSelectedTab("byok")}
          >
            Open provider settings
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-text-left"
            onClick={onConfigure}
          >
            Configure {descriptor.displayName}
          </Button>
        )}
      </div>
    </>
  );

  return (
    <ModelEnableList
      groups={groups}
      onToggle={handleToggle}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={`Search ${descriptor.displayName} models…`}
      emptyState={emptyState}
      loading={loading}
      // Only the first provider group starts expanded; the rest collapse so a
      // long multi-provider list (opencode) opens compact. A stable scalar, so
      // it doesn't churn the list's collapse state across renders.
      defaultOpenGroupKey={groups[0]?.key}
    />
  );
};
