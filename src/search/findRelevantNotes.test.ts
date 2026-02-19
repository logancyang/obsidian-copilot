import { TFile } from "obsidian";
import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { findRelevantNotes } from "@/search/findRelevantNotes";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoSourceId } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import { isSelfHostAccessValid } from "@/plusUtils";
import VectorStoreManager from "@/search/vectorStoreManager";

jest.mock("@/noteUtils", () => ({
  getLinkedNotes: jest.fn(),
  getBacklinkedNotes: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

const mockGetDocumentsByPath = jest.fn();
const mockGetDb = jest.fn();

jest.mock("@/search/vectorStoreManager", () => ({
  __esModule: true,
  default: {
    getInstance: () => ({
      getDocumentsByPath: mockGetDocumentsByPath,
      getDb: mockGetDb,
    }),
  },
}));

const mockGetDocsByEmbedding = jest.fn();

jest.mock("@/search/dbOperations", () => ({
  DBOperations: {
    getDocsByEmbedding: (...args: unknown[]) => mockGetDocsByEmbedding(...args),
  },
}));

const mockResolveBaseUrl = jest.fn();
const mockSearchRelated = jest.fn();

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({
    resolveBaseUrl: (...args: unknown[]) => mockResolveBaseUrl(...args),
    searchRelated: (...args: unknown[]) => mockSearchRelated(...args),
  })),
}));

jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoSourceId: jest.fn(),
}));

