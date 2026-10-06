import type { App } from "obsidian";
import { useMemo } from "react";
import { useAtomValue } from "jotai";

import type { CustomModel } from "@/aiParams";
import {
  chatBackendPickerAtom,
  configuredModelToCustomModel,
  findChatBackendEntry,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { settingsStore } from "@/settings/model";

export function useResolvedChatBackendModel(
  app: App,
  configuredModelId: string | undefined
): CustomModel | null {
  const entries = useAtomValue(chatBackendPickerAtom, { store: settingsStore });
  return useMemo(() => {
    const target = findChatBackendEntry(entries, configuredModelId, false);
    if (!target) return null;
    const apiKey = target.provider.apiKeyKeychainId
      ? KeychainService.getInstance(app).getSecretById(target.provider.apiKeyKeychainId)
      : null;
    return configuredModelToCustomModel({
      provider: target.provider,
      configuredModel: target.configuredModel,
      apiKey,
    });
  }, [entries, configuredModelId, app]);
}
