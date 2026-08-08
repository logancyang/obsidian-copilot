/**
 * Provider adapter contract.
 *
 * Each `ProviderType` has exactly one adapter. The adapter:
 *   - declares the shape of `Provider.extras` via a Zod schema, so
 *     setup wizards can render the right "advanced" form fields;
 *   - instantiates a LangChain `BaseChatModel` for a (provider,
 *     configuredModel) tuple;
 *   - issues a minimal "ping" to verify credentials.
 *
 * Adapters are stateless. They receive everything they need through
 * the `AdapterBuildContext` / `AdapterVerifyContext` argument — no
 * registry lookups, no settings reads, no keychain access. The
 * `ProviderRegistry` does those reads and hands the resolved values
 * to the adapter.
 *
 * This isolation is what lets `ChatModelFactory` stay pure dispatch
 * and the LangChain SDK imports stay confined to the five adapter
 * files.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";

import type { ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";

/** Inputs to `ProviderAdapter.buildLangChainClient`. */
export interface AdapterBuildContext<TExtras = unknown> {
  provider: Provider;
  configuredModel: ConfiguredModel;
  /** Resolved from the keychain by the caller; `null` for providers
   *  that don't take an API key (Ollama, LMStudio, agent-owned
   *  providers using CLI-managed credentials). */
  apiKey: string | null;
  /** Parsed against `extrasSchema` before being passed in. Adapters
   *  receive the typed shape directly — no further validation
   *  required inside `buildLangChainClient`. */
  extras: TExtras;
}

/** Inputs to `ProviderAdapter.verifyCredentials`. */
export interface AdapterVerifyContext<TExtras = unknown> {
  provider: Provider;
  apiKey: string | null;
  extras: TExtras;
  /** Optional probe model. Adapters that can't issue a ping without
   *  a real wire id (Azure deployment-name routing) may require this
   *  and throw if absent. */
  probeModel?: ConfiguredModel;
}

/**
 * The shape every provider adapter implements. Generic over the
 * extras payload so adapters can type their schemas precisely.
 */
export interface ProviderAdapter<TExtras = unknown> {
  /** Single dispatch key. Matches `Provider.providerType`. */
  readonly providerType: ProviderType;

  /**
   * Zod schema for `Provider.extras`. Adapters with no extras export
   * `z.object({}).strict()`. The Configure Provider dialog reads this
   * schema to render advanced-section form fields, and the adapter
   * registry uses it to validate `extras` before any
   * `buildLangChainClient` call.
   */
  readonly extrasSchema: z.ZodType<TExtras>;

  /**
   * Instantiate a LangChain `BaseChatModel` for this (provider,
   * configured-model) tuple. The caller has already parsed `extras`
   * through `extrasSchema` — adapters can trust the typed shape.
   */
  buildLangChainClient(ctx: AdapterBuildContext<TExtras>): BaseChatModel;

  /**
   * Issue a minimal "ping" to validate credentials. Adapter-defined —
   * Anthropic might check `/v1/models`, Bedrock might call STS, etc.
   * Returns a structured result; throwing is reserved for unrecoverable
   * misconfiguration (missing required extras).
   */
  verifyCredentials(ctx: AdapterVerifyContext<TExtras>): Promise<VerificationResult>;
}
