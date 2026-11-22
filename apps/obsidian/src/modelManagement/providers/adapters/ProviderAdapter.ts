import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";

import type { ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";

export interface AdapterBuildContext<TExtras = unknown> {
  provider: Provider;
  configuredModel: ConfiguredModel;
  apiKey: string | null;
  extras: TExtras;
}

export interface AdapterVerifyContext<TExtras = unknown> {
  provider: Provider;
  apiKey: string | null;
  extras: TExtras;
  probeModel?: ConfiguredModel;
}

export interface ProviderAdapter<TExtras = unknown> {
  readonly providerType: ProviderType;

  readonly extrasSchema: z.ZodType<TExtras>;

  buildLangChainClient(ctx: AdapterBuildContext<TExtras>): BaseChatModel;

  verifyCredentials(ctx: AdapterVerifyContext<TExtras>): Promise<VerificationResult>;
}