jest.mock("@/plusUtils", () => ({
  isSelfHostAccessValid: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

/**
 * Create a markdown file mock with Obsidian's TFile class.
 *
 * @param path - Vault-relative markdown path.
 * @returns Mock TFile instance.
 */
function createMarkdownFile(path: string): TFile {
  const TFileConstructor = TFile as unknown as new (filePath: string) => TFile;
  return new TFileConstructor(path);
}

describe("findRelevantNotes", () => {
  const mockedGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
  const mockedIsSelfHostAccessValid = isSelfHostAccessValid as jest.MockedFunction<
    typeof isSelfHostAccessValid
  >;
  const mockedGetLinkedNotes = getLinkedNotes as jest.MockedFunction<typeof getLinkedNotes>;
  const mockedGetBacklinkedNotes = getBacklinkedNotes as jest.MockedFunction<
    typeof getBacklinkedNotes
  >;
  const mockedGetMiyoSourceId = getMiyoSourceId as jest.MockedFunction<typeof getMiyoSourceId>;
  const mockedVectorStoreManager = VectorStoreManager as unknown as {
    getInstance: () => {
      getDocumentsByPath: jest.Mock;
      getDb: jest.Mock;
    };
  };
  const mockedMiyoClient = MiyoClient as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsSelfHostAccessValid.mockReturnValue(false);
    mockedGetSettings.mockReturnValue({
      debug: false,
      selfHostUrl: "",
      enableMiyo: false,
      enableSemanticSearchV3: false,
      selfHostModeValidatedAt: null,
      selfHostValidationCount: 0,
    } as any);
    mockedGetLinkedNotes.mockReturnValue([]);
    mockedGetBacklinkedNotes.mockReturnValue([]);
    mockedGetMiyoSourceId.mockReturnValue("test-source");

    const source = createMarkdownFile("source.md");
    const first = createMarkdownFile("first.md");
    const second = createMarkdownFile("second.md");
    const alpha = createMarkdownFile("alpha.md");
    const beta = createMarkdownFile("beta.md");
    const linkedOnly = createMarkdownFile("linked-only.md");

    const filesByPath = new Map<string, TFile>([
      ["source.md", source],
      ["first.md", first],
      ["second.md", second],
      ["alpha.md", alpha],
      ["beta.md", beta],
      ["linked-only.md", linkedOnly],
    ]);

    (global.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
      return filesByPath.get(path) ?? null;
    });

    mockedVectorStoreManager
      .getInstance()
      .getDocumentsByPath.mockImplementation(mockGetDocumentsByPath);
    mockedVectorStoreManager.getInstance().getDb.mockImplementation(mockGetDb);
    mockedMiyoClient.mockImplementation(() => ({
      resolveBaseUrl: mockResolveBaseUrl,
      searchRelated: mockSearchRelated,
    }));
  });

  it("uses Orama similarity scoring when source note has embeddings", async () => {
    mockGetDocumentsByPath.mockResolvedValue([
      {
        id: "chunk-1",
        path: "source.md",
        content: "chunk one",
        embedding: [0.1, 0.2],
      },
      {
        id: "chunk-2",
        path: "source.md",
        content: "chunk two",
        embedding: [0.3, 0.4],
      },
    ]);
    mockGetDb.mockResolvedValue({ db: "orama" });
    mockGetDocsByEmbedding
      .mockResolvedValueOnce([
        { score: 0.82, document: { path: "second.md" } },
        { score: 0.5, document: { path: "source.md" } },
      ])
      .mockResolvedValueOnce([
        { score: 0.79, document: { path: "first.md" } },
        { score: 0.66, document: { path: "second.md" } },
      ]);
    mockedGetBacklinkedNotes.mockReturnValue([createMarkdownFile("second.md")]);
    mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

    const result = await findRelevantNotes({ filePath: "source.md" });

    expect(result.map((entry) => entry.document.path)).toEqual([
      "second.md",
      "first.md",
      "linked-only.md",
    ]);
    expect(
      result.find((entry) => entry.document.path === "second.md")?.metadata.similarityScore
    ).toBe(0.82);
    expect(mockGetDb).toHaveBeenCalledTimes(1);
    expect(mockGetDocsByEmbedding).toHaveBeenCalledTimes(2);
    expect(mockSearchRelated).not.toHaveBeenCalled();
  });

  it("uses Miyo when shouldUseMiyoForRelevantNotes is true (enableMiyoSearch=true and valid self-host)", async () => {
    mockedIsSelfHostAccessValid.mockReturnValue(true);
    mockedGetSettings.mockReturnValue({
      debug: false,
      selfHostUrl: "http://127.0.0.1:8742",
      enableMiyo: true,
      enableSemanticSearchV3: true,
    } as any);
    mockGetDocumentsByPath.mockResolvedValue([
      {
        id: "chunk-a",
        path: "source.md",
        content: "source chunk A",
        embedding: [],
      },
      {
        id: "chunk-b",
        path: "source.md",
        content: "source chunk B",
        embedding: [],
      },
    ]);
    mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
    mockSearchRelated.mockResolvedValue({
      results: [
        { id: "self", path: "source.md", score: 0.99, chunk_text: "self" },
        { id: "a-1", path: "alpha.md", score: 0.45, chunk_text: "alpha1" },
        { id: "b-1", path: "beta.md", score: 0.88, chunk_text: "beta" },
        { id: "a-2", path: "alpha.md", score: 0.6, chunk_text: "alpha2" },
      ],
    });

    const result = await findRelevantNotes({ filePath: "source.md" });

    expect(result.map((entry) => entry.document.path)).toEqual(["beta.md", "alpha.md"]);
    expect(
      result.find((entry) => entry.document.path === "alpha.md")?.metadata.similarityScore
    ).toBe(0.6);
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockGetDocumentsByPath).not.toHaveBeenCalled();
    expect(mockSearchRelated).toHaveBeenCalledTimes(1);
    expect(mockSearchRelated).toHaveBeenCalledWith("http://127.0.0.1:8742", "source.md", {
      sourceId: "test-source",
      limit: 20,
    });
  });

  it("falls back to Miyo when Orama docs exist but have no embeddings and have content", async () => {
    // enableMiyoSearch=false ensures shouldUseMiyoForRelevantNotes() returns false,
    // so the no-embeddings fallback path (line 212 of findRelevantNotes.ts) is exercised.
    mockedGetSettings.mockReturnValue({
      debug: false,
      selfHostUrl: "http://127.0.0.1:8742",
      enableMiyoSearch: false,
      enableSemanticSearchV3: true,
    } as any);
    mockGetDocumentsByPath.mockResolvedValue([
      { id: "chunk-a", path: "source.md", content: "source chunk content", embedding: [] },
    ]);
    mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
    mockSearchRelated.mockResolvedValue({
      results: [
        { id: "a-1", path: "alpha.md", score: 0.75, chunk_text: "alpha chunk" },
        { id: "self", path: "source.md", score: 0.99, chunk_text: "self" },
      ],
    });

    const result = await findRelevantNotes({ filePath: "source.md" });

    expect(result.map((e) => e.document.path)).toEqual(["alpha.md"]);
    expect(result[0].metadata.similarityScore).toBe(0.75);
    // Orama path not taken (no embeddings); Miyo called as fallback
    expect(mockGetDocsByEmbedding).not.toHaveBeenCalled();
    expect(mockSearchRelated).toHaveBeenCalledTimes(1);
  });

  it("falls back to link-only relevance when Miyo related-note search fails", async () => {
    mockedIsSelfHostAccessValid.mockReturnValue(true);
    mockedGetSettings.mockReturnValue({
      debug: false,
      selfHostUrl: "http://127.0.0.1:8742",
      enableMiyo: true,
      enableSemanticSearchV3: true,
    } as any);
    mockGetDocumentsByPath.mockResolvedValue([
      {
        id: "chunk-a",
        path: "source.md",
        content: "source chunk A",
        embedding: [],
      },
    ]);
    mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
    mockSearchRelated.mockRejectedValue(new Error("Miyo unavailable"));
    mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

    const result = await findRelevantNotes({ filePath: "source.md" });

    expect(result).toHaveLength(1);
    expect(result[0].document.path).toBe("linked-only.md");
    expect(result[0].metadata.similarityScore).toBeUndefined();
    expect(result[0].metadata.hasOutgoingLinks).toBe(true);
    expect(mockGetDocumentsByPath).not.toHaveBeenCalled();
  });
});
