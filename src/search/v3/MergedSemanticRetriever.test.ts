import { Document } from "@langchain/core/documents";
import { MergedSemanticRetriever } from "./MergedSemanticRetriever";
import { TieredLexicalRetriever } from "./TieredLexicalRetriever";
import { HybridRetriever } from "@/search/hybridRetriever";

const optionsSpy: {
  lexicalOptions?: Record<string, any>;
  semanticOptions?: Record<string, any>;
} = {};

let lexicalResults: Document[] = [];
let semanticResults: Document[] = [];

jest.mock("@/search/v3/TieredLexicalRetriever", () => {
  return {
    TieredLexicalRetriever: jest.fn().mockImplementation((_app: any, options: any) => {
      optionsSpy.lexicalOptions = options;
      return {
        getRelevantDocuments: jest.fn(async () => lexicalResults),
      };
    }),
  };
});

jest.mock("@/search/hybridRetriever", () => {
  return {
    HybridRetriever: jest.fn().mockImplementation((options: any) => {
      optionsSpy.semanticOptions = options;
      return {
        getRelevantDocuments: jest.fn(async () => semanticResults),
      };
    }),
  };
});

describe("MergedSemanticRetriever", () => {
  const mockApp = {} as any;

  beforeEach(() => {
    lexicalResults = [];
    semanticResults = [];
    optionsSpy.lexicalOptions = undefined;
    optionsSpy.semanticOptions = undefined;
    (TieredLexicalRetriever as unknown as jest.Mock).mockClear();
    (HybridRetriever as unknown as jest.Mock).mockClear();
  });

  it("merges semantic and lexical results with lexical priority on duplicates", async () => {
    const lexicalInput = new Document({
      pageContent: "Lexical chunk",
      metadata: {
        chunkId: "note.md#0",
        score: 0.8,
        rerank_score: 0.8,
        explanation: { lexicalMatches: [{ field: "tags" }] },
      },
    });
    const semanticInput = new Document({
      pageContent: "Lexical chunk",
      metadata: {
        chunkId: "note.md#0",
        score: 0.9,
        rerank_score: 0.9,
      },
    });

    lexicalResults = [lexicalInput];
    semanticResults = [semanticInput];

    const retriever = new MergedSemanticRetriever(mockApp, {
      maxK: 5,
      salientTerms: [],
    });

    const results = await retriever.getRelevantDocuments("query");

    expect(results).toHaveLength(1);
    expect(results[0].metadata.source).toBe("lexical");
    expect(results[0].metadata.chunkId).toBe("note.md#0");
  });

  it("retains unique semantic results with blended scoring", async () => {
    const lexicalInput = new Document({
      pageContent: "Lexical",
      metadata: {
        chunkId: "note.md#0",
        score: 0.7,
        rerank_score: 0.7,
        explanation: { lexicalMatches: [{ field: "tags" }] },
      },
    });
    const semanticInput = new Document({
      pageContent: "Semantic",
      metadata: {
        chunkId: "note.md#1",
        score: 0.9,
        rerank_score: 0.9,
      },
    });

    lexicalResults = [lexicalInput];
    semanticResults = [semanticInput];

    const retriever = new MergedSemanticRetriever(mockApp, {
      maxK: 5,
      salientTerms: [],
    });

    const results = await retriever.getRelevantDocuments("query");

    expect(results).toHaveLength(2);

    const lexicalHit = results.find((doc) => doc.metadata.source === "lexical");
    const semanticHit = results.find((doc) => doc.metadata.source === "semantic");

    expect(lexicalHit).toBeDefined();
    expect(semanticHit).toBeDefined();

    expect(lexicalHit?.metadata.score).toBeCloseTo(0.77, 2); // lexical score with tag bonus
    expect(semanticHit?.metadata.score).toBeCloseTo(0.9, 2); // semantic score untouched
  });

  it("respects RETURN_ALL_LIMIT when returnAll is enabled", async () => {
    lexicalResults = [
      new Document({
        pageContent: "Lexical",
        metadata: {
          chunkId: "note.md#0",
          score: 0.4,
          rerank_score: 0.4,
        },
      }),
    ];
    semanticResults = [
      new Document({
        pageContent: "Semantic",
        metadata: {
          chunkId: "note.md#1",
          score: 0.4,
          rerank_score: 0.4,
        },
      }),
    ];

    const retriever = new MergedSemanticRetriever(mockApp, {
      maxK: 1,
      salientTerms: [],
      returnAll: true,
    });

    const results = await retriever.getRelevantDocuments("query");

    expect(results).toHaveLength(2);
    expect(optionsSpy.lexicalOptions?.maxK).toBe(200);
    expect(optionsSpy.semanticOptions?.maxK).toBe(200);
  });
});
