import type {
  BackendReadiness,
  BackendSummary,
  EnabledModel,
  PickerModel,
  PreloadStatus,
  ReportedModel,
} from "@/agentMode/protocol/state";
import type {
  BackendDescriptor,
  BackendModelCatalog,
  EffortOption,
  InstallState,
  ModelSelection,
} from "@/agentMode/session/types";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { lockedCopilotEntries, shouldPreviewCopilotModels } from "@/lib/lockedCopilotEntries";
import { sortEffortOptions } from "@/lib/model-effort";
import type { CopilotSettings } from "@/settings/model";

export type PickerModelSource = Pick<
  ModelSelectorEntry,
  | "name"
  | "provider"
  | "displayName"
  | "capabilities"
  | "_group"
  | "_backendId"
  | "_subtitle"
  | "_isFree"
  | "_disabledReason"
  | "_needsSelfHostWarning"
  | "_needsLicense"
>;

/**
 * The single place a picker entry enters host state. It copies display fields by name and never
 * spreads its input, because a `CustomModel` carries `apiKey`, `baseUrl` and `openAIOrgId`.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function toPickerModel(source: PickerModelSource): PickerModel {
  const model: PickerModel = {
    name: source.name,
    provider: source.provider,
    displayName: source.displayName || source.name,
  };
  if (source.capabilities !== undefined) model.capabilities = [...source.capabilities];
  if (source._group !== undefined) model.group = source._group;
  if (source._backendId !== undefined) model.backendId = source._backendId;
  if (source._subtitle !== undefined) model.subtitle = source._subtitle;
  if (source._isFree !== undefined) model.isFree = source._isFree;
  if (source._disabledReason !== undefined) model.disabledReason = source._disabledReason;
  if (source._needsSelfHostWarning !== undefined) {
    model.needsSelfHostWarning = source._needsSelfHostWarning;
  }
  if (source._needsLicense !== undefined) model.needsLicense = source._needsLicense;
  return model;
}

export function readinessOf(state: InstallState): BackendReadiness {
  switch (state.kind) {
    case "checking":
      return "checking";
    case "ready":
      return "ready";
    case "absent":
      return "not_set_up";
    case "incompatible":
      return "update_required";
    case "error":
      return "setup_error";
  }
}

export interface BackendSummaryInputs {
  descriptor: Pick<
    BackendDescriptor,
    | "id"
    | "displayName"
    | "selfHostable"
    | "routesCopilotModels"
    | "getEnabledModelEntries"
    | "getInstallState"
  >;
  settings: CopilotSettings;
  selfHostWarning: boolean;
  catalog: BackendModelCatalog | null;
  effortCatalog: Record<string, EffortOption[]> | null;
  preload: PreloadStatus;
  defaultSelection: ModelSelection | null;
}

/**
 * Builds one backend's contribution to the picker catalog from the desktop's settings and model
 * cache. Every field is a display value or a boolean; credentials, paths and error text are read
 * to decide a label and never copied.
 *
 * `reported` keeps only the models the picker can name (the enabled ones and the saved default),
 * which bounds it by the user's own selection instead of by the agent's full model list.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function buildBackendSummary(inputs: BackendSummaryInputs): BackendSummary {
  const { descriptor, settings, catalog, effortCatalog } = inputs;
  const enabledEntries = descriptor.getEnabledModelEntries?.(settings) ?? null;
  const enabled: EnabledModel[] | null = enabledEntries
    ? enabledEntries.map((entry) => {
        const model: EnabledModel = {
          baseModelId: entry.baseModelId,
          name: entry.name,
          missingKey: entry.credentialState === "missing_key",
        };
        if (entry.description !== undefined) model.description = entry.description;
        if (entry.capabilities !== undefined) model.capabilities = [...entry.capabilities];
        if (entry.isFree !== undefined) model.isFree = entry.isFree;
        if (entry.needsSelfHostWarning !== undefined) {
          model.needsSelfHostWarning = entry.needsSelfHostWarning;
        }
        return model;
      })
    : null;

  const wanted = new Set(enabled?.map((model) => model.baseModelId));
  if (inputs.defaultSelection) wanted.add(inputs.defaultSelection.baseModelId);

  const available = catalog?.availableModels ?? null;
  const reported: ReportedModel[] | null = available
    ? available
        .filter((model) => wanted.has(model.baseModelId))
        .map((model) => {
          const entry: ReportedModel = { baseModelId: model.baseModelId, name: model.name };
          if (model.description !== undefined) entry.description = model.description;
          return entry;
        })
    : null;

  const efforts: Record<string, EffortOption[]> = {};
  const effortIds = new Set<string>([...wanted, ...Object.keys(effortCatalog ?? {})]);
  for (const baseModelId of effortIds) {
    const fromAgent = available?.find((model) => model.baseModelId === baseModelId)?.effortOptions;
    const options = sortEffortOptions(
      fromAgent && fromAgent.length > 0 ? fromAgent : (effortCatalog?.[baseModelId] ?? [])
    );
    if (options.length > 0) {
      efforts[baseModelId] = options.map((option) => ({
        value: option.value,
        label: option.label,
      }));
    }
  }

  const lockedPreview =
    descriptor.routesCopilotModels && shouldPreviewCopilotModels(settings.providers)
      ? lockedCopilotEntries(settings.copilotPlusCatalog, {
          group: descriptor.displayName,
          backendId: descriptor.id,
        }).map(toPickerModel)
      : [];

  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    readiness: readinessOf(descriptor.getInstallState(settings)),
    preload: inputs.preload,
    selfHostable: descriptor.selfHostable,
    selfHostWarning: inputs.selfHostWarning,
    enabled,
    reported,
    efforts,
    defaultSelection: inputs.defaultSelection
      ? { baseModelId: inputs.defaultSelection.baseModelId, effort: inputs.defaultSelection.effort }
      : null,
    lockedPreview,
  };
}
