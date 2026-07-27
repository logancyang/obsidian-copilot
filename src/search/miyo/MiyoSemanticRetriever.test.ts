import { type App, TFile } from "obsidian";
import { getMiyoFolderName, hasUserQaPatterns, isMiyoScopeMismatch } from "@/miyo/miyoUtils";
import { MiyoSemanticRetriever } from "@/search/miyo/MiyoSemanticRetriever";
import { getSettings } from "@/settings/model";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";

const mockResolveBaseUrl = jest.fn();
const mockSearch = jest.fn();
const mockGetDocumentsByPath = jest.fn();

jest.mock("@/logger");
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  // searchUtils' getSystemExcludedFolders normalizes root paths through the real
  // helper; keep it faithful so the pattern filter behaves as in production.
  normalizeRootFolders:
    jest.requireActual<typeof import("@/settings/model")>("@/settings/model").normalizeRootFolders,
}));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoFolderName: jest.fn(),
  getVaultRelativeMiyoPath: jest.fn((_: unknown, path: string) => path.replace("/vault/", "")),
  // Mirrors the real ownership rule against the mocked "/vault" folder name.
  isCurrentVaultMiyoPath: jest.fn((_: unknown, path: string) => path.startsWith("/vault/")),
  getMiyoCustomUrl: jest.fn().mockReturnValue(""),
  // Default: synced scope, no user patterns — the narrow-limit branch. Tests
  // that exercise the over-fetch branches flip these explicitly.
  hasUserQaPatterns: jest.fn(() => false),
  isMiyoScopeMismatch: jest.fn(() => false),
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
  return new MiyoSemanticRetriever({ vault: {}, metadataCache: {} } as unknown as App, {
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
      miyoServerUrl: "http://miyo.local",
      debug: false,
    });
    (getMiyoFolderName as jest.Mock).mockReturnValue("/vault");
    mockResolveBaseUrl.mockResolvedValue("http://miyo.local");
  });

  it("deduplicates semantic chunks and does not perform explicit path reads", async () => {
    mockSearch.mockResolvedValue({
      results: [
        {
          id: "doc-1",
          score: 0.9,
          path: "/vault/notes/a.md",
          chunk_index: 0,
          chunk_text: "A chunk",
        },
        {
          id: "doc-1-dup",
          score: 0.85,
          path: "/vault/notes/a.md",
          chunk_index: 0,
          chunk_text: "A duplicated chunk",
        },
        {
          id: "doc-2",
          score: 0.1,
          path: "/vault/notes/b.md",
          chunk_index: 0,
          chunk_text: "Below threshold chunk",
        },
        {
          id: "doc-3",
          score: Number.NaN,
          path: "/vault/notes/c.md",
          chunk_index: 1,
          chunk_text: "NaN score chunk should pass",
        },
      ],
    });

    const retriever = createRetriever();
    const documents = await retriever.getRelevantDocuments("query with [[notes/a]] mention");

    // Synced scope + no user patterns: the server already omits everything the
    // local filter would drop, so the request narrows to finalK×2 (dedup
    // margin) instead of the full RETURN_ALL_LIMIT pool.
    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "query with [[notes/a]] mention",
      20,
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
    // Time-range queries are issued with returnAll enabled by callers, so the
    // retriever over-fetches the full candidate pool.
    const retriever = createRetriever({
      timeRange: { startTime, endTime },
      returnAll: true,
    });

    await retriever.getRelevantDocuments("show notes from this week");

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "show notes from this week",
      RETURN_ALL_LIMIT,
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
      "/vault",
      "list all notes about ai digests",
      RETURN_ALL_LIMIT,
      undefined
    );
  });

  it("over-fetches but caps returned chunks to the requested limit when a filter is active", async () => {
    // A user-authored inclusion/exclusion pattern can drop results, so the
    // retriever over-fetches candidates to still fill the requested cap.
    (hasUserQaPatterns as jest.Mock).mockReturnValue(true);
    (getSettings as jest.Mock).mockReturnValue({
      miyoServerUrl: "http://miyo.local",
      debug: false,
      qaExclusions: "private",
    });
    const app = {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: {},
    } as unknown as App;

    mockSearch.mockResolvedValue({
      results: Array.from({ length: 5 }, (_, i) => ({
        id: `doc-${i}`,
        score: 0.9 - i * 0.01,
        path: `/vault/notes/${i}.md`,
        chunk_index: 0,
        chunk_text: `chunk ${i}`,
      })),
    });

    const retriever = new MiyoSemanticRetriever(app, {
      maxK: 2,
      salientTerms: [],
      minSimilarityScore: 0.2,
    });
    const documents = await retriever.getRelevantDocuments("query");

    // Over-fetches the full candidate pool but returns only the top maxK.
    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "query",
      RETURN_ALL_LIMIT,
      undefined
    );
    expect(documents).toHaveLength(2);
    expect(documents.map((doc) => doc.metadata.path as string)).toEqual([
      "notes/0.md",
      "notes/1.md",
    ]);
  });

  it("over-fetches while the Miyo scope is stale", async () => {
    // A stale server-side scope can return system-root content the local filter
    // must drop, so the retriever keeps the expanded pool until the resync
    // receipt is current again.
    (isMiyoScopeMismatch as jest.Mock).mockReturnValue(true);
    mockSearch.mockResolvedValue({ results: [] });

    const retriever = createRetriever({ maxK: 3 });
    await retriever.getRelevantDocuments("query");

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "query",
      RETURN_ALL_LIMIT,
      undefined
    );
  });

  it("filters chunks by Copilot inclusion/exclusion rules", async () => {
    (getSettings as jest.Mock).mockReturnValue({
      miyoServerUrl: "http://miyo.local",
      debug: false,
      qaExclusions: "private",
    });

    const TFileConstructor = TFile as unknown as new (filePath: string) => TFile;
    const filesByPath = new Map<string, TFile>([
      ["notes/keep.md", new TFileConstructor("notes/keep.md")],
      ["private/secret.md", new TFileConstructor("private/secret.md")],
    ]);
    const app = {
      vault: { getAbstractFileByPath: (path: string) => filesByPath.get(path) ?? null },
      metadataCache: {},
    } as unknown as App;

    mockSearch.mockResolvedValue({
      results: [
        {
          id: "keep",
          score: 0.9,
          path: "/vault/notes/keep.md",
          chunk_index: 0,
          chunk_text: "keep",
        },
        {
          id: "secret",
          score: 0.85,
          path: "/vault/private/secret.md",
          chunk_index: 0,
          chunk_text: "secret",
        },
      ],
    });

    const retriever = new MiyoSemanticRetriever(app, { maxK: 10, salientTerms: [] });
    const documents = await retriever.getRelevantDocuments("query");

    expect(documents).toHaveLength(1);
    expect(documents[0].metadata.path).toBe("notes/keep.md");
  });

  it("keeps search-all results from an external folder that shares a system root's name", async () => {
    // Ownership is judged on the RAW path: this vault's results carry the
    // "/vault/" prefix, an external folder carries its own name — even when
    // that name equals the default Copilot root ("copilot"). The external
    // chunk must survive while the vault's own former-root chunk is dropped.
    (getSettings as jest.Mock).mockReturnValue({
      miyoServerUrl: "http://miyo.local",
      debug: false,
      miyoSearchAll: true,
      copilotFolder: "copilot",
    });
    // clearAllMocks does not reset mockReturnValue implementations pinned by
    // earlier tests; re-pin the narrow-limit branch explicitly.
    (hasUserQaPatterns as jest.Mock).mockReturnValue(false);
    (isMiyoScopeMismatch as jest.Mock).mockReturnValue(false);

    mockSearch.mockResolvedValue({
      results: [
        {
          id: "own-old-root",
          score: 0.9,
          path: "/vault/copilot/old-chat.md",
          chunk_index: 0,
          chunk_text: "this vault's excluded copilot data",
        },
        {
          id: "external",
          score: 0.85,
          path: "copilot/notes/foo.md",
          chunk_index: 0,
          chunk_text: "another folder that happens to be named copilot",
        },
      ],
    });

    const retriever = createRetriever();
    const documents = await retriever.getRelevantDocuments("query");

    expect(mockSearch).toHaveBeenCalledWith("http://miyo.local", undefined, "query", 20, undefined);
    expect(documents).toHaveLength(1);
    expect(documents[0].metadata.path).toBe("copilot/notes/foo.md");
    expect(documents[0].metadata.fromCurrentVault).toBe(false);
  });

  it("still applies the system-root filter to unprefixed paths on a folder-scoped query", async () => {
    // A folder-scoped query only returns this vault's content, so ownership is
    // asserted regardless of the raw prefix — a result arriving without the
    // folder prefix must not dodge the privacy filter by looking external.
    (getSettings as jest.Mock).mockReturnValue({
      miyoServerUrl: "http://miyo.local",
      debug: false,
      copilotFolder: "copilot",
    });

    mockSearch.mockResolvedValue({
      results: [
        {
          id: "unprefixed",
          score: 0.9,
          path: "copilot/old-chat.md",
          chunk_index: 0,
          chunk_text: "unprefixed former-root content",
        },
      ],
    });

    const retriever = createRetriever();
    const documents = await retriever.getRelevantDocuments("query");

    expect(documents).toHaveLength(0);
  });
});
