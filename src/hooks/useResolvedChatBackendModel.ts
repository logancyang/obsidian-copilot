import type { App } from "obsidian";
import { useMemo } from "react";
import { useAtomValue } from "jotai";

import type { CustomModel } from "@/aiParams";
import {
  backendPickerAtomFamily,
  configuredModelToCustomModel,
  findChatBackendEntry,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { settingsStore } from "@/settings/model";

/**
 * Resolve the chat backend's selected model into a runnable `CustomModel` for
 * surfaces mounted outside the `ModelManagementProvider` (Quick Ask, custom-
 * command modals). Mirrors `resolveChatBackendModel`'s policy — preferred id if
 * enabled, else first enabled, else `null` — but reads the keychain directly via
 * `app` so it needs no model-management React context. Synchronous: keychain
 * reads are in-memory.
 */
export function useResolvedChatBackendModel(
  app: App,
  configuredModelId: string | undefined
): CustomModel | null {
  const entries = useAtomValue(backendPickerAtomFamily("chat"), { store: settingsStore });
  return useMemo(() => {
    const target = findChatBackendEntry(entries, configuredModelId);
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
