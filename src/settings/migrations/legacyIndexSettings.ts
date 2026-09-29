// Settings that existed only for the removed embedding and index runtime:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/283
const LEGACY_INDEX_SETTING_FIELDS = [
  "enableSemanticSearchV3",
  "embeddingModelKey",
  "activeEmbeddingModels",
  "embeddingRequestsPerMin",
  "embeddingBatchSize",
  "numPartitions",
  "enableIndexSync",
  "disableIndexOnMobile",
  "indexVaultToVectorStore",
  "openAIEmbeddingProxyBaseUrl",
  "azureOpenAIApiEmbeddingDeploymentName",
] as const;

export function stripLegacyIndexSettings<T extends object>(settings: T): T {
  const cleaned = { ...settings } as T & Record<string, unknown>;
  for (const field of LEGACY_INDEX_SETTING_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}
