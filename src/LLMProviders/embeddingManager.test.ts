import { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import { getEmbeddingModelIdentity } from "@/utils/embeddingDimensions";
import type { Embeddings } from "@langchain/core/embeddings";

const settings = {
  activeEmbeddingModels: [] as CustomModel[],
  embeddingBatchSize: 16,
  embeddingModelKey: "",
};

const openAIEmbeddingsInstances: Array<{ config: Record<string, unknown>; embedQuery: jest.Mock }> =
  [];
let nextEmbeddingVector: number[] = [0];

jest.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: class {
    config: Record<string, unknown>;
    embedQuery = jest.fn(async () => nextEmbeddingVector);

    constructor(config: Record<string, unknown>) {
      this.config = config;
      openAIEmbeddingsInstances.push(this);
    }
  },
  AzureOpenAIEmbeddings: class {},
}));

jest.mock("@langchain/google-genai", () => ({ GoogleGenerativeAIEmbeddings: class {} }));
jest.mock("@langchain/ollama", () => ({ OllamaEmbeddings: class {} }));
jest.mock("./CustomJinaEmbeddings", () => ({ CustomJinaEmbeddings: class {} }));
jest.mock("./CustomOpenAIEmbeddings", () => ({ CustomOpenAIEmbeddings: class {} }));
jest.mock("./brevilabsClient", () => ({
  BrevilabsClient: { getInstance: jest.fn() },
}));
jest.mock("@/settings/model", () => ({
  getSettings: () => settings,
  getModelKeyFromModel: (model: CustomModel) => `${model.name}|${model.provider}`,
  subscribeToSettingsChange: jest.fn(),
}));
jest.mock("@/encryptionService", () => ({ getDecryptedKey: async (key: string) => key }));
jest.mock("@/utils", () => ({
  err2String: (error: unknown) => String(error),
  safeFetch: jest.fn(),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn() }));
jest.mock("obsidian", () => ({ Notice: jest.fn() }));

import EmbeddingManager from "./embeddingManager";

interface EmbeddingManagerInternals {
  activeEmbeddingModels: CustomModel[];
  getEmbeddingConfig(model: CustomModel): Promise<Record<string, unknown>>;
}

/** Creates an isolated manager without singleton settings subscriptions. */
function createManager(models: CustomModel[] = []): EmbeddingManager {
  const manager = Object.create(EmbeddingManager.prototype) as EmbeddingManager;
  (manager as unknown as EmbeddingManagerInternals).activeEmbeddingModels = models;
  return manager;
}

/** Creates the smallest valid custom embedding model for the test under consideration. */
function createModel(
  provider: EmbeddingModelProviders,
  dimensions?: number,
  name = "test-embedding-model"
): CustomModel {
  return {
    name,
    provider,
    enabled: true,
    isEmbeddingModel: true,
    apiKey: "test-api-key",
    dimensions,
  };
}

/** Obtains the private configuration method to assert the provider constructor input. */
function getEmbeddingConfig(manager: EmbeddingManager, model: CustomModel) {
  // The configuration is intentionally private; this assertion verifies its externally observable
  // constructor input without adding a production-only test API.
  return (manager as unknown as EmbeddingManagerInternals).getEmbeddingConfig(model);
}

