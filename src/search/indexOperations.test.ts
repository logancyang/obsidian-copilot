import type EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { IndexOperations } from "@/search/indexOperations";
import type { SemanticIndexBackend } from "@/search/indexBackend/SemanticIndexBackend";
import { App, TFile } from "obsidian";

const settings = {
  enableSemanticSearchV3: true,
  embeddingRequestsPerMin: 60,
  embeddingBatchSize: 1,
};
jest.mock("@/settings/model", () => ({
  getSettings: () => settings,
  subscribeToSettingsChange: () => () => {},
}));

const progress = {
  isActive: false,
  isPaused: false,
  isCancelled: false,
  completionStatus: "none" as string,
};
jest.mock("@/aiParams", () => ({
  getIndexingProgressState: () => progress,
  setIndexingProgressState: (next: Record<string, unknown>) => Object.assign(progress, next),
  updateIndexingProgressState: (next: Record<string, unknown>) => Object.assign(progress, next),
  resetIndexingProgressState: () =>
    Object.assign(progress, { isActive: false, isCancelled: false, completionStatus: "none" }),
  throttledUpdateIndexingCount: () => {},
  flushIndexingCount: () => {},
}));

jest.mock("@/LLMProviders/embeddingManager", () => ({
  __esModule: true,
  default: { getModelName: () => "test-embedding-model" },
}));

const rateLimiterWait = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
jest.mock("@/rateLimiter", () => ({
  RateLimiter: class {
    wait(): Promise<void> {
      return rateLimiterWait();
    }
  },
}));

const getChunks = jest.fn();
jest.mock("@/search/v3/chunks", () => ({ getSharedChunkManager: () => ({ getChunks }) }));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: () => ({ inclusions: null, exclusions: null }),
  shouldIndexFile: () => true,
}));

jest.mock("@/logger", () => ({ logInfo: () => {}, logWarn: () => {}, logError: () => {} }));

const TFileConstructor = TFile as unknown as new (path: string) => TFile;
const files = [new TFileConstructor("one.md"), new TFileConstructor("two.md")];

function buildApp(): App {
  for (const file of files) {
    file.stat = { ctime: 0, mtime: 0, size: 0 };
  }
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path),
    },
    metadataCache: { getFileCache: () => ({}) },
  } as unknown as App;
}

/** An index backend that records nothing but the calls the indexing run makes on it. */
function buildIndexBackend(): jest.Mocked<SemanticIndexBackend> {
  return {
    requiresEmbeddings: () => true,
    checkAndHandleEmbeddingModelChange: jest.fn().mockResolvedValue(false),
    clearIndex: jest.fn().mockResolvedValue(undefined),
    clearFilesMissingEmbeddings: jest.fn(),
    getFilesMissingEmbeddings: () => [],
    markFileMissingEmbeddings: jest.fn(),
    garbageCollect: jest.fn().mockResolvedValue(undefined),
    getIndexedFiles: jest.fn().mockResolvedValue([]),
    getLatestFileMtime: jest.fn().mockResolvedValue(0),
    upsert: jest.fn().mockResolvedValue(undefined),
    upsertBatch: jest.fn().mockResolvedValue(undefined),
    markUnsavedChanges: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    checkIndexIntegrity: jest.fn().mockResolvedValue(undefined),
    removeByPath: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SemanticIndexBackend>;
}

describe("indexOperations", () => {
  describe("IndexOperations", () => {
    let indexBackend: jest.Mocked<SemanticIndexBackend>;
    let embedDocuments: jest.Mock;
    let indexOps: IndexOperations;

    beforeEach(() => {
      rateLimiterWait.mockResolvedValue(undefined);
      settings.enableSemanticSearchV3 = true;
      Object.assign(progress, {
        isActive: false,
        isPaused: false,
        isCancelled: false,
        completionStatus: "none",
      });
      embedDocuments = jest.fn().mockImplementation((texts: string[]) => texts.map(() => [0.1]));
      getChunks.mockImplementation(async (paths: string[]) =>
        paths.map((path, index) => ({
          id: `${path}#0`,
          notePath: path,
          title: path,
          heading: "",
          mtime: index,
          content: `NOTE BLOCK CONTENT:\n\ncontent of ${path}`,
        }))
      );
      indexBackend = buildIndexBackend();
      indexOps = new IndexOperations(buildApp(), indexBackend, {
        getEmbeddingsAPI: async () => ({ embedDocuments }),
      } as unknown as EmbeddingsManager);
    });

    describe("indexVaultToVectorStore()", () => {
      it("indexes every file while the vault index stays enabled", async () => {
        const indexed = await indexOps.indexVaultToVectorStore(true);

        expect(indexed).toBe(2);
        expect(embedDocuments).toHaveBeenCalledTimes(2);
        expect(progress.completionStatus).toBe("success");
      });

      // The run latched the setting at entry, so a vault that was already being indexed kept
      // being embedded after the user turned the switch off
      // (https://github.com/logancyang/obsidian-copilot-preview/issues/319).
      it("stops before the next batch and reports cancelled when the vault index is turned off mid-run (https://github.com/logancyang/obsidian-copilot-preview/issues/319)", async () => {
        embedDocuments.mockImplementationOnce((texts: string[]) => {
          settings.enableSemanticSearchV3 = false;
          return texts.map(() => [0.1]);
        });

        await indexOps.indexVaultToVectorStore(true);

        expect(embedDocuments).toHaveBeenCalledTimes(1);
        expect(progress.completionStatus).toBe("cancelled");
      });

      // A paused run waits for a resume. Turning the vault index off is the user saying that
      // resume is never coming, so the pause loop has to end on it too or the run waits forever
      // (https://github.com/logancyang/obsidian-copilot-preview/issues/319).
      it("ends a paused run when the vault index is turned off, rather than waiting for a resume that is not coming (https://github.com/logancyang/obsidian-copilot-preview/issues/319)", async () => {
        embedDocuments.mockImplementationOnce((texts: string[]) => {
          progress.isPaused = true;
          window.setTimeout(() => {
            settings.enableSemanticSearchV3 = false;
          }, 10);
          return texts.map(() => [0.1]);
        });

        await indexOps.indexVaultToVectorStore(true);

        expect(progress.completionStatus).toBe("cancelled");
      });
    });
  });
});
