import { looksLikeEmbeddingModel } from "@/modelManagement/catalog/catalogTransform";
import type { ModelInfo } from "@/modelManagement/types/catalog";

export const BYOK_EMBEDDING_ERROR =
  "Embedding models aren’t supported in BYOK. Choose a chat model.";

/** Recognize embeddings from metadata or the existing provider-ID heuristic. */
export function isEmbeddingModel(info: ModelInfo): boolean {
  // Explicit false metadata must not admit an embedding-named model into chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/386
  return info.isEmbedding === true || looksLikeEmbeddingModel(info.id);
}

/** Reject the whole batch before BYOK setup can write credentials or model rows. */
export function assertByokChatModels(models: readonly ModelInfo[]): void {
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/386
  if (models.some(isEmbeddingModel)) throw new Error(BYOK_EMBEDDING_ERROR);
}