describe("EmbeddingManager OpenAI-compatible dimensions", () => {
  beforeEach(() => {
    settings.activeEmbeddingModels = [];
    settings.embeddingModelKey = "";
    nextEmbeddingVector = [0];
    openAIEmbeddingsInstances.length = 0;
    jest.clearAllMocks();
  });

  it.each([512, 1024])(
    "passes valid dimensions %d to the OpenAI-compatible embedding constructor",
    async (dimensions) => {
      const config = await getEmbeddingConfig(
        createManager(),
        createModel(EmbeddingModelProviders.OPENAI_FORMAT, dimensions)
      );

      expect(config).toEqual(expect.objectContaining({ dimensions }));
    }
  );

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "omits invalid OpenAI-compatible dimensions: %p",
    async (dimensions) => {
      const config = await getEmbeddingConfig(
        createManager(),
        createModel(EmbeddingModelProviders.OPENAI_FORMAT, dimensions)
      );

      expect(config).not.toHaveProperty("dimensions");
    }
  );

  it.each([
    EmbeddingModelProviders.OPENAI,
    EmbeddingModelProviders.OLLAMA,
    EmbeddingModelProviders.LM_STUDIO,
    EmbeddingModelProviders.AZURE_OPENAI,
    EmbeddingModelProviders.SILICONFLOW,
    EmbeddingModelProviders.OPENROUTERAI,
  ])("does not pass dimensions to %s", async (provider) => {
    const config = await getEmbeddingConfig(createManager(), createModel(provider, 512));

    expect(config).not.toHaveProperty("dimensions");
  });

  it("preserves dimensions for the existing Copilot Plus Jina provider", async () => {
    const config = await getEmbeddingConfig(
      createManager(),
      createModel(EmbeddingModelProviders.COPILOT_PLUS_JINA, 512)
    );

    expect(config).toEqual(expect.objectContaining({ dimensions: 512 }));
  });

  it("accepts a matching vector length when pinging a dimensioned OpenAI-compatible model", async () => {
    const model = createModel(EmbeddingModelProviders.OPENAI_FORMAT, 512);
    nextEmbeddingVector = Array.from({ length: 512 }, () => 0);

    await expect(createManager().ping(model)).resolves.toBe(true);
    expect(openAIEmbeddingsInstances[0].config).toEqual(
      expect.objectContaining({ dimensions: 512 })
    );
    expect(openAIEmbeddingsInstances[0].embedQuery).toHaveBeenCalledWith("test");
  });

  it("reports the configured and returned dimensions when ping receives a mismatched vector", async () => {
    const model = createModel(EmbeddingModelProviders.OPENAI_FORMAT, 512);
    nextEmbeddingVector = Array.from({ length: 1024 }, () => 0);

    await expect(createManager().ping(model)).rejects.toThrow(
      "Embedding dimension mismatch: configured 512, but the provider returned 1024."
    );
    expect(openAIEmbeddingsInstances).toHaveLength(1);
  });

  it("does not enforce a vector length when OpenAI-compatible dimensions are not configured", async () => {
    const model = createModel(EmbeddingModelProviders.OPENAI_FORMAT);
    nextEmbeddingVector = Array.from({ length: 1024 }, () => 0);

    await expect(createManager().ping(model)).resolves.toBe(true);
  });

  it("does not enforce a vector length when OpenAI-compatible dimensions are invalid", async () => {
    const model = createModel(EmbeddingModelProviders.OPENAI_FORMAT, 0);
    nextEmbeddingVector = Array.from({ length: 1024 }, () => 0);

    await expect(createManager().ping(model)).resolves.toBe(true);
  });

  it("uses dimensions in the current embedding identity without changing legacy identities", () => {
    const embeddingsInstance = { modelName: "test-embedding-model" } as unknown as Embeddings;
    const legacyModel = createModel(EmbeddingModelProviders.OPENAI_FORMAT);
    const model512 = createModel(EmbeddingModelProviders.OPENAI_FORMAT, 512);
    const model1024 = createModel(EmbeddingModelProviders.OPENAI_FORMAT, 1024);

    settings.embeddingModelKey = "test-embedding-model|3rd party (openai-format)";

    const legacyIdentity = createManager([legacyModel]).getEmbeddingModelIdentity(
      embeddingsInstance
    );
    const identity512 = createManager([model512]).getEmbeddingModelIdentity(embeddingsInstance);
    const identity1024 = createManager([model1024]).getEmbeddingModelIdentity(embeddingsInstance);

    expect(legacyIdentity).toBe("test-embedding-model");
    expect(identity512).toBe(getEmbeddingModelIdentity("test-embedding-model", 512));
    expect(identity1024).toBe(getEmbeddingModelIdentity("test-embedding-model", 1024));
    expect(identity512).not.toBe(legacyIdentity);
    expect(identity1024).not.toBe(identity512);
  });

  it("keeps the legacy identity for providers that do not support configurable dimensions", () => {
    const model = createModel(EmbeddingModelProviders.COPILOT_PLUS_JINA, 512);
    settings.embeddingModelKey = `test-embedding-model|${EmbeddingModelProviders.COPILOT_PLUS_JINA}`;

    const identity = createManager([model]).getEmbeddingModelIdentity({
      model: "test-embedding-model",
    } as unknown as Embeddings);

    expect(identity).toBe("test-embedding-model");
  });

  it("uses encoded shared identities for selected model names containing dimensions delimiters", () => {
    const firstModelName = "test|dimensions=512";
    const secondModelName = "test|dimensions=1024";
    const firstModel = createModel(EmbeddingModelProviders.OPENAI_FORMAT, 512, firstModelName);
    const secondModel = createModel(EmbeddingModelProviders.OPENAI_FORMAT, 512, secondModelName);

    settings.embeddingModelKey = `${firstModelName}|${EmbeddingModelProviders.OPENAI_FORMAT}`;
    const firstIdentity = createManager([firstModel]).getEmbeddingModelIdentity({
      modelName: firstModelName,
    } as unknown as Embeddings);
    settings.embeddingModelKey = `${secondModelName}|${EmbeddingModelProviders.OPENAI_FORMAT}`;
    const secondIdentity = createManager([secondModel]).getEmbeddingModelIdentity({
      modelName: secondModelName,
    } as unknown as Embeddings);

    expect(firstIdentity).toBe(getEmbeddingModelIdentity(firstModelName, 512));
    expect(firstIdentity).toBe("embedding-config:test%7Cdimensions%3D512|dimensions=512");
    expect(firstIdentity).not.toBe(secondIdentity);
  });
});
