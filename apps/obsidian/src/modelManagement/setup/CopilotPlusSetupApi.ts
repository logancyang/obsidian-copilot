import type { ModelManagementCoordinator } from "@/modelManagement/createModelManagement";
import type { ProviderType } from "@/modelManagement/types/catalog";
import type { BackendType, Provider } from "@/modelManagement/types/persisted";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { BYOK_DEFAULT_AUTO_ENROLL } from "@/modelManagement/setup/ByokSetupApi";

export interface RegisterPlusProviderInput {
  providerType: ProviderType;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  // Omitted `models` leaves the set untouched: reconciling against an unreadable endpoint would delete every model:
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  models?: readonly ModelInfo[];
  autoEnrollIn?: readonly BackendType[];
  autoEnrollModelIds?: readonly string[];
}

export interface PlusSetupResult {
  providerId: string;
  configuredModelIds: string[];
}

export class CopilotPlusSetupApi {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;
  readonly #coordinator: ModelManagementCoordinator;

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    backendConfigRegistry: BackendConfigRegistry,
    coordinator: ModelManagementCoordinator
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
    this.#coordinator = coordinator;
  }

  async registerPlusProvider(input: RegisterPlusProviderInput): Promise<PlusSetupResult> {
    const existing = this.#findPlusProvider();

    let providerId: string;
    if (existing) {
      providerId = existing.providerId;
      await this.#providers.update(providerId, {
        displayName: input.displayName,
        baseUrl: input.baseUrl,
      });
    } else {
      providerId = await this.#providers.add({
        providerType: input.providerType,
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        origin: { kind: "copilot-plus" },
        requiresApiKey: false,
      });
    }

    if (input.apiKey != null) {
      await this.#providers.setApiKey(providerId, input.apiKey);
    }

    const configuredModelIds = input.models
      ? await this.#reconcileModels(
          providerId,
          input.models,
          input.autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL,
          input.autoEnrollModelIds
        )
      : this.#models.listByProvider(providerId).map((m) => m.configuredModelId);

    return { providerId, configuredModelIds };
  }

  async unregisterPlusProvider(): Promise<void> {
    const existing = this.#findPlusProvider();
    if (!existing) return;
    await this.#coordinator.removeProvider(existing.providerId);
  }

  #findPlusProvider(): Provider | undefined {
    const matches = this.#providers.listByOrigin("copilot-plus");
    if (matches.length > 1) {
      throw new Error(
        `[modelManagement] CopilotPlusSetupApi: ${matches.length} copilot-plus providers ` +
          `found; the singleton invariant is violated`
      );
    }
    return matches[0];
  }

  async #reconcileModels(
    providerId: string,
    models: readonly ModelInfo[],
    autoEnrollIn: readonly BackendType[],
    autoEnrollModelIds?: readonly string[]
  ): Promise<string[]> {
    const existing = this.#models.listByProvider(providerId);
    const existingByWireId = new Map(existing.map((m) => [m.info.id, m]));
    const desiredWireIds = new Set(models.map((info) => info.id));
    const autoEnrollFilter = autoEnrollModelIds ? new Set(autoEnrollModelIds) : null;

    for (const info of models) {
      const current = existingByWireId.get(info.id);
      if (!current) {
        const configuredModelId = await this.#models.add({ providerId, info });
        if (!info.isEmbedding && (!autoEnrollFilter || autoEnrollFilter.has(info.id))) {
          for (const backend of autoEnrollIn) {
            await this.#backends.enableModel(backend, configuredModelId);
          }
        }
        continue;
      }
      if (
        current.info.displayName !== info.displayName ||
        current.info.description !== info.description ||
        current.info.toolCall !== info.toolCall ||
        current.info.reasoning !== info.reasoning ||
        JSON.stringify(current.info.reasoningEfforts) !== JSON.stringify(info.reasoningEfforts) ||
        JSON.stringify(current.info.limits) !== JSON.stringify(info.limits) ||
        JSON.stringify(current.info.modalities) !== JSON.stringify(info.modalities)
      ) {
        await this.#models.update(current.configuredModelId, {
          info: {
            displayName: info.displayName,
            description: info.description,
            toolCall: info.toolCall,
            reasoning: info.reasoning,
            reasoningEfforts: info.reasoningEfforts,
            limits: info.limits,
            modalities: info.modalities,
          },
        });
      }
    }

    for (const model of existing) {
      if (desiredWireIds.has(model.info.id)) continue;
      await this.#coordinator.removeConfiguredModel(model.configuredModelId);
    }

    const ids: string[] = [];
    for (const info of models) {
      const found = this.#models.getByWireId(providerId, info.id);
      if (found) ids.push(found.configuredModelId);
    }
    return ids;
  }
}
