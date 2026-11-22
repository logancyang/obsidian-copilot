import {
  chatBackendPickerAtom,
  providerRequiresApiKey,
  resolveChatModelSelectionId,
} from "@/modelManagement";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";

export interface ChatBackendModelOption {
  label: string;
  value: string;
}

export interface ChatBackendModelOptions {
  options: ChatBackendModelOption[];
  resolveSelectionId: (selection: string | undefined) => string | undefined;
}

export function useChatBackendModelOptions(fallbackToFirst = true): ChatBackendModelOptions {
  const entries = useAtomValue(chatBackendPickerAtom, { store: settingsStore });
  const options = useMemo(() => {
    const result: ChatBackendModelOption[] = [];
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      // A default that cannot authenticate looks configured but fails every request. https://github.com/Brevilabs/obsidian-copilot-private/issues/616
      if (providerRequiresApiKey(entry.provider) && !entry.provider.apiKeyKeychainId) continue;
      result.push({
        label: entry.configuredModel.info.displayName || entry.configuredModel.info.id,
        value: entry.configuredModelId,
      });
    }
    return result;
  }, [entries]);

  const resolveSelectionId = useCallback(
    (selection: string | undefined) =>
      resolveChatModelSelectionId(entries, selection, fallbackToFirst),
    [entries, fallbackToFirst]
  );

  return { options, resolveSelectionId };
}
