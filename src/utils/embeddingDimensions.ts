/** Prefix used to distinguish dimension-specific embedding model identities. */
export const EMBEDDING_MODEL_IDENTITY_PREFIX = "embedding-config:";

/**
 * Returns dimensions only when the value is a finite positive integer.
 *
 * @param value - The candidate embedding dimensions value.
 * @returns The validated dimensions, or undefined when the value is invalid.
 */
export function getValidEmbeddingDimensions(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isInteger(value)
    ? value
    : undefined;
}

/**
 * Builds an internal model identity that includes valid embedding dimensions.
 *
 * @param modelName - The configured embedding model name.
 * @param dimensions - The candidate embedding dimensions value.
 * @returns The original model name when dimensions are invalid, otherwise a dimension-specific identity.
 */
export function getEmbeddingModelIdentity(modelName: string, dimensions: unknown): string {
  const validDimensions = getValidEmbeddingDimensions(dimensions);
  if (validDimensions === undefined) {
    return modelName;
  }

  return `${EMBEDDING_MODEL_IDENTITY_PREFIX}${encodeURIComponent(modelName)}|dimensions=${validDimensions}`;
}
