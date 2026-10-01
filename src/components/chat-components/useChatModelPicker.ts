import {
  backendPickerAtomFamily,
  capabilitiesFromConfiguredInfo,
  mapProviderTypeToChatModelProvider,
  providerRequiresApiKey,
  resolveChatModelSelectionId,
} from "@/modelManagement";
import { getModelKeyFromModel, settingsStore, useSettingsValue } from "@/settings/model";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { lockedCopilotEntries, shouldPreviewCopilotModels } from "@/lib/lockedCopilotEntries";
import { useAtomValue } from "jotai";
import React from "react";

export interface ChatModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
}

const NOOP = () => {};

const EMPTY_LOCKED_ROWS: readonly ModelSelectorEntry[] = Object.freeze([]);

const EMPTY_ENTRY: ModelSelectorEntry = {
  name: "__chat_no_models__",
  provider: "",
  displayName: "No models — enable in Basic → Agents → Quick Chat",
  enabled: true,
  _disabledReason: "Add a model",
};
const EMPTY_ENTRY_KEY = getModelKeyFromModel(EMPTY_ENTRY);

export function useChatModelPicker(params: {
  value: string | undefined;
  fallbackToFirst?: boolean;
  onChange: (configuredModelId: string) => void;
}): ChatModelPickerOverride {
  const { value, onChange, fallbackToFirst = true } = params;
  const entries = useAtomValue(backendPickerAtomFamily("chat"), { store: settingsStore });
  const settings = useSettingsValue();

  const lockedRows = React.useMemo(
    () =>
      shouldPreviewCopilotModels(settings.providers)
        ? lockedCopilotEntries(settings.copilotPlusCatalog)
        : EMPTY_LOCKED_ROWS,
    [settings.providers, settings.copilotPlusCatalog]
  );

  const { models, byModelKey, idToModelKey } = React.useMemo(() => {
    const models: ModelSelectorEntry[] = [];
    const byModelKey = new Map<string, string>();
    const idToModelKey = new Map<string, string>();
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      const { configuredModel, provider, configuredModelId } = entry;
      const capabilities = capabilitiesFromConfiguredInfo(configuredModel.info);
      const needsKey = providerRequiresApiKey(provider) && !provider.apiKeyKeychainId;
      const modelEntry: ModelSelectorEntry = {
        name: configuredModelId,
        provider: mapProviderTypeToChatModelProvider(provider),
        displayName: configuredModel.info.displayName || configuredModel.info.id,
        enabled: true,
        capabilities,
        _disabledReason: needsKey ? "Add API key" : undefined,
        _needsSelfHostWarning: entry.needsSelfHostWarning,
      };
      const modelKey = getModelKeyFromModel(modelEntry);
      models.push(modelEntry);
      byModelKey.set(modelKey, configuredModelId);
      idToModelKey.set(configuredModelId, modelKey);
    }
    return { models, byModelKey, idToModelKey };
  }, [entries]);

  const resolvedValue = React.useMemo(() => {
    const resolvedId = resolveChatModelSelectionId(entries, value, fallbackToFirst);
    return (resolvedId && idToModelKey.get(resolvedId)) || "";
  }, [entries, value, idToModelKey, fallbackToFirst]);

  const displayModels = React.useMemo(() => {
    if (!models.some((m) => m._needsSelfHostWarning)) return models;
    const local: ModelSelectorEntry[] = [];
    const cloud: ModelSelectorEntry[] = [];
    for (const m of models) (m._needsSelfHostWarning ? cloud : local).push(m);
    return [...local, ...cloud];
  }, [models]);

  const handleChange = React.useCallback(
    (modelKey: string) => {
      const id = byModelKey.get(modelKey);
      if (id) onChange(id);
    },
    [byModelKey, onChange]
  );

  if (displayModels.length === 0) {
    return { models: [...lockedRows, EMPTY_ENTRY], value: EMPTY_ENTRY_KEY, onChange: NOOP };
  }

  return {
    models: lockedRows.length > 0 ? [...lockedRows, ...displayModels] : displayModels,
    value: resolvedValue,
    onChange: handleChange,
  };
}
