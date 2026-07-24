jest.mock("@/aiParams", () => ({
  flushIndexingCount: jest.fn(),
  getIndexingProgressState: jest.fn(() => ({ isCancelled: false, isPaused: false })),
  resetIndexingProgressState: jest.fn(),
  setIndexingProgressState: jest.fn(),
  throttledUpdateIndexingCount: jest.fn(),
  updateIndexingProgressState: jest.fn(),
}));

jest.mock("@/LLMProviders/embeddingManager", () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    getModelName: jest.fn(() => "nomic-embed-text-v1.5"),
  }),
}));

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));
jest.mock("@/rateLimiter", () => ({ RateLimiter: jest.fn() }));
jest.mock("@/search/v3/chunks", () => ({ getSharedChunkManager: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    enableSemanticSearchV3: true,
    embeddingRequestsPerMin: 60,
    embeddingBatchSize: 1,
  })),
  subscribeToSettingsChange: jest.fn(),
}));
jest.mock("@/utils", () => ({ formatDateTime: jest.fn() }));
jest.mock("@/utils/hash", () => ({ md5: jest.fn(() => "doc-id") }));
jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(),
  shouldIndexFile: jest.fn(),
}));
jest.mock("obsidian", () => ({ Notice: jest.fn(), TFile: jest.fn() }));

import { IndexOperations } from "./indexOperations";

describe("IndexOperations embedding model identity", () => {
  it("writes the manager identity into prepared local index documents", async () => {
    const embeddingInstance = { modelName: "nomic-embed-text-v1.5" };
    const identity = "embedding-config:nomic-embed-text-v1.5|dimensions=1024";
    const embeddingsManager = {
      getEmbeddingsAPI: jest.fn().mockResolvedValue(embeddingInstance),
      getEmbeddingModelIdentity: jest.fn().mockReturnValue(identity),
    };
    const operation = Object.create(IndexOperations.prototype) as {
      embeddingsManager: typeof embeddingsManager;
      indexBackend: Record<string, jest.Mock>;
      getFilesToIndex: jest.Mock;
      prepareAllChunks: jest.Mock;
    };

    operation.embeddingsManager = embeddingsManager;
    operation.indexBackend = {
      requiresEmbeddings: jest.fn(() => true),
      checkAndHandleEmbeddingModelChange: jest.fn().mockResolvedValue(false),
      garbageCollect: jest.fn().mockResolvedValue(undefined),
      clearFilesMissingEmbeddings: jest.fn(),
    };
    operation.getFilesToIndex = jest.fn().mockResolvedValue([{}]);
    operation.prepareAllChunks = jest.fn().mockResolvedValue([]);

    await IndexOperations.prototype.indexVaultToVectorStore.call(operation);

    expect(embeddingsManager.getEmbeddingModelIdentity).toHaveBeenCalledWith(embeddingInstance);
    expect(operation.prepareAllChunks).toHaveBeenCalledWith([{}], identity);
  });

  it("clears only the local index and forces a full rebuild when dimensions change", async () => {
    const embeddingInstance = { modelName: "nomic-embed-text-v1.5" };
    const embeddingsManager = {
      getEmbeddingsAPI: jest.fn().mockResolvedValue(embeddingInstance),
      getEmbeddingModelIdentity: jest
        .fn()
        .mockReturnValue("embedding-config:nomic-embed-text-v1.5|dimensions=1024"),
    };
    const vault = {
      delete: jest.fn(),
      adapter: { remove: jest.fn() },
    };
    const operation = Object.create(IndexOperations.prototype) as {
      app: { vault: typeof vault };
      embeddingsManager: typeof embeddingsManager;
      indexBackend: Record<string, jest.Mock>;
      getFilesToIndex: jest.Mock;
      prepareAllChunks: jest.Mock;
    };

    operation.app = { vault };
    operation.embeddingsManager = embeddingsManager;
    operation.indexBackend = {
      requiresEmbeddings: jest.fn(() => true),
      checkAndHandleEmbeddingModelChange: jest.fn().mockResolvedValue(true),
      clearIndex: jest.fn().mockResolvedValue(undefined),
      clearFilesMissingEmbeddings: jest.fn(),
    };
    operation.getFilesToIndex = jest.fn().mockResolvedValue([{}]);
    operation.prepareAllChunks = jest.fn().mockResolvedValue([]);

    await IndexOperations.prototype.indexVaultToVectorStore.call(operation);

    expect(operation.indexBackend.clearIndex).toHaveBeenCalledWith(embeddingInstance);
    expect(operation.getFilesToIndex).toHaveBeenCalledWith(true);
    expect(vault.delete).not.toHaveBeenCalled();
    expect(vault.adapter.remove).not.toHaveBeenCalled();
  });
});
