import { logError } from "@/logger";
import { looksLikeEmbeddingModel } from "@/modelManagement/catalog/catalogTransform";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { BackendType } from "@/modelManagement/types/persisted";
import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

export const BYOK_DEFAULT_AUTO_ENROLL: readonly BackendType[] = ["chat", "opencode"];

export interface AddModelsInput {
  providerId: string;
  models: readonly ModelInfo[];
  autoEnrollIn?: readonly BackendType[];
}

export interface SetupProviderInput {
  catalogProviderId?: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl?: string;
  enableCors?: boolean;
  apiKey?: string;
  extras?: Record<string, unknown>;
  requiresApiKey?: boolean;
  models: readonly ModelInfo[];
  autoEnrollIn?: readonly BackendType[];
}

export interface ByokSetupResult {
  providerId: string;
  configuredModelIds: string[];
}

export class ByokSetupApi {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    backendConfigRegistry: BackendConfigRegistry
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
  }

  async setupProvider(input: SetupProviderInput): Promise<ByokSetupResult> {
    const providerId = await this.#providers.add({
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      enableCors: input.enableCors,
      requiresApiKey: input.requiresApiKey ?? true,
      origin: {
        kind: "byok",
        ...(input.catalogProviderId ? { catalogProviderId: input.catalogProviderId } : {}),
      },
      extras: input.extras,
    });

    try {
      if (input.apiKey) {
        await this.#providers.setApiKey(providerId, input.apiKey);
      }

      const configuredModelIds = await this.#models.bulkSet(providerId, input.models);

      const newChatIds = configuredModelIds.filter((_, i) => !input.models[i]?.isEmbedding);
      await this.#enrollInBackends(input.autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL, newChatIds);

      return { providerId, configuredModelIds };
    } catch (err) {
      await this.#rollbackProvider(providerId);
      throw err;
    }
  }

  async addModels(input: AddModelsInput): Promise<string[]> {
    const resultIds: string[] = [];
    const newChatIds: string[] = [];
    for (const info of input.models) {
      const existing = this.#models.getByWireId(input.providerId, info.id);
      if (existing) {
        resultIds.push(existing.configuredModelId);
        continue;
      }
      const configuredModelId = await this.#models.add({ providerId: input.providerId, info });
      resultIds.push(configuredModelId);
      const isEmbedding = info.isEmbedding ?? looksLikeEmbeddingModel(info.id);
      if (!isEmbedding) {
        newChatIds.push(configuredModelId);
      }
    }
    await this.#enrollInBackends(input.autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL, newChatIds);
    return resultIds;
  }

  async #enrollInBackends(
    enrollIn: readonly BackendType[],
    newChatIds: readonly string[]
  ): Promise<void> {
    if (newChatIds.length === 0) return;
    for (const backend of enrollIn) {
      const current = this.#backends.get(backend).enabledModels;
      const merged = [...current];
      for (const id of newChatIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      await this.#backends.setEnabledModels(backend, merged);
    }
  }

  async #rollbackProvider(providerId: string): Promise<void> {
    try {
      const modelIds = this.#models.listByProvider(providerId).map((m) => m.configuredModelId);
      if (modelIds.length > 0) {
        await this.#backends.removeRefs(modelIds);
        await this.#models.removeByProvider(providerId);
      }
      await this.#providers.remove(providerId);
    } catch (err) {
      logError(`[modelManagement] ByokSetupApi rollback failed for ${providerId}`, err);
    }
  }
}
