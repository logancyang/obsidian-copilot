import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import { providerRequiresApiKey } from "@/modelManagement";
import type { EnabledModelCredentialState, EnabledModelEntry } from "@/agentMode/session/types";

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

/** opencode provider id reserved for the Copilot Plus brevilabs proxy. */
export const COPILOT_PLUS_OPENCODE_PROVIDER_ID = "copilot-plus";

/** See AGENTS.md → "Referential stability". */
const EMPTY_ENABLED_ENTRIES: readonly EnabledModelEntry[] = Object.freeze([]);

/**
 * Map a Copilot `Provider` onto its opencode provider id, or `null` when
 * opencode can't route it (so callers skip it). A BYOK provider with a
 * `catalogProviderId` maps to it (identical to opencode's provider id). A BYOK
 * provider without one has no catalog identity opencode can resolve: when it
 * speaks OpenAI's wire format (`openai-compatible` — Ollama, LM Studio, custom)
 * it's routable as a per-provider `@ai-sdk/openai-compatible` entry keyed by its
 * `providerId` (see `buildOpencodeConfig`); azure / bedrock speak other formats
 * and stay unroutable.
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
 * The opencode wire base id for one routable configured model
 * (`<providerId>/<model>` for non-native, `info.id` verbatim for agent-hosted
 * native). Returns `null` when the provider isn't opencode-routable.
 */
function opencodeWireBaseId(provider: Provider, configuredModel: ConfiguredModel): string | null {
  const mapping = mapProviderToOpencodeId(provider);
  if (!mapping) return null;
  return mapping.native ? configuredModel.info.id : `${mapping.id}/${configuredModel.info.id}`;
}

/**
 * Credential health for an enabled opencode model, derived purely from the
 * persisted provider row (sync — no keychain read). Native (agent-hosted)
 * providers carry their own auth, so they're always `ok`. Otherwise a
 * required-key provider with no key reads `missing_key`.
 */
function credentialStateFor(provider: Provider, native: boolean): EnabledModelCredentialState {
  if (native) return "ok";
  if (providerRequiresApiKey(provider) && !provider.apiKeyKeychainId) return "missing_key";
  return "ok";
}

/**
 * Enabled opencode models enriched for the chat picker: wire base id, display
 * name/description, and per-model credential health. Lets the picker iterate
 * the enabled set (not the reported∩enabled intersection) so a model opencode
 * dropped for a missing/expired key still appears, flagged. Joins
 * `backends.opencode.enabledModels` to the configured-model + provider state
 * via `opencodeWireBaseId`; unroutable / missing entries are skipped.
 */
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
    const baseModelId = opencodeWireBaseId(provider, configuredModel);
    if (!baseModelId) continue;
    out.push({
      baseModelId,
      name: configuredModel.info.displayName || configuredModel.info.id,
      description: configuredModel.info.description,
      credentialState: credentialStateFor(provider, mapping.native),
    });
  }
  return out.length === 0 ? EMPTY_ENABLED_ENTRIES : out;
}
