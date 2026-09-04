/**
 * Settings that existed only for the removed embedding and index runtime.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/283
 */
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

/**
 * Return a detached settings object without fields owned by the removed index.
 *
 * This runs on every load and save in addition to the versioned migration so a
 * settings sync from an older Copilot version cannot restore retired keys.
 *
 * @param settings - Settings record to clean without mutating its input.
 */
export function stripLegacyIndexSettings<T extends object>(settings: T): T {
  const cleaned = { ...settings } as T & Record<string, unknown>;
  for (const field of LEGACY_INDEX_SETTING_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}
