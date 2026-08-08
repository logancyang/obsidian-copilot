/**
 * Dispatch table from `ProviderType` to its adapter. Owned by the
 * top-level `createModelManagement` factory; passed to
 * `ProviderRegistry` and `ChatModelFactory` so they can dispatch by
 * `Provider.providerType` without hard-coding adapter imports.
 *
 * Tests can substitute mocks via `register()`. `createDefaultAdapterRegistry`
 * returns a registry pre-populated with the five built-in adapters.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ProviderType } from "@/modelManagement/types/catalog";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { anthropicAdapter } from "./anthropicAdapter";
import { azureAdapter } from "./azureAdapter";
import { bedrockAdapter } from "./bedrockAdapter";
import { googleAdapter } from "./googleAdapter";
import { openaiCompatibleAdapter } from "./openaiCompatibleAdapter";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<ProviderType, ProviderAdapter>();

  /** Last registration for a given `providerType` wins, so tests can
   *  override built-in adapters without resetting the registry. */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerType, adapter);
  }

  /** Throws if no adapter is registered for `providerType`. Callers
   *  treat this as an invariant violation — the closed
   *  `ProviderType` union guarantees the dispatch is total. Prefer the
   *  `buildLangChainClient` / `verifyCredentials` dispatch helpers
   *  below; reaching directly for the adapter skips the schema parse
   *  the adapter contract relies on. */
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

  /**
   * Dispatch helper: parse `extras` through the adapter's `extrasSchema`,
   * then delegate to `buildLangChainClient`. Funnelling every build
   * through this helper makes the contract at `ProviderAdapter.ts`
   * ("extras is parsed before being passed in") impossible to bypass.
   */
  buildLangChainClient(
    providerType: ProviderType,
    ctx: Omit<AdapterBuildContext, "extras"> & { extras: unknown }
  ): BaseChatModel {
    const adapter = this.get(providerType);
    const extras = adapter.extrasSchema.parse(ctx.extras);
    return adapter.buildLangChainClient({ ...ctx, extras });
  }

  /**
   * Dispatch helper: parse `extras` through the adapter's `extrasSchema`,
   * then delegate to `verifyCredentials`.
   */
  verifyCredentials(
    providerType: ProviderType,
    ctx: Omit<AdapterVerifyContext, "extras"> & { extras: unknown }
  ): Promise<VerificationResult> {
    const adapter = this.get(providerType);
    const extras = adapter.extrasSchema.parse(ctx.extras);
    return adapter.verifyCredentials({ ...ctx, extras });
  }
}

/**
 * Returns a registry pre-populated with the five built-in adapters
 * (anthropic / openai-compatible / google / azure / bedrock). Matches
 * the closed `ProviderType` union one-to-one.
 */
export function createDefaultAdapterRegistry(): ProviderAdapterRegistry {
  const registry = new ProviderAdapterRegistry();
  registry.register(anthropicAdapter);
  registry.register(openaiCompatibleAdapter);
  registry.register(googleAdapter);
  registry.register(azureAdapter);
  registry.register(bedrockAdapter);
  return registry;
}
