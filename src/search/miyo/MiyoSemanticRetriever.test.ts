import { type App, TFile } from "obsidian";
import { getMiyoFolderName } from "@/miyo/miyoUtils";
import { MiyoRequestError } from "@/miyo/MiyoClient";
import { MiyoSemanticRetriever } from "@/search/miyo/MiyoSemanticRetriever";
import { getSettings } from "@/settings/model";

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
}));
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoRequestError:
    jest.requireActual<typeof import("@/miyo/MiyoClient")>("@/miyo/MiyoClient").MiyoRequestError,
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

  it("reports a failed Miyo request instead of returning an empty search result (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
    // A silent [] lets Quick Chat answer as though vault search succeeded with
    // no matches, hiding that enabled Miyo never supplied context.
    mockSearch.mockRejectedValue(new Error("connection refused"));

    await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
      "Miyo is unavailable. Open Miyo, then retry vault search."
    );
  });

  it("reports an unregistered vault as actionable registration guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
    mockSearch.mockRejectedValue(new MiyoRequestError(404, "folder not registered"));

    await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
      "This vault is not registered with Miyo. Register it in Miyo, then retry vault search."
    );
  });

  it("keeps registration guidance out of unrestricted-scope failures (https://github.com/logancyang/obsidian-copilot/pull/3090#discussion_r3926715956)", async () => {
    // An unrestricted search omits the folder, so its 404 says nothing about
    // whether this vault is registered.
    (getSettings as jest.Mock).mockReturnValue({
      miyoServerUrl: "http://miyo.local",
      debug: false,
      miyoSearchAll: true,
    });
    mockSearch.mockRejectedValue(new MiyoRequestError(404, "not found"));

    await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
      "Miyo is unavailable. Open Miyo, then retry vault search."
    );
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

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "query with [[notes/a]] mention",
      1000,
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
      returnAll: true,
    });

    await retriever.getRelevantDocuments("show notes from this week");

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "show notes from this week",
      1000,
      [{ field: "mtime", gte: startTime, lte: endTime }]
    );
    expect(mockGetDocumentsByPath).not.toHaveBeenCalled();
  });

  it("requests Miyo's full candidate pool even with no local QA rules, because Copilot cannot know the server's exclusion scope (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
    mockSearch.mockResolvedValue({ results: [] });

    await createRetriever({ maxK: 5 }).getRelevantDocuments("list all notes about ai digests");

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "list all notes about ai digests",
      1000,
      undefined
    );
  });

  it("over-fetches but caps returned chunks to the requested limit when a filter is active", async () => {
    // A user-authored inclusion/exclusion pattern can drop results, so the
    // retriever over-fetches candidates to still fill the requested cap.
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

    // Over-fetches Miyo's largest exposed candidate pool but returns only maxK.
    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      "/vault",
      "query",
      1000,
      undefined
    );
    expect(documents).toHaveLength(2);
    expect(documents.map((doc) => doc.metadata.path as string)).toEqual([
      "notes/0.md",
      "notes/1.md",
    ]);
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

    expect(mockSearch).toHaveBeenCalledWith(
      "http://miyo.local",
      undefined,
      "query",
      1000,
      undefined
    );
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
