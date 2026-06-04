import { backendPickerAtomFamily, resolveChatModelSelectionId } from "@/modelManagement";
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

/** Native-select-ready chat backend options plus legacy-key compatibility resolution. */
export function useChatBackendModelOptions(): ChatBackendModelOptions {
  const entries = useAtomValue(backendPickerAtomFamily("chat"), { store: settingsStore });
  const options = useMemo(() => {
    const result: ChatBackendModelOption[] = [];
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      result.push({
        label: entry.configuredModel.info.displayName || entry.configuredModel.info.id,
        value: entry.configuredModelId,
      });
    }
    return result;
  }, [entries]);

  const resolveSelectionId = useCallback(
    (selection: string | undefined) => resolveChatModelSelectionId(entries, selection),
    [entries]
  );

  return { options, resolveSelectionId };
}
