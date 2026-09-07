import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

/** Copilot Plus uses one reserved opencode provider, independent of saved row IDs. */
export const COPILOT_PLUS_OPENCODE_PROVIDER_ID = "copilot-plus";

/** Pure provider mapping shared by runtime routing and mobile-safe settings migrations. */
export function mapProviderToOpencodeId(
  provider: Provider
): { id: string; native: boolean } | null {
  switch (provider.origin.kind) {
    case "byok": {
      const catalogProviderId = provider.origin.catalogProviderId;
      if (catalogProviderId) return { id: catalogProviderId, native: false };
      // Custom OpenAI-compatible endpoints use the stable saved provider ID.
      if (provider.providerType === "openai-compatible") {
        return { id: provider.providerId, native: false };
      }
      return null;
    }
    case "copilot-plus":
      return { id: COPILOT_PLUS_OPENCODE_PROVIDER_ID, native: false };
    case "agent":
      // Native providers already own their auth and full model wire IDs.
      return { id: provider.providerId, native: true };
    default:
      return null;
  }
}

/** Resolve a saved row without importing the desktop agent runtime during migration. */
export function opencodeWireBaseId(
  provider: Provider | undefined,
  configuredModel: ConfiguredModel
): string | null {
  // Missing providers are unroutable, as in the existing runtime row resolver.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/386
  if (!provider) return null;
  const mapping = mapProviderToOpencodeId(provider);
  if (!mapping) return null;
  return mapping.native ? configuredModel.info.id : `${mapping.id}/${configuredModel.info.id}`;
}
