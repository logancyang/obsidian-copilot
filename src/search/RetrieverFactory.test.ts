import { getSearchBackend } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import type { App } from "obsidian";

const miyoRetriever = { getRelevantDocuments: jest.fn() };
const lexicalRetriever = { getRelevantDocuments: jest.fn() };

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
  TieredLexicalRetriever: jest.fn().mockImplementation(() => lexicalRetriever),
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
      it("creates a Miyo retriever when Miyo is the active search backend", async () => {
        jest.mocked(getSearchBackend).mockReturnValue("miyo");

        const result = await RetrieverFactory.createRetriever(app, options);

        expect(result).toEqual({
          retriever: miyoRetriever,
          type: "semantic",
          reason: "Miyo search is enabled",
        });
      });

      it("uses lexical search when Miyo is not the active backend", async () => {
        const result = await RetrieverFactory.createRetriever(app, options);

        expect(result).toEqual({
          retriever: lexicalRetriever,
          type: "lexical",
          reason: "Default lexical search",
        });
        expect(TieredLexicalRetriever).toHaveBeenCalledWith(app, {
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
      it("creates the lexical retriever with normalized options", () => {
        expect(RetrieverFactory.createLexicalRetriever(app, options)).toBe(lexicalRetriever);
        expect(TieredLexicalRetriever).toHaveBeenCalledTimes(1);
      });
    });

    describe("getRetrieverType()", () => {
      it("reports semantic only for Miyo and lexical otherwise", () => {
        jest.mocked(getSearchBackend).mockReturnValueOnce("miyo").mockReturnValueOnce("keyword");

        expect(RetrieverFactory.getRetrieverType()).toBe("semantic");
        expect(RetrieverFactory.getRetrieverType()).toBe("lexical");
      });
    });

    describe("isMiyoActive()", () => {
      it("reports whether live settings select Miyo", () => {
        jest.mocked(getSearchBackend).mockReturnValue("miyo");

        expect(RetrieverFactory.isMiyoActive()).toBe(true);
      });
    });

    describe("createMiyoRetriever()", () => {
      it("creates the Miyo retriever with normalized options", () => {
        expect(RetrieverFactory.createMiyoRetriever(app, options)).toBe(miyoRetriever);
        expect(MiyoSemanticRetriever).toHaveBeenCalledTimes(1);
      });
    });
  });
});
