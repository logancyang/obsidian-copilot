export type ProviderType = "anthropic" | "openai-compatible" | "google";

export interface ModelInfo {
  id: string;
  displayName: string;
  description?: string;
  modalities?: { input?: string[]; output?: string[] };
  limits?: { context?: number; output?: number; input?: number };
  reasoning?: boolean;
  reasoningEfforts?: readonly string[];
  toolCall?: boolean;
  isEmbedding?: boolean;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  releaseDate?: string;
}

export interface CatalogProvider {
  id: string;
  displayName: string;
  defaultBaseUrl?: string;
  providerType: ProviderType;
  models: Record<string, ModelInfo>;
}
