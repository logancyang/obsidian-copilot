import { getDecryptedKey } from "@/encryptionService";
import { providerRequiresApiKey } from "@/modelManagement";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import type { PiByokProvider, PiFetchResponse, PiProviderDeps } from "@/pi/types";

/** See AGENTS.md → "Referential stability". */
const NO_BYOK_PROVIDERS: readonly PiByokProvider[] = Object.freeze([]);

/**
 * Collect the user's own OpenAI-compatible endpoints as pi providers. Only
 * BYOK-origin rows qualify: agent-origin rows are catalogs other backends
 * enrolled (including pi's own), so consuming them would feed pi's models back
 * into pi. A row with no configured model — or one that needs a key and has
 * none — is skipped rather than registered as an endpoint that cannot answer.
 */
async function collectByokProviders(plugin: CopilotPlugin): Promise<readonly PiByokProvider[]> {
  const settings = getSettings();
  const rows: PiByokProvider[] = [];
  for (const provider of Object.values(settings.providers)) {
    if (provider.providerType !== "openai-compatible") continue;
    if (provider.origin.kind !== "byok") continue;
    if (!provider.baseUrl) continue;
    const modelIds = settings.configuredModels
      .filter((model) => model.providerId === provider.providerId)
      .map((model) => model.info.id);
    if (modelIds.length === 0) continue;
    const requiresApiKey = providerRequiresApiKey(provider);
    const apiKey =
      (await plugin.modelManagement.providerRegistry.getApiKey(provider.providerId)) ?? "";
    // A local runner (Ollama, LM Studio) is usable with no key at all; only an
    // endpoint that demands one is dropped when the key is missing.
    if (requiresApiKey && !apiKey) continue;
    rows.push({
      id: provider.providerId,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      apiKey,
      requiresApiKey,
      modelIds,
    });
  }
  return rows.length > 0 ? rows : NO_BYOK_PROVIDERS;
}

/**
 * Everything the pi engine needs from the plugin to build its providers.
 * Resolved fresh each time the backend starts, so a license key or endpoint
 * added after the last start is picked up on the next one.
 */
export async function resolvePiProviderDeps(plugin: CopilotPlugin): Promise<PiProviderDeps> {
  return {
    plusLicenseKey: await getDecryptedKey(getSettings().plusLicenseKey),
    byokProviders: await collectByokProviders(plugin),
    // Native fetch, not `safeFetch`: the model proxy allows the Obsidian
    // origin, and `safeFetch` buffers the whole body, which would defeat
    // streaming.
    fetch: (url: string): Promise<PiFetchResponse> => fetch(url),
  };
}
