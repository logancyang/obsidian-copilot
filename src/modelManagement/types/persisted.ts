import type { ModelInfo, ProviderType } from "./catalog";

export type AgentType = "opencode" | "claude" | "codex";

export type BackendType = AgentType | "chat";

export type ProviderOrigin =
  | {
      kind: "byok";
      catalogProviderId?: string;
    }
  | { kind: "agent"; agentType: AgentType }
  | { kind: "copilot-plus" };

export interface Provider {
  providerId: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl?: string;
  enableCors?: boolean;
  apiKeyKeychainId?: string | null;
  requiresApiKey?: boolean;
  extras?: Record<string, unknown>;
  origin: ProviderOrigin;
  addedAt: number;
}

export interface ConfiguredModel {
  configuredModelId: string;
  providerId: string;
  info: ModelInfo;
  configuredAt: number;
}

export interface BackendDefaultModel {
  configuredModelId: string;
  effort?: string | null;
}

export interface BackendConfig {
  enabledModels: string[];
  default?: BackendDefaultModel;
}

export interface PersistedCopilotPlusCatalog {
  models: ModelInfo[];
  defaultEnabledIds: string[];
}
