import { getMiyoSourceId } from "@/miyo/miyoUtils";
import { MiyoSemanticRetriever } from "@/search/miyo/MiyoSemanticRetriever";
import { getSettings } from "@/settings/model";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";

const mockResolveBaseUrl = jest.fn();
const mockSearch = jest.fn();
const mockGetDocumentsByPath = jest.fn();

jest.mock("@/logger");
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoSourceId: jest.fn(),
}));
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({
    resolveBaseUrl: mockResolveBaseUrl,
    search: mockSearch,
    getDocumentsByPath: mockGetDocumentsByPath,
  })),
}));

/**
 * Create a Miyo semantic retriever configured for tests.
 *
 * @param options - Optional overrides for retriever options.
 * @returns Configured retriever instance.
 */
function createRetriever(
  options: Partial<ConstructorParameters<typeof MiyoSemanticRetriever>[1]> = {}
) {
  return new MiyoSemanticRetriever({ vault: {}, metadataCache: {} } as any, {
    maxK: 10,
    salientTerms: [],
    minSimilarityScore: 0.2,
    ...options,
  });
}

describe("MiyoSemanticRetriever", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSettings as jest.Mock).mockReturnValue({
      selfHostUrl: "http://miyo.local",
      debug: false,
    });
    (getMiyoSourceId as jest.Mock).mockReturnValue("vault-source");
    mockResolveBaseUrl.mockResolvedValue("http://miyo.local");
  });

  it("deduplicates semantic chunks and does not perform explicit path reads", async () => {
    mockSearch.mockResolvedValue({
      results: [
        {
          id: "doc-1",
          score: 0.9,
          path: "notes/a.md",
          chunk_index: 0,
          chunk_text: "A chunk",
        },
        {
          id: "doc-1-dup",
          score: 0.85,
          path: "notes/a.md",
          chunk_index: 0,
          chunk_text: "A duplicated chunk",
        },
        {
          id: "doc-2",
          score: 0.1,
          path: "notes/b.md",
          chunk_index: 0,
          chunk_text: "Below threshold chunk",
        },
        {
          id: "doc-3",
          score: Number.NaN,
          path: "notes/c.md",
          chunk_index: 1,
          chunk_text: "NaN score chunk should pass",
        },
      ],
    });

    const retriever = createRetriever();
    const documents = await retriever.getRelevantDocuments("query with [[notes/a]] mention");

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "vault-source",
      "query with [[notes/a]] mention",
      10,
      undefined
    );
    expect(mockGetDocumentsByPath).not.toHaveBeenCalled();

    expect(documents).toHaveLength(2);
    expect(documents[0].metadata.path).toBe("notes/a.md");
    expect(documents[0].metadata.chunkId).toBe("notes/a.md#0");
    expect(documents[0].pageContent).toBe("A chunk");
    expect(documents[1].metadata.path).toBe("notes/c.md");
  });

  it("passes time-range filters to Miyo search", async () => {
    mockSearch.mockResolvedValue({ results: [] });

    const startTime = 1700000000000;
    const endTime = 1700600000000;
    const retriever = createRetriever({
      timeRange: { startTime, endTime },
    });

    await retriever.getRelevantDocuments("show notes from this week");

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "vault-source",
      "show notes from this week",
      10,
      [{ field: "mtime", gte: startTime, lte: endTime }]
    );
    expect(mockGetDocumentsByPath).not.toHaveBeenCalled();
  });

  it("uses return-all limit when returnAll is enabled", async () => {
    mockSearch.mockResolvedValue({ results: [] });

    const retriever = createRetriever({
      returnAll: true,
      maxK: 5,
    });

    await retriever.getRelevantDocuments("list all notes about ai digests");

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "vault-source",
      "list all notes about ai digests",
      RETURN_ALL_LIMIT,
      undefined
    );
  });
});
