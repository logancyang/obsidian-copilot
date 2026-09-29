import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ProviderType } from "@/modelManagement/types/catalog";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { anthropicAdapter } from "./anthropicAdapter";
import { googleAdapter } from "./googleAdapter";
import { openaiCompatibleAdapter } from "./openaiCompatibleAdapter";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<ProviderType, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerType, adapter);
  }

  get(providerType: ProviderType): ProviderAdapter {
    const adapter = this.adapters.get(providerType);
    if (!adapter) {
      throw new Error(`[modelManagement] No adapter registered for providerType "${providerType}"`);
    }
    return adapter;
  }

  list(): readonly ProviderAdapter[] {
    return [...this.adapters.values()];
  }

  buildLangChainClient(
    providerType: ProviderType,
    ctx: Omit<AdapterBuildContext, "extras"> & { extras: unknown }
  ): BaseChatModel {
    const adapter = this.get(providerType);
    const extras = adapter.extrasSchema.parse(ctx.extras);
    return adapter.buildLangChainClient({ ...ctx, extras });
  }

  verifyCredentials(
    providerType: ProviderType,
    ctx: Omit<AdapterVerifyContext, "extras"> & { extras: unknown }
  ): Promise<VerificationResult> {
    const adapter = this.get(providerType);
    const extras = adapter.extrasSchema.parse(ctx.extras);
    return adapter.verifyCredentials({ ...ctx, extras });
  }
}

export function createDefaultAdapterRegistry(): ProviderAdapterRegistry {
  const registry = new ProviderAdapterRegistry();
  registry.register(anthropicAdapter);
  registry.register(openaiCompatibleAdapter);
  registry.register(googleAdapter);
  return registry;
}
