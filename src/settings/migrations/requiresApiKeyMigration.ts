import { isSelfHostedProvider } from "@/modelManagement";
import type { Provider } from "@/modelManagement";

function resolveByIdentity(provider: Provider): boolean {
  switch (provider.origin.kind) {
    case "agent":
      return false;
    case "copilot-plus":
      return false;
    case "byok":
      if (provider.origin.catalogProviderId) return true;
      return !isSelfHostedProvider(provider);
    default:
      return true;
  }
}

export function planRequiresApiKeyBackfill(
  providers: Record<string, Provider>
): Record<string, Provider> | null {
  let changed = false;
  const next: Record<string, Provider> = {};
  for (const [id, provider] of Object.entries(providers)) {
    if (provider.requiresApiKey === undefined) {
      next[id] = { ...provider, requiresApiKey: resolveByIdentity(provider) };
      changed = true;
    } else {
      next[id] = provider;
    }
  }
  return changed ? next : null;
}
