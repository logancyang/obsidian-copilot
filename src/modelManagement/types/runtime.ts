import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ProviderType } from "./catalog";
import type { ConfiguredModel, Provider } from "./persisted";

export interface VerificationResult {
  ok: boolean;
  message?: string;
  code?: string;
  checkedAt: number;
}

export interface RefreshResult {
  ok: boolean;
  source: "live" | "disk" | "memory";
  fetchedAt: number | null;
  error?: string;
}

export type EnabledBackendEntry =
  | {
      configuredModelId: string;
      state: "ok";
      configuredModel: ConfiguredModel;
      provider: Provider;
      needsSelfHostWarning?: boolean;
    }
  | {
      configuredModelId: string;
      state: "broken";
    };

export interface BuiltChatModel {
  client: BaseChatModel;
  provider: Provider;
  configuredModel: ConfiguredModel;
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  providerType: ProviderType;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  modelInputHint: string;
  catalogProviderId?: string;
}
