/**
 * Resolve the chat backend's selected model into a runnable `CustomModel`.
 *
 * Single entry point shared by every chat surface (main chat, project, vault
 * QA, quick command, quick ask) so they all apply the same selection + fallback
 * policy:
 *   - the passed `configuredModelId` if it's still enabled in `backends.chat`;
 *   - otherwise the first enabled chat model (stale/removed selection);
 *   - otherwise `{ ok: false, reason: "empty" }` — nothing enabled, UI prompts
 *     the user to enable a model under Settings → Agents → Quick Chat.
 */

import { CustomModel } from "@/aiParams";
import { logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";

import { configuredModelToCustomModel } from "./configuredModelToCustomModel";

export type ChatBackendResolution =
  | { ok: true; configuredModelId: string; customModel: CustomModel }
  | { ok: false; reason: "empty" };

export async function resolveChatBackendModel(
  api: Pick<ModelManagementApi, "backendConfigRegistry" | "providerRegistry">,
  preferredConfiguredModelId: string | undefined
): Promise<ChatBackendResolution> {
  const enabled = api.backendConfigRegistry.resolveEnabled("chat");
  const okEntries = enabled.filter(
    (entry): entry is Extract<typeof entry, { state: "ok" }> => entry.state === "ok"
  );
  if (okEntries.length === 0) return { ok: false, reason: "empty" };

  let target = preferredConfiguredModelId
    ? okEntries.find((entry) => entry.configuredModelId === preferredConfiguredModelId)
    : undefined;
  if (!target) {
    if (preferredConfiguredModelId) {
      logWarn(
        `[chatBridge] chat model "${preferredConfiguredModelId}" is not enabled; ` +
          `falling back to the first enabled chat model`
      );
    }
    target = okEntries[0];
  }

  const apiKey = await api.providerRegistry.getApiKey(target.provider.providerId);
  const customModel = configuredModelToCustomModel({
    provider: target.provider,
    configuredModel: target.configuredModel,
    apiKey,
  });
  return { ok: true, configuredModelId: target.configuredModelId, customModel };
}
