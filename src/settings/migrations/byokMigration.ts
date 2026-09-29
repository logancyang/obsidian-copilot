import type { CustomModel } from "@/aiParams";
import {
  ChatModelProviders,
  ProviderInfo,
  type ProviderMetadata,
  ProviderSettingsKeyMap,
  type SettingKeyProviders,
} from "@/constants";
import { logError, logInfo } from "@/logger";
import type {
  BackendType,
  ModelInfo,
  ModelManagementApi,
  Provider,
  ProviderType,
  SetupProviderInput,
} from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";

const EMBEDDING_ID = /(^|[-_/.\s])embed(ding)?($|[-_/.\s])/i;

interface LegacyProviderMapping {
  providerType: ProviderType;
  catalogProviderId?: string;
  opencodeRoutable: boolean;
  requiresBaseUrl?: boolean;
}

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
};

const ENROLL_CHAT_AND_OPENCODE: readonly BackendType[] = Object.freeze(["chat", "opencode"]);
const ENROLL_CHAT_ONLY: readonly BackendType[] = Object.freeze(["chat"]);

function normalizeUrl(url: string | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function providerMetaFor(provider: string): ProviderMetadata | undefined {
  return (ProviderInfo as unknown as Record<string, ProviderMetadata | undefined>)[provider];
}

function defaultBaseUrlFor(provider: string): string | undefined {
  const url = providerMetaFor(provider)?.curlBaseURL;
  if (!url || url.includes("<") || url.includes("{")) return undefined;
  return url;
}

function displayNameFor(provider: string): string {
  return providerMetaFor(provider)?.label ?? provider;
}

function buildExtras(
  model: CustomModel,
  settings: CopilotSettings,
  providerType: ProviderType
): Record<string, unknown> | undefined {
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
  enableCors: boolean;
  extras?: Record<string, unknown>;
}

function resolveCandidate(model: CustomModel, settings: CopilotSettings): ResolvedCandidate | null {
  const mapping = LEGACY_PROVIDER_MAP[model.provider];
  if (!mapping) return null;
  if (!model.enabled) return null;
  if (model.isEmbeddingModel ?? EMBEDDING_ID.test(model.name)) return null;

  const keyField = ProviderSettingsKeyMap[model.provider as SettingKeyProviders];
  const rawKey = keyField ? settings[keyField] : undefined;
  const topLevelKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const apiKey = model.apiKey?.trim() || topLevelKey || undefined;

  let baseUrl: string | undefined;
  if (mapping.requiresBaseUrl) {
    baseUrl = model.baseUrl?.trim() || undefined;
    if (!baseUrl) return null;
  } else {
    baseUrl = model.baseUrl?.trim() || defaultBaseUrlFor(model.provider);
    if (!apiKey) return null;
  }

  return {
    mapping,
    apiKey,
    baseUrl,
    enableCors: model.enableCors ?? false,
    extras: buildExtras(model, settings, mapping.providerType),
  };
}

function toModelInfo(model: CustomModel): ModelInfo {
  return { id: model.name, displayName: model.displayName?.trim() || model.name };
}

export function planByokMigration(settings: CopilotSettings): SetupProviderInput[] {
  const groups = new Map<
    string,
    { input: SetupProviderInput; modelsById: Map<string, ModelInfo> }
  >();

  for (const model of settings.activeModels ?? []) {
    const candidate = resolveCandidate(model, settings);
    if (!candidate) continue;
    const { mapping, apiKey, baseUrl, enableCors, extras } = candidate;

    // https://github.com/logancyang/obsidian-copilot-preview/issues/313:
    // legacy models sharing an endpoint can carry different CORS choices, so
    // keep them in separate providers instead of silently dropping one choice.
    const groupKey = [
      mapping.providerType,
      mapping.catalogProviderId ?? "",
      normalizeUrl(baseUrl),
      apiKey ?? "",
      enableCors ? "cors" : "stream",
    ].join("\u0000");

    let group = groups.get(groupKey);
    if (!group) {
      const input: SetupProviderInput = {
        providerType: mapping.providerType,
        displayName: displayNameFor(model.provider),
        models: [],
        autoEnrollIn: mapping.opencodeRoutable ? ENROLL_CHAT_AND_OPENCODE : ENROLL_CHAT_ONLY,
        requiresApiKey: !mapping.requiresBaseUrl,
        enableCors,
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

// Key and CORS are excluded from the match so an already-migrated provider is not duplicated
// when its legacy CORS choice can no longer be recovered:
// https://github.com/logancyang/obsidian-copilot-preview/issues/313
function isDuplicateByok(provider: Provider, descriptor: SetupProviderInput): boolean {
  if (provider.origin.kind !== "byok") return false;
  return (
    provider.providerType === descriptor.providerType &&
    (provider.origin.catalogProviderId ?? "") === (descriptor.catalogProviderId ?? "") &&
    normalizeUrl(provider.baseUrl) === normalizeUrl(descriptor.baseUrl)
  );
}

export async function executeByokMigration(
  api: ModelManagementApi,
  settings: CopilotSettings
): Promise<void> {
  const descriptors = planByokMigration(settings);
  if (descriptors.length === 0) {
    logInfo("[byok-migration] no legacy BYOK providers to migrate");
    return;
  }

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
