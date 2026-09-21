import type { Provider } from "@/modelManagement";

/**
 * opencode Zen — opencode's own hosted gateway provider. Its models carry the
 * `opencode/` wire-id prefix and make up opencode's free model tier. We surface
 * a privacy warning for them because, unlike a self-hosted/BYOK model, prompts
 * are sent to a third party whose terms may allow logging or training.
 */
export const OPENCODE_ZEN_PROVIDER_ID = "opencode";

/** `true` when a wire base id belongs to opencode Zen (`opencode/<model>`). */
export function isOpencodeZenWireId(wireId: string): boolean {
  return wireId.startsWith(`${OPENCODE_ZEN_PROVIDER_ID}/`);
}

/** opencode provider id reserved for the Copilot Plus brevilabs proxy. */
export const COPILOT_PLUS_OPENCODE_PROVIDER_ID = "copilot-plus";

export interface OpencodeProviderMapping {
  /** The opencode provider id — leading segment of `<provider>/<model>`. */
  id: string;
  /**
   * `true` when opencode hosts the provider itself (an agent-origin provider it
   * discovered): it carries its own auth + model snapshot, so the runtime
   * config must NOT re-register it or inject a key.
   */
  native: boolean;
}

/**
 * Map a Copilot `Provider` onto its opencode provider id, or `null` when
 * opencode can't route it (so callers skip it). A BYOK provider with a
 * `catalogProviderId` maps to it (identical to opencode's provider id). A BYOK
 * provider without one has no catalog identity opencode can resolve: when it
 * speaks OpenAI's wire format (`openai-compatible` — Ollama, LM Studio, custom)
 * it's routable as a per-provider `@ai-sdk/openai-compatible` entry keyed by its
 * `providerId` (see `buildOpencodeConfig`).
 */
export function mapProviderToOpencodeId(provider: Provider): OpencodeProviderMapping | null {
  switch (provider.origin.kind) {
    case "byok": {
      const catalogProviderId = provider.origin.catalogProviderId;
      if (catalogProviderId) return { id: catalogProviderId, native: false };
      if (provider.providerType === "openai-compatible") {
        // The providerId is unique + stable and can't collide with a real
        // models.dev provider id; it's the wire-id prefix `<providerId>/<model>`.
        return { id: provider.providerId, native: false };
      }
      return null;
    }
    case "copilot-plus":
      return { id: COPILOT_PLUS_OPENCODE_PROVIDER_ID, native: false };
    case "agent":
      // An opencode-discovered provider's id is opencode's own provider id, and
      // opencode hosts the models — native, so no key/registration.
      return { id: provider.providerId, native: true };
    default:
      return null;
  }
}

/**
 * The opencode wire base id for one model on `provider`
 * (`<providerId>/<model>` for non-native, the model id verbatim for
 * agent-hosted native). Returns `null` when the provider isn't
 * opencode-routable.
 *
 * @param provider - Row the model belongs to; decides the prefix and whether there is one.
 * @param modelId - The model's own `ConfiguredModel.info.id`.
 */
export function opencodeWireBaseId(provider: Provider, modelId: string): string | null {
  const mapping = mapProviderToOpencodeId(provider);
  if (!mapping) return null;
  return mapping.native ? modelId : `${mapping.id}/${modelId}`;
}
