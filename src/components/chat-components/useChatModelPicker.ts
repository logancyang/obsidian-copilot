import { ModelCapability } from "@/constants";
import {
  backendPickerAtomFamily,
  mapProviderTypeToChatModelProvider,
  providerRequiresApiKey,
  resolveChatModelSelectionId,
} from "@/modelManagement";
import { getModelKeyFromModel, settingsStore } from "@/settings/model";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { useAtomValue } from "jotai";
import React from "react";

/**
 * Minimal `ChatInput.modelPickerOverride` shape for the non-agent chat picker.
 * Omitting `effort`/`commitSelection` makes `ChatInput` render the flat
 * `ModelSelector` (decision: no per-pick effort stepper for legacy chat).
 */
export interface ChatModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
}

const NOOP = () => {};

/**
 * Synthetic disabled row shown when no chat model is enabled, so the picker
 * trigger guides the user instead of rendering an empty dropdown.
 */
const EMPTY_ENTRY: ModelSelectorEntry = {
  name: "__chat_no_models__",
  provider: "",
  displayName: "No models — enable under Agents → Quick Chat",
  enabled: true,
  _disabledReason: "Add a model",
};
const EMPTY_ENTRY_KEY = getModelKeyFromModel(EMPTY_ENTRY);

/**
 * Drives the chat model picker off the model-management "chat" backend
 * (`backends.chat.enabledModels`) instead of the legacy `settings.activeModels`.
 *
 * Picker entries are keyed by `configuredModelId` (a UUID) rather than the
 * legacy `name|provider` key; `value`/`onChange` translate between that id
 * (what the caller stores) and the `ModelSelector` model key internally. The
 * displayed value reflects the *effective* model — the stored selection if it's
 * still enabled, else the first enabled model — matching `resolveChatBackendModel`.
 */
export function useChatModelPicker(params: {
  /** Current selection — a `configuredModelId`. */
  value: string;
  /** Persist a new `configuredModelId` selection. */
  onChange: (configuredModelId: string) => void;
}): ChatModelPickerOverride {
  const { value, onChange } = params;
  const entries = useAtomValue(backendPickerAtomFamily("chat"), { store: settingsStore });

  const { models, byModelKey, idToModelKey } = React.useMemo(() => {
    const models: ModelSelectorEntry[] = [];
    const byModelKey = new Map<string, string>();
    const idToModelKey = new Map<string, string>();
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      const { configuredModel, provider, configuredModelId } = entry;
      const capabilities: ModelCapability[] = [];
      if (configuredModel.info.reasoning) capabilities.push(ModelCapability.REASONING);
      if (configuredModel.info.modalities?.input?.includes("image")) {
        capabilities.push(ModelCapability.VISION);
      }
      const needsKey = providerRequiresApiKey(provider) && !provider.apiKeyKeychainId;
      const modelEntry: ModelSelectorEntry = {
        name: configuredModelId,
        provider: mapProviderTypeToChatModelProvider(provider),
        displayName: configuredModel.info.displayName || configuredModel.info.id,
        enabled: true,
        capabilities,
        _disabledReason: needsKey ? "Add API key" : undefined,
      };
      const modelKey = getModelKeyFromModel(modelEntry);
      models.push(modelEntry);
      byModelKey.set(modelKey, configuredModelId);
      idToModelKey.set(configuredModelId, modelKey);
    }
    return { models, byModelKey, idToModelKey };
  }, [entries]);

  const resolvedValue = React.useMemo(() => {
    const resolvedId = resolveChatModelSelectionId(entries, value);
    const current = resolvedId ? idToModelKey.get(resolvedId) : undefined;
    if (current) return current;
    const first = models[0];
    return first ? getModelKeyFromModel(first) : "";
  }, [entries, value, idToModelKey, models]);

  const handleChange = React.useCallback(
    (modelKey: string) => {
      const id = byModelKey.get(modelKey);
      if (id) onChange(id);
    },
    [byModelKey, onChange]
  );

  if (models.length === 0) {
    return { models: [EMPTY_ENTRY], value: EMPTY_ENTRY_KEY, onChange: NOOP };
  }

  return { models, value: resolvedValue, onChange: handleChange };
}
