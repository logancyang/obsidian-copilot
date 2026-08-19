import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import {
  capabilitiesFromConfiguredInfo,
  providerHasApiKey,
  providerNeedsSelfHostWarning,
  providerRequiresApiKey,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
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

/**
 * The bare Copilot Plus model id behind an opencode wire id, or null for anything else.
 *
 * The prefix is the whole test for whether Copilot Plus caps apply to a session: a user
 * on their own API key reaches this same backend but is not metered by them, and must see
 * no cap meters. Other backends serving these models spell their wire ids differently, so
 * each strips its own prefix before asking the shared reader about the account.
 *
 * @param wireModelId - Model id as it travels to the agent, provider prefix included.
 */
export function copilotPlusModelId(wireModelId: string | null | undefined): string | null {
  const prefix = `${COPILOT_PLUS_OPENCODE_PROVIDER_ID}/`;
  if (typeof wireModelId !== "string" || !wireModelId.startsWith(prefix)) return null;
  return wireModelId.slice(prefix.length);
}

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
 * opencode's wire base id for one configured model, or `null` when opencode
 * cannot route its provider. Deliberately ignores `enabledModels`: provider
 * sync creates the configured model before enrolling it, so a caller that
 * needs the id the moment the model exists must not depend on enrollment.
 *
 * @param configuredModelId - The configured model to translate.
 * @param settings - Caller-owned settings snapshot holding the model + provider rows.
 */
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
  return opencodeWireBaseId(provider, configuredModel);
}

/**
 * Credential health for an enabled opencode model. Native (agent-hosted)
 * providers carry their own auth, so they're always `ok`. Otherwise a
 * required-key provider whose key is absent from this device's keychain
 * reads `missing_key` — presence is `hasKey`'s live local read, never the
 * synced `apiKeyKeychainId` pointer (see the note on that field).
 * https://github.com/logancyang/obsidian-copilot-preview/issues/261
 */
function credentialStateFor(
  provider: Provider,
  native: boolean,
  hasKey: (provider: Provider) => boolean
): EnabledModelCredentialState {
  if (native) return "ok";
  if (providerRequiresApiKey(provider) && !hasKey(provider)) return "missing_key";
  return "ok";
}

/**
 * Default presence probe: live read against this device's keychain.
 *
 * Relies on plugin startup having initialized `KeychainService` before any
 * model resolution runs — the same contract `loadSettingsWithKeychain` uses.
 * Keychain read failures are absorbed by `providerHasApiKey`; a missing
 * service is a wiring error and must surface rather than be reported as
 * "user has no key".
 */
function defaultHasKey(provider: Provider): boolean {
  return providerHasApiKey(provider, KeychainService.getInstance());
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
  settings: CopilotSettings,
  hasKey: (provider: Provider) => boolean = defaultHasKey
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
      credentialState: credentialStateFor(provider, mapping.native, hasKey),
      isFree: isOpencodeZenWireId(baseModelId),
      capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
      needsSelfHostWarning: providerNeedsSelfHostWarning(provider, settings),
    });
  }
  return out.length === 0 ? EMPTY_ENABLED_ENTRIES : out;
}
