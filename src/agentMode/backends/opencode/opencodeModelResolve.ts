import {
  COPILOT_PLUS_OPENCODE_PROVIDER_ID,
  isOpencodeZenWireId,
  mapProviderToOpencodeId,
  opencodeWireBaseId,
} from "@/utils/opencodeModelId";
import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import {
  capabilitiesFromConfiguredInfo,
  providerNeedsSelfHostWarning,
  providerRequiresApiKey,
} from "@/modelManagement";
import type { EnabledModelCredentialState, EnabledModelEntry } from "@/agentMode/session/types";

export function copilotPlusModelId(wireModelId: string | null | undefined): string | null {
  const prefix = `${COPILOT_PLUS_OPENCODE_PROVIDER_ID}/`;
  if (typeof wireModelId !== "string" || !wireModelId.startsWith(prefix)) return null;
  return wireModelId.slice(prefix.length);
}

const EMPTY_ENABLED_ENTRIES: readonly EnabledModelEntry[] = Object.freeze([]);

export function opencodeWireBaseIdFor(
  configuredModelId: string,
  settings: CopilotSettings
): string | null {
  const configuredModel = settings.configuredModels.find(
    (model) => model.configuredModelId === configuredModelId
  );
  if (!configuredModel) return null;
  const provider = settings.providers[configuredModel.providerId];
  if (!provider) return null;
  return opencodeWireBaseId(provider, configuredModel.info.id);
}

function credentialStateFor(provider: Provider, native: boolean): EnabledModelCredentialState {
  if (native) return "ok";
  if (providerRequiresApiKey(provider) && !provider.apiKeyKeychainId) return "missing_key";
  return "ok";
}

export function opencodeEnabledModelEntries(
  settings: CopilotSettings
): readonly EnabledModelEntry[] {
  const enabledIds = settings.backends.opencode?.enabledModels ?? [];
  if (enabledIds.length === 0) return EMPTY_ENABLED_ENTRIES;

  const modelsById = new Map<string, ConfiguredModel>();
  for (const model of settings.configuredModels) {
    modelsById.set(model.configuredModelId, model);
  }

  const out: EnabledModelEntry[] = [];
  for (const configuredModelId of enabledIds) {
    const configuredModel = modelsById.get(configuredModelId);
    if (!configuredModel) continue;
    const provider = settings.providers[configuredModel.providerId];
    if (!provider) continue;
    const mapping = mapProviderToOpencodeId(provider);
    if (!mapping) continue;
    const baseModelId = opencodeWireBaseId(provider, configuredModel.info.id);
    if (!baseModelId) continue;
    const name = configuredModel.info.displayName || configuredModel.info.id;
    // opencode labels models by provider id, which is a UUID for custom endpoints;
    // a blank provider name would read worse than that UUID, so it keeps opencode's label.
    // https://github.com/logancyang/obsidian-copilot/issues/3496
    const isCustomEndpoint = provider.origin.kind === "byok" && !provider.origin.catalogProviderId;
    const providerName = provider.displayName.trim();
    out.push({
      baseModelId,
      name,
      label: isCustomEndpoint && providerName ? `${providerName}/${name}` : undefined,
      description: configuredModel.info.description,
      credentialState: credentialStateFor(provider, mapping.native),
      isFree: isOpencodeZenWireId(baseModelId),
      capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
      needsSelfHostWarning: providerNeedsSelfHostWarning(provider, settings),
    });
  }
  return out.length === 0 ? EMPTY_ENABLED_ENTRIES : out;
}
