import type { Provider } from "@/modelManagement";

export const OPENCODE_ZEN_PROVIDER_ID = "opencode";

export function isOpencodeZenWireId(wireId: string): boolean {
  return wireId.startsWith(`${OPENCODE_ZEN_PROVIDER_ID}/`);
}

export const COPILOT_PLUS_OPENCODE_PROVIDER_ID = "copilot-plus";

export interface OpencodeProviderMapping {
  id: string;
  native: boolean;
}

export function mapProviderToOpencodeId(provider: Provider): OpencodeProviderMapping | null {
  switch (provider.origin.kind) {
    case "byok": {
      const catalogProviderId = provider.origin.catalogProviderId;
      if (catalogProviderId) return { id: catalogProviderId, native: false };
      if (provider.providerType === "openai-compatible") {
        return { id: provider.providerId, native: false };
      }
      return null;
    }
    case "copilot-plus":
      return { id: COPILOT_PLUS_OPENCODE_PROVIDER_ID, native: false };
    case "agent":
      return { id: provider.providerId, native: true };
    default:
      return null;
  }
}

export function opencodeWireBaseId(provider: Provider, modelId: string): string | null {
  const mapping = mapProviderToOpencodeId(provider);
  if (!mapping) return null;
  return mapping.native ? modelId : `${mapping.id}/${modelId}`;
}
