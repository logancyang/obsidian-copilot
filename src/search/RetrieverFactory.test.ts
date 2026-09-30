import { getSearchBackend } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import type { App } from "obsidian";

const miyoRetriever = { getRelevantDocuments: jest.fn() };

jest.mock("@/miyo/miyoUtils", () => ({
  getSearchBackend: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));
jest.mock("@/search/miyo/MiyoSemanticRetriever", () => ({
  MiyoSemanticRetriever: jest.fn().mockImplementation(() => miyoRetriever),
}));
jest.mock("@/search/v3/TieredLexicalRetriever", () => ({
  TieredLexicalRetriever: jest.fn(),
}));

import { MiyoSemanticRetriever } from "@/search/miyo/MiyoSemanticRetriever";
import { RetrieverFactory } from "@/search/RetrieverFactory";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";

const app = {} as App;
const options = { maxK: 8 };

describe("RetrieverFactory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(getSettings)
      .mockReturnValue({ enableMiyo: false } as ReturnType<typeof getSettings>);
    jest.mocked(getSearchBackend).mockReturnValue("keyword");
  });

  describe("RetrieverFactory", () => {
    describe("createRetriever()", () => {
      it("returns the Miyo retriever as semantic when Miyo is the active search backend", async () => {
        jest.mocked(getSearchBackend).mockReturnValue("miyo");

        const result = await RetrieverFactory.createRetriever(app, options);

        expect(result).toEqual({
          retriever: miyoRetriever,
          type: "semantic",
          reason: "Miyo search is enabled",
        });
      });

      it("returns the tiered lexical retriever as lexical when Miyo is not the search backend", async () => {
        const result = await RetrieverFactory.createRetriever(app, options);

        expect(result.type).toBe("lexical");
        expect(result.reason).toBe("Default lexical search");
        expect(result.retriever).toBeInstanceOf(TieredLexicalRetriever);
      });
    });

    describe("getRetrieverType()", () => {
      it("reports semantic when Miyo is the search backend", () => {
        jest.mocked(getSearchBackend).mockReturnValue("miyo");

        expect(RetrieverFactory.getRetrieverType()).toBe("semantic");
      });

      it("reports lexical when Miyo is not the search backend", () => {
        expect(RetrieverFactory.getRetrieverType()).toBe("lexical");
      });
    });

    describe("isMiyoActive()", () => {
      it.each([
        [true, "miyo"],
        [false, "keyword"],
      ] as const)("returns %s for the %s search backend", (expected, backend) => {
        jest.mocked(getSearchBackend).mockReturnValue(backend);

        expect(RetrieverFactory.isMiyoActive()).toBe(expected);
      });
    });

    describe("createMiyoRetriever()", () => {
      it("fills option defaults before constructing the Miyo retriever", () => {
        expect(RetrieverFactory.createMiyoRetriever(app, options)).toBe(miyoRetriever);
        expect(MiyoSemanticRetriever).toHaveBeenCalledWith(app, {
          minSimilarityScore: 0.1,
          maxK: 8,
          salientTerms: [],
          timeRange: undefined,
          textWeight: undefined,
          returnAll: false,
          useRerankerThreshold: undefined,
          tagTerms: [],
        });
      });
    });

    describe("createLexicalRetriever()", () => {
      it("fills option defaults before constructing the tiered lexical retriever", () => {
        RetrieverFactory.createLexicalRetriever(app, { maxK: 8, salientTerms: ["alpha"] });

        expect(TieredLexicalRetriever).toHaveBeenCalledWith(
          app,
          expect.objectContaining({
            maxK: 8,
            minSimilarityScore: 0.1,
            salientTerms: ["alpha"],
            returnAll: false,
            tagTerms: [],
          })
        );
      });
    });
  });
});
