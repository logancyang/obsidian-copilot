const getEmbeddingModelIdentity = jest.fn(
  () => "embedding-config:nomic-embed-text-v1.5|dimensions=1024"
);
const search = jest.fn().mockResolvedValue({
  hits: [
    {
      document: {
        embeddingModel: "embedding-config:nomic-embed-text-v1.5|dimensions=512",
      },
    },
  ],
});

jest.mock("@/LLMProviders/embeddingManager", () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    getInstance: jest.fn(() => ({ getEmbeddingModelIdentity })),
  }),
}));
jest.mock("@/error", () => ({ CustomError: Error }));
jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  subscribeToSettingsChange: jest.fn(),
}));
jest.mock("@/utils/hash", () => ({ md5: jest.fn() }));
jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(),
  getVectorLength: jest.fn(),
  shouldIndexFile: jest.fn(),
}));
jest.mock("@/search/chunkedStorage", () => ({ ChunkedStorage: jest.fn() }));
jest.mock("@orama/orama", () => ({
  create: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  removeMultiple: jest.fn(),
  search,
}));
jest.mock("obsidian", () => ({
  App: jest.fn(),
  MarkdownView: jest.fn(),
  Notice: jest.fn(),
  Platform: {},
  TFile: jest.fn(),
  Vault: jest.fn(),
  normalizePath: jest.fn(),
  requestUrl: jest.fn(),
}));

import { DBOperations } from "./dbOperations";

describe("DBOperations configured embedding identity changes", () => {
  it("rebuilds when the persisted 512-dimensional identity differs from the current 1024-dimensional identity", async () => {
    const embeddingInstance = { modelName: "nomic-embed-text-v1.5" };
    const replacementDb = {};
    const dbOperations = Object.create(DBOperations.prototype) as {
      oramaDb: object;
      createNewDb: jest.Mock;
      saveDB: jest.Mock;
    };
    dbOperations.oramaDb = {};
    dbOperations.createNewDb = jest.fn().mockResolvedValue(replacementDb);
    dbOperations.saveDB = jest.fn().mockResolvedValue(undefined);

    const changed = (await DBOperations.prototype.checkAndHandleEmbeddingModelChange.call(
      dbOperations,
      embeddingInstance
    )) as boolean;

    expect(getEmbeddingModelIdentity).toHaveBeenCalledWith(embeddingInstance);
    expect(search).toHaveBeenCalledWith(dbOperations.oramaDb, { term: "", limit: 1 });
    expect(dbOperations.createNewDb).toHaveBeenCalledWith(embeddingInstance);
    expect(dbOperations.saveDB).toHaveBeenCalledTimes(1);
    expect(changed).toBe(true);
  });
});
