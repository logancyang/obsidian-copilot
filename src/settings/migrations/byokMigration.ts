/**
 * One-time migration: legacy BYOK models + provider keys → the new
 * provider / configured-model / backend data model, so a user's own keys keep
 * working in OpenCode (and Simple Chat) when agent mode lands.
 *
 * Two halves so the mapping logic is trivially unit-testable:
 *  - `planByokMigration` is PURE — legacy settings in, `SetupProviderInput[]`
 *    out, no side effects (reads keys from the already-hydrated in-memory
 *    settings, never disk).
 *  - `executeByokMigration` is the thin side-effecting wrapper that dedups
 *    against existing BYOK providers and feeds each descriptor through the
 *    battle-tested `ByokSetupApi.setupProvider` (provider row → keychain →
 *    configured models → backend enrollment, with its own rollback).
 *
 * Scope (locked with the product owner):
 *  - Credential-driven: every legacy provider with a user-supplied key (or, for
 *    local/openai-format providers, an explicit base URL) and its ENABLED
 *    models — built-in and custom.
 *  - Azure / Bedrock migrate to Simple Chat only (OpenCode can't route them).
 *  - Skip embeddings, disabled models, and copilot-plus / github-copilot
 *    (owned by Plus sign-in and agent setup).
 *  - Non-destructive: legacy keys and `activeModels` are left untouched.
 */

import type { CustomModel } from "@/aiParams";
import {
  ChatModelProviders,
  ProviderInfo,
  type ProviderMetadata,
  ProviderSettingsKeyMap,
  type SettingKeyProviders,
} from "@/constants";
import { logError, logInfo } from "@/logger";
// Type-only imports: nothing here pulls the model-management barrel at runtime,
// keeping this settings-layer module (and its unit tests) light.
import type {
  BackendType,
  ModelInfo,
  ModelManagementApi,
  Provider,
  ProviderType,
  SetupProviderInput,
} from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";

// Token-bounded "embed"/"embedding" id match. Mirrors `looksLikeEmbeddingModel`
// in `@/modelManagement/catalog/catalogTransform`; kept local so this module
// stays type-only against the model-management barrel.
const EMBEDDING_ID = /(^|[-_/.\s])embed(ding)?($|[-_/.\s])/i;

interface LegacyProviderMapping {
  providerType: ProviderType;
  /** models.dev / OpenCode provider id; absent for catalog-less providers. */
  catalogProviderId?: string;
  /** OpenCode can route this provider → enroll in `opencode` too. */
  opencodeRoutable: boolean;
  /**
   * Keyless providers (Ollama / LM Studio / generic OpenAI-format) that are
   * only migrated when the model carries an explicit `baseUrl` — i.e. the user
   * actually pointed them somewhere, not a bare unconfigured default.
   */
  requiresBaseUrl?: boolean;
}

/**
 * Legacy `CustomModel.provider` → new-format mapping. Providers absent here
 * (copilot-plus, github-copilot, anything unrecognized) are skipped. The
 * top-level API-key field is derived from `ProviderSettingsKeyMap`, not
 * duplicated here.
 */
const LEGACY_PROVIDER_MAP: Partial<Record<string, LegacyProviderMapping>> = {
  [ChatModelProviders.ANTHROPIC]: {
    providerType: "anthropic",
    catalogProviderId: "anthropic",
    opencodeRoutable: true,
  },
  [ChatModelProviders.OPENAI]: {
    providerType: "openai-compatible",
    catalogProviderId: "openai",
    opencodeRoutable: true,
  },
  [ChatModelProviders.GOOGLE]: {
    providerType: "google",
    catalogProviderId: "google",
    opencodeRoutable: true,
  },
  [ChatModelProviders.OPENROUTERAI]: {
    providerType: "openai-compatible",
    catalogProviderId: "openrouter",
    opencodeRoutable: true,
  },
  [ChatModelProviders.XAI]: {
    providerType: "openai-compatible",
    catalogProviderId: "xai",
    opencodeRoutable: true,
  },
  [ChatModelProviders.GROQ]: {
    providerType: "openai-compatible",
    catalogProviderId: "groq",
    opencodeRoutable: true,
  },
  [ChatModelProviders.MISTRAL]: {
    providerType: "openai-compatible",
    catalogProviderId: "mistral",
    opencodeRoutable: true,
  },
  [ChatModelProviders.DEEPSEEK]: {
    providerType: "openai-compatible",
    catalogProviderId: "deepseek",
    opencodeRoutable: true,
  },
  // Catalog-less but OpenAI-compatible: routable via their base URL.
  [ChatModelProviders.SILICONFLOW]: { providerType: "openai-compatible", opencodeRoutable: true },
  [ChatModelProviders.COHEREAI]: { providerType: "openai-compatible", opencodeRoutable: true },
  [ChatModelProviders.OLLAMA]: {
    providerType: "openai-compatible",
    opencodeRoutable: true,
    requiresBaseUrl: true,
  },
  [ChatModelProviders.LM_STUDIO]: {
    providerType: "openai-compatible",
    opencodeRoutable: true,
    requiresBaseUrl: true,
  },
  [ChatModelProviders.OPENAI_FORMAT]: {
    providerType: "openai-compatible",
    opencodeRoutable: true,
    requiresBaseUrl: true,
  },
  // Not OpenCode-routable → Simple Chat only.
  [ChatModelProviders.AZURE_OPENAI]: { providerType: "azure", opencodeRoutable: false },
  [ChatModelProviders.AMAZON_BEDROCK]: { providerType: "bedrock", opencodeRoutable: false },
};

