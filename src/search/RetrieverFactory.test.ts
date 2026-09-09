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
    });

    describe("getRetrieverType()", () => {
      it("reports semantic for Miyo", () => {
        jest.mocked(getSearchBackend).mockReturnValue("miyo");

        expect(RetrieverFactory.getRetrieverType()).toBe("semantic");
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
