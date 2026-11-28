import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import {
  backendNeedsSelfHostWarning,
  type BackendDescriptor,
} from "@/agentMode/session/descriptor";
import type { HostSliceSource } from "@/agentMode/session/host/SessionHost";
import type { EnabledModelEntry, ModelEntry } from "@/agentMode/session/types";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { lockedCopilotEntries, shouldPreviewCopilotModels } from "@/lib/lockedCopilotEntries";
import { getSettings, subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import type {
  LockedPreviewModel,
  PickerAgent,
  PickerCatalog,
  ReportedModel,
} from "@copilot/protocol/pickerCatalog";

export type PickerCatalogModels = Pick<
  AgentSessionManager,
  | "getCachedModelCatalog"
  | "getEffortCatalog"
  | "getPreloadStatus"
  | "getDefaultSelection"
  | "subscribe"
  | "subscribeModelCache"
>;

export function buildPickerCatalog(
  descriptors: readonly BackendDescriptor[],
  models: PickerCatalogModels,
  settings: CopilotSettings
): PickerCatalog {
  return {
    defaultAgent: settings.agentMode?.activeBackend ?? null,
    agents: descriptors.map((descriptor) => pickerAgent(descriptor, models, settings)),
  };
}

export function pickerCatalogSource(
  descriptors: readonly BackendDescriptor[],
  models: PickerCatalogModels
): HostSliceSource<PickerCatalog> {
  let last: { catalog: PickerCatalog; json: string } | null = null;
  return {
    read() {
      const catalog = buildPickerCatalog(descriptors, models, getSettings());
      const json = JSON.stringify(catalog);
      // Every change signal rebuilds the catalog, and a new reference is a new op and a re-render, so an unchanged catalog keeps the one it had. https://github.com/Brevilabs/obsidian-copilot-private/issues/612
      if (last?.json !== json) last = { catalog, json };
      return last.catalog;
    },
    subscribe(onChange) {
      const stops = [
        subscribeToSettingsChange(onChange),
        models.subscribe(onChange),
        models.subscribeModelCache(onChange),
        ...descriptors.map((descriptor) => descriptor.subscribeInstallState(onChange)),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}

function pickerAgent(
  descriptor: BackendDescriptor,
  models: PickerCatalogModels,
  settings: CopilotSettings
): PickerAgent {
  const modelCatalog = models.getCachedModelCatalog(descriptor.id);
  const reported = modelCatalog?.availableModels ?? null;
  const blocked = reported ? (descriptor.getBlockedModels?.(settings, reported) ?? null) : null;
  const selection = models.getDefaultSelection(descriptor.id);
  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    routesCopilotModels: descriptor.routesCopilotModels,
    installKind: descriptor.getInstallState(settings).kind,
    preload: models.getPreloadStatus(descriptor.id),
    selfHostWarning: backendNeedsSelfHostWarning(descriptor, settings),
    enabledModels: descriptor.getEnabledModelEntries?.(settings)?.map(toEnabledModel) ?? null,
    modelCatalog: modelCatalog ? { availableModels: reported?.map(toReportedModel) ?? null } : null,
    blockedModels: blocked && {
      baseModelIds: [...blocked.baseModelIds],
      reason: blocked.reason,
      hint: blocked.hint,
    },
    effortCatalog: models.getEffortCatalog(descriptor.id),
    defaultSelection: selection && { baseModelId: selection.baseModelId, effort: selection.effort },
    lockedPreview:
      descriptor.routesCopilotModels && shouldPreviewCopilotModels(settings.providers)
        ? lockedCopilotEntries(settings.copilotPlusCatalog).map(toLockedPreview)
        : [],
  };
}

// The rows are built from settings that also hold API keys and provider URLs, so only the named display fields cross to a client, never a spread of the row. https://github.com/Brevilabs/obsidian-copilot-private/issues/612
function toEnabledModel(entry: EnabledModelEntry): EnabledModelEntry {
  return {
    baseModelId: entry.baseModelId,
    name: entry.name,
    label: entry.label,
    description: entry.description,
    credentialState: entry.credentialState,
    capabilities: entry.capabilities && [...entry.capabilities],
    isFree: entry.isFree,
    needsSelfHostWarning: entry.needsSelfHostWarning,
  };
}

function toReportedModel(entry: ModelEntry): ReportedModel {
  return {
    baseModelId: entry.baseModelId,
    name: entry.name,
    description: entry.description,
    effortOptions: entry.effortOptions,
  };
}

function toLockedPreview(entry: ModelSelectorEntry): LockedPreviewModel {
  return {
    name: entry.name,
    provider: entry.provider,
    displayName: entry.displayName,
    subtitle: entry._subtitle,
    disabledReason: entry._disabledReason,
  };
}