// Frozen enrollment targets — referential stability (see AGENTS.md).
const ENROLL_CHAT_AND_OPENCODE: readonly BackendType[] = Object.freeze(["chat", "opencode"]);
const ENROLL_CHAT_ONLY: readonly BackendType[] = Object.freeze(["chat"]);

/** Trim, drop a trailing slash, lowercase — for grouping / dedup comparison. */
function normalizeUrl(url: string | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/** Runtime-safe lookup: `ProviderInfo`'s typed keys are the provider enum, but
 *  `model.provider` is a raw string, so widen the index to allow `undefined`. */
function providerMetaFor(provider: string): ProviderMetadata | undefined {
  return (ProviderInfo as unknown as Record<string, ProviderMetadata | undefined>)[provider];
}

/** Catalog default base URL for a provider, or `undefined` for placeholder
 *  URLs (azure `<resource>`, bedrock `{region}`) that aren't real endpoints. */
function defaultBaseUrlFor(provider: string): string | undefined {
  const url = providerMetaFor(provider)?.curlBaseURL;
  if (!url || url.includes("<") || url.includes("{")) return undefined;
  return url;
}

function displayNameFor(provider: string): string {
  return providerMetaFor(provider)?.label ?? provider;
}

/** Per-`providerType` opaque payload the adapters can't function without. */
function buildExtras(
  model: CustomModel,
  settings: CopilotSettings,
  providerType: ProviderType
): Record<string, unknown> | undefined {
  if (providerType === "azure") {
    const extras: Record<string, unknown> = {};
    const instance = model.azureOpenAIApiInstanceName || settings.azureOpenAIApiInstanceName;
    const deployment = model.azureOpenAIApiDeploymentName || settings.azureOpenAIApiDeploymentName;
    const apiVersion = model.azureOpenAIApiVersion || settings.azureOpenAIApiVersion;
    if (instance) extras.azureInstanceName = instance;
    if (deployment) extras.azureDeploymentName = deployment;
    if (apiVersion) extras.azureApiVersion = apiVersion;
    return Object.keys(extras).length > 0 ? extras : undefined;
  }
  if (providerType === "bedrock") {
    const region = model.bedrockRegion || settings.amazonBedrockRegion;
    return region ? { bedrockRegion: region } : undefined;
  }
  if (model.provider === (ChatModelProviders.OPENAI as string)) {
    const orgId = model.openAIOrgId || settings.openAIOrgId;
    return orgId ? { openAIOrgId: orgId } : undefined;
  }
  return undefined;
}

interface ResolvedCandidate {
  mapping: LegacyProviderMapping;
  apiKey?: string;
  baseUrl?: string;
  extras?: Record<string, unknown>;
}

/**
 * Decide whether a single legacy model migrates, and resolve its credential /
 * base URL / extras. Returns `null` for anything out of scope.
 */
function resolveCandidate(model: CustomModel, settings: CopilotSettings): ResolvedCandidate | null {
  const mapping = LEGACY_PROVIDER_MAP[model.provider];
  if (!mapping) return null; // unknown / copilot-plus / github-copilot
  if (!model.enabled) return null; // disabled models skipped per scope
  if (model.isEmbeddingModel ?? EMBEDDING_ID.test(model.name)) return null; // embeddings skipped

  const keyField = ProviderSettingsKeyMap[model.provider as SettingKeyProviders];
  const rawKey = keyField ? settings[keyField] : undefined;
  const topLevelKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const apiKey = model.apiKey?.trim() || topLevelKey || undefined;

  let baseUrl: string | undefined;
  if (mapping.requiresBaseUrl) {
    // Local / generic OpenAI-format: only migrate an explicitly-pointed endpoint.
    baseUrl = model.baseUrl?.trim() || undefined;
    if (!baseUrl) return null;
  } else {
    baseUrl = model.baseUrl?.trim() || defaultBaseUrlFor(model.provider);
    if (!apiKey) return null; // key-based providers need a usable key
  }

  return { mapping, apiKey, baseUrl, extras: buildExtras(model, settings, mapping.providerType) };
}

function toModelInfo(model: CustomModel): ModelInfo {
  return { id: model.name, displayName: model.displayName?.trim() || model.name };
}

/**
 * Pure: legacy settings → BYOK provider-setup descriptors. Models are grouped
 * into one provider per `(providerType, catalogProviderId, baseUrl, apiKey)` so
 * distinct credentials become distinct provider instances; model ids are
 * de-duped within a group (last wins) to satisfy `bulkSet`.
 */
export function planByokMigration(settings: CopilotSettings): SetupProviderInput[] {
  const groups = new Map<
    string,
    { input: SetupProviderInput; modelsById: Map<string, ModelInfo> }
  >();

  for (const model of settings.activeModels ?? []) {
    const candidate = resolveCandidate(model, settings);
    if (!candidate) continue;
    const { mapping, apiKey, baseUrl, extras } = candidate;

    const groupKey = [
      mapping.providerType,
      mapping.catalogProviderId ?? "",
      normalizeUrl(baseUrl),
      apiKey ?? "",
    ].join(" ");

    let group = groups.get(groupKey);
    if (!group) {
      const input: SetupProviderInput = {
        providerType: mapping.providerType,
        displayName: displayNameFor(model.provider),
        models: [],
        autoEnrollIn: mapping.opencodeRoutable ? ENROLL_CHAT_AND_OPENCODE : ENROLL_CHAT_ONLY,
        // Local runners (`requiresBaseUrl`) migrate key-less; every other
        // legacy mapping is key-based. Persist it explicitly so the runtime
        // never re-infers from the endpoint.
        requiresApiKey: !mapping.requiresBaseUrl,
      };
      if (mapping.catalogProviderId) input.catalogProviderId = mapping.catalogProviderId;
      if (baseUrl) input.baseUrl = baseUrl;
      if (apiKey) input.apiKey = apiKey;
      if (extras) input.extras = extras;
      group = { input, modelsById: new Map() };
      groups.set(groupKey, group);
    }

    const info = toModelInfo(model);
    group.modelsById.set(info.id, info);
  }

  return [...groups.values()].map(({ input, modelsById }) => ({
    ...input,
    models: [...modelsById.values()],
  }));
}

/** A pre-existing BYOK provider equivalent to a planned descriptor (same
 *  identity: type + catalog id + base URL). Key is intentionally NOT part of
 *  the match — a keyless existing row still counts as "already present". */
function isDuplicateByok(provider: Provider, descriptor: SetupProviderInput): boolean {
  if (provider.origin.kind !== "byok") return false;
  return (
    provider.providerType === descriptor.providerType &&
    (provider.origin.catalogProviderId ?? "") === (descriptor.catalogProviderId ?? "") &&
    normalizeUrl(provider.baseUrl) === normalizeUrl(descriptor.baseUrl)
  );
}

/**
 * Side-effecting executor. Builds a one-shot plan from `settings`, skips
 * descriptors that match an existing BYOK provider, and creates the rest via
 * `ByokSetupApi.setupProvider`. Never throws: a single provider failure is
 * logged and the rest proceed (the version bump in the caller is unconditional).
 */
export async function executeByokMigration(
  api: ModelManagementApi,
  settings: CopilotSettings
): Promise<void> {
  const descriptors = planByokMigration(settings);
  if (descriptors.length === 0) {
    logInfo("[byok-migration] no legacy BYOK providers to migrate");
    return;
  }

  // Snapshot existing BYOK providers once; the planner already de-dups within
  // this run, so a stale snapshot only matters for pre-existing rows.
  const existing = api.providerRegistry.listByOrigin("byok");
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const descriptor of descriptors) {
    if (existing.some((provider) => isDuplicateByok(provider, descriptor))) {
      skipped++;
      logInfo(`[byok-migration] skipping already-present provider "${descriptor.displayName}"`);
      continue;
    }
    try {
      const result = await api.setup.byok.setupProvider(descriptor);
      created++;
      logInfo(
        `[byok-migration] migrated "${descriptor.displayName}" ` +
          `(${result.configuredModelIds.length} models, enroll=${descriptor.autoEnrollIn?.join("+")})`
      );
    } catch (err) {
      failed++;
      logError(`[byok-migration] failed to migrate "${descriptor.displayName}"; continuing`, err);
    }
  }

  logInfo(
    `[byok-migration] done: ${created} migrated, ${skipped} already present, ${failed} failed`
  );
}
