export interface EmbeddingModelUpdateOptions {
  isEmbeddingModel: boolean;
  isSelectedModel: boolean;
  currentDimensions?: number;
  updatedDimensions?: number;
  semanticSearchEnabled: boolean;
  persist: () => void;
  confirmRebuild: (onConfirm: () => Promise<void>) => void;
  rebuildIndex: () => Promise<void>;
  notifySearchDisabled: () => void;
}

/**
 * Applies an edited model immediately or behind a confirmed semantic-index rebuild.
 *
 * @param options - Current model state and UI-independent update callbacks.
 */
export function applyEmbeddingModelUpdate(options: EmbeddingModelUpdateOptions): void {
  const dimensionsChanged =
    options.isEmbeddingModel &&
    options.isSelectedModel &&
    options.currentDimensions !== options.updatedDimensions;

  if (!dimensionsChanged) {
    options.persist();
    return;
  }

  if (!options.semanticSearchEnabled) {
    options.persist();
    options.notifySearchDisabled();
    return;
  }

  options.confirmRebuild(async () => {
    options.persist();
    await options.rebuildIndex();
  });
}
