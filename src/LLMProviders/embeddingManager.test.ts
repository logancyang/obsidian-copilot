import type { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import { getModelKeyFromModel, setSettings } from "@/settings/model";
import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import { CustomOpenAIEmbeddings } from "./CustomOpenAIEmbeddings";
import EmbeddingManager from "./embeddingManager";

jest.mock("@langchain/openai", () => ({
  ...jest.requireActual<typeof import("@langchain/openai")>("@langchain/openai"),
  OpenAIEmbeddings: jest.fn(),
}));
jest.mock("@langchain/ollama", () => ({
  ...jest.requireActual<typeof import("@langchain/ollama")>("@langchain/ollama"),
  OllamaEmbeddings: jest.fn(),
}));
jest.mock("./CustomOpenAIEmbeddings", () => ({
  CustomOpenAIEmbeddings: jest.fn(),
}));

describe("embeddingManager", () => {
  describe("EmbeddingManager", () => {
    describe("getEmbeddingsAPI()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
      });

      it.each([
        [EmbeddingModelProviders.OPENAI_FORMAT, OpenAIEmbeddings, { openAIApiKey: "default-key" }],
        [
          EmbeddingModelProviders.LM_STUDIO,
          CustomOpenAIEmbeddings,
          { openAIApiKey: "default-key" },
        ],
        [
          EmbeddingModelProviders.OLLAMA,
          OllamaEmbeddings,
          { headers: { Authorization: "Bearer default-key" } },
        ],
      ])(
        "credentials a keyless %s model with the keyless sentinel instead of an empty key",
        async (provider, EmbeddingConstructor, expectedCredential) => {
          const model: CustomModel = {
            name: "local-embedding-model",
            provider,
            enabled: true,
          };
          setSettings({
            activeEmbeddingModels: [model],
            embeddingModelKey: getModelKeyFromModel(model),
          });

          await EmbeddingManager.getInstance().getEmbeddingsAPI();

          expect(EmbeddingConstructor).toHaveBeenCalledWith(
            expect.objectContaining(expectedCredential)
          );
        }
      );
    });
  });
});
