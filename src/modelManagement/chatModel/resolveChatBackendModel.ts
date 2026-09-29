import { CustomModel } from "@/aiParams";
import { logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";

import { findChatBackendEntry, isChatModelSelectionForEntry } from "./chatModelSelection";
import { configuredModelToCustomModel } from "./configuredModelToCustomModel";

export type ChatBackendResolution =
  | { ok: true; configuredModelId: string; customModel: CustomModel }
  | { ok: false; reason: "empty" };

export async function resolveChatBackendModel(
  api: Pick<ModelManagementApi, "backendConfigRegistry" | "providerRegistry">,
  preferredConfiguredModelId: string | undefined
): Promise<ChatBackendResolution> {
  const enabled = api.backendConfigRegistry.resolveEnabled("chat");
  const target = findChatBackendEntry(enabled, preferredConfiguredModelId);
  if (!target) return { ok: false, reason: "empty" };

  if (
    preferredConfiguredModelId &&
    !isChatModelSelectionForEntry(target, preferredConfiguredModelId)
  ) {
    logWarn(
      `[chatBridge] chat model "${preferredConfiguredModelId}" is not enabled; ` +
        `falling back to configuredModelId="${target.configuredModelId}"`
    );
  }

  const apiKey = await api.providerRegistry.getApiKey(target.provider.providerId);
  const customModel = configuredModelToCustomModel({
    provider: target.provider,
    configuredModel: target.configuredModel,
    apiKey,
  });
  return { ok: true, configuredModelId: target.configuredModelId, customModel };
}
