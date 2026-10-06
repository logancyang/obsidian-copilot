import { type App, TFile } from "obsidian";
import { logWarn } from "@/logger";
import { MiyoRequestError } from "@/miyo/MiyoClient";
import { MiyoSemanticRetriever } from "@/search/miyo/MiyoSemanticRetriever";
import { getSettings } from "@/settings/model";

const mockResolveBaseUrl = jest.fn();
const mockSearch = jest.fn();

jest.mock("@/logger");
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  normalizeRootFolders:
    jest.requireActual<typeof import("@/settings/model")>("@/settings/model").normalizeRootFolders,
}));
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoRequestError:
    jest.requireActual<typeof import("@/miyo/MiyoClient")>("@/miyo/MiyoClient").MiyoRequestError,
  MiyoClient: jest.fn().mockImplementation(() => ({
    resolveBaseUrl: (...args: unknown[]) => mockResolveBaseUrl(...args) as unknown,
    search: (...args: unknown[]) => mockSearch(...args) as unknown,
  })),
}));

function makeApp(getAbstractFileByPath: (path: string) => TFile | null = () => null): App {
  return {
    vault: { getName: () => "/vault", getAbstractFileByPath },
    metadataCache: {},
  } as unknown as App;
}

function mockSettings(overrides: Record<string, unknown> = {}) {
  (getSettings as jest.Mock).mockReturnValue({
    miyoServerUrl: "http://miyo.local",
    debug: false,
    miyoExtraSearchFolders: [],
    ...overrides,
  });
}

function createRetriever(
  options: Partial<ConstructorParameters<typeof MiyoSemanticRetriever>[1]> = {}
) {
  return new MiyoSemanticRetriever(makeApp(), {
    maxK: 10,
    salientTerms: [],
    minSimilarityScore: 0.2,
    ...options,
  });
}

describe("MiyoSemanticRetriever", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReset();
    mockSettings();
    mockResolveBaseUrl.mockResolvedValue("http://miyo.local");
  });

  describe("MiyoSemanticRetriever", () => {
    describe("getRelevantDocuments()", () => {
      it("returns each semantic chunk once, above the similarity threshold, with vault-relative paths and chunk ids", async () => {
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
        const documents = await retriever.getRelevantDocuments("query");

        expect(documents).toHaveLength(2);
        expect(documents[0].metadata.path).toBe("notes/a.md");
        expect(documents[0].metadata.chunkId).toBe("notes/a.md#0");
        expect(documents[0].pageContent).toBe("A chunk");
        expect(documents[1].metadata.path).toBe("notes/c.md");
      });

      it("asks Miyo for the requested modification-time range", async () => {
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
          { filters: [{ field: "mtime", gte: startTime, lte: endTime }] }
        );
      });

      it("requests Miyo's full candidate pool even with no local QA rules, because Copilot cannot know the server's exclusion scope (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
        mockSearch.mockResolvedValue({ results: [] });

        await createRetriever({ maxK: 5 }).getRelevantDocuments("list all notes about ai digests");

        expect(mockSearch).toHaveBeenCalledWith(
          "http://miyo.local",
          "/vault",
          "list all notes about ai digests",
          1000,
          {}
        );
      });

      it("returns at most maxK chunks even though Miyo returns more", async () => {
        mockSettings({ qaExclusions: "private" });
        const app = makeApp();

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

        expect(documents).toHaveLength(2);
        expect(documents.map((doc) => doc.metadata.path as string)).toEqual([
          "notes/0.md",
          "notes/1.md",
        ]);
      });

      it("drops chunks from notes that match the Copilot exclusion rules", async () => {
        mockSettings({ qaExclusions: "private" });

        const TFileConstructor = TFile as unknown as new (filePath: string) => TFile;
        const filesByPath = new Map<string, TFile>([
          ["notes/keep.md", new TFileConstructor("notes/keep.md")],
          ["private/secret.md", new TFileConstructor("private/secret.md")],
        ]);
        const app = makeApp((path) => filesByPath.get(path) ?? null);

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

      it("keeps search-all chunks from another folder that shares a Copilot system root's name", async () => {
        mockSettings({ miyoSearchAll: true, copilotFolder: "copilot" });
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

        expect(mockSearch).toHaveBeenCalledWith("http://miyo.local", undefined, "query", 1000, {});
        expect(documents).toHaveLength(1);
        expect(documents[0].metadata.path).toBe("copilot/notes/foo.md");
        expect(documents[0].metadata.fromCurrentVault).toBe(false);
      });

      it("drops unprefixed chunks under a Copilot system root on a folder-scoped query", async () => {
        mockSettings({ copilotFolder: "copilot" });

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

      it("rejects with an unavailable message instead of returning an empty result when the Miyo request fails (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
        mockSearch.mockRejectedValue(new Error("connection refused"));

        await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
          "Miyo is unavailable. Open Miyo, then retry vault search."
        );
      });

      it("rejects with registration guidance when Miyo answers 404 for a folder-scoped search (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
        mockSearch.mockRejectedValue(new MiyoRequestError(404, "folder not registered"));

        await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
          "This vault is not registered with Miyo. Register it in Miyo, then retry vault search."
        );
      });

      it("rejects with the unavailable message, not registration guidance, when an unrestricted search gets 404 (https://github.com/logancyang/obsidian-copilot/pull/3090#discussion_r3926715956)", async () => {
        mockSettings({ miyoSearchAll: true });
        mockSearch.mockRejectedValue(new MiyoRequestError(404, "not found"));

        await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
          "Miyo is unavailable. Open Miyo, then retry vault search."
        );
      });

      it("searches the vault plus the ticked extra folders in one request anchored on the vault, listing the vault once — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
        mockSettings({ miyoExtraSearchFolders: ["Research", "/vault", "ChatGPT"] });
        mockSearch.mockResolvedValue({ results: [] });

        await createRetriever().getRelevantDocuments("query");

        expect(mockSearch).toHaveBeenCalledWith("http://miyo.local", "/vault", "query", 1000, {
          folderNames: ["/vault", "Research", "ChatGPT"],
        });
      });

      it("ignores ticked extra folders when the scope is Unrestricted — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
        mockSettings({ miyoSearchAll: true, miyoExtraSearchFolders: ["Research"] });
        mockSearch.mockResolvedValue({ results: [] });

        await createRetriever().getRelevantDocuments("query");

        expect(mockSearch).toHaveBeenCalledWith("http://miyo.local", undefined, "query", 1000, {});
      });

      it("marks extra-folder results as outside the vault, keeps Miyo's note or chat source, and applies Copilot exclusions only to vault results — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
        mockSettings({ qaExclusions: "Archive", miyoExtraSearchFolders: ["Archive", "ChatGPT"] });
        mockSearch.mockResolvedValue({
          results: [
            {
              id: "vault-excluded",
              score: 0.95,
              path: "/vault/Archive/old.md",
              chunk_index: 0,
              chunk_text: "an excluded vault note",
              source: "documents",
            },
            {
              id: "vault-kept",
              score: 0.9,
              path: "/vault/notes/keep.md",
              chunk_index: 0,
              chunk_text: "a vault note",
              source: "documents",
            },
            {
              id: "extra-note",
              score: 0.85,
              path: "Archive/plan.md",
              chunk_index: 0,
              chunk_text: "a note in the ticked Archive folder",
              source: "documents",
            },
            {
              id: "extra-chat",
              score: 0.8,
              path: "ChatGPT/2026-01-02 trip.md",
              chunk_index: 0,
              chunk_text: "a synced chat",
              source: "chats",
            },
          ],
        });

        const documents = await createRetriever().getRelevantDocuments("query");

        expect(
          documents.map(({ metadata }) => ({
            path: metadata.path as string,
            fromCurrentVault: metadata.fromCurrentVault as boolean,
            miyoSource: metadata.miyoSource as string,
          }))
        ).toEqual([
          { path: "notes/keep.md", fromCurrentVault: true, miyoSource: "documents" },
          { path: "Archive/plan.md", fromCurrentVault: false, miyoSource: "documents" },
          { path: "ChatGPT/2026-01-02 trip.md", fromCurrentVault: false, miyoSource: "chats" },
        ]);
      });

      it("skips a ticked folder this Miyo does not have and still searches the vault and the other folders — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
        mockSettings({ miyoExtraSearchFolders: ["Research", "Archive"] });
        mockSearch
          .mockRejectedValueOnce(new MiyoRequestError(404, "Folder not registered: Archive"))
          .mockResolvedValueOnce({
            results: [
              {
                id: "research",
                score: 0.9,
                path: "Research/idea.md",
                chunk_index: 0,
                chunk_text: "research",
              },
            ],
          });

        const documents = await createRetriever().getRelevantDocuments("query");

        expect(mockSearch.mock.calls.map((call: unknown[]) => call[4])).toEqual([
          { folderNames: ["/vault", "Research", "Archive"] },
          { folderNames: ["/vault", "Research"] },
        ]);
        expect(documents.map((doc) => doc.metadata.path as string)).toEqual(["Research/idea.md"]);
        expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('"Archive"'));
      });

      it("falls back to the vault-only request when every ticked folder is missing from Miyo — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
        mockSettings({ miyoExtraSearchFolders: ["Research", "Archive"] });
        mockSearch
          .mockRejectedValueOnce(new MiyoRequestError(404, "Folder not registered: Research"))
          .mockRejectedValueOnce(new MiyoRequestError(404, "Folder not registered: Archive"))
          .mockResolvedValueOnce({ results: [] });

        await expect(createRetriever().getRelevantDocuments("query")).resolves.toEqual([]);

        expect(mockSearch.mock.calls.map((call: unknown[]) => call[4])).toEqual([
          { folderNames: ["/vault", "Research", "Archive"] },
          { folderNames: ["/vault", "Archive"] },
          {},
        ]);
      });

      it("keeps registration guidance without retrying when the vault itself is the unregistered folder — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
        mockSettings({ miyoExtraSearchFolders: ["Research"] });
        mockSearch.mockRejectedValue(new MiyoRequestError(404, "Folder not registered: /vault"));

        await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
          "This vault is not registered with Miyo. Register it in Miyo, then retry vault search."
        );
        expect(mockSearch).toHaveBeenCalledTimes(1);
      });

      it("reports Miyo unavailable without retrying when a search with extra folders fails for another reason — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
        mockSettings({ miyoExtraSearchFolders: ["Research"] });
        mockSearch.mockRejectedValue(new MiyoRequestError(500, "index unavailable"));

        await expect(createRetriever().getRelevantDocuments("query")).rejects.toThrow(
          "Miyo is unavailable. Open Miyo, then retry vault search."
        );
        expect(mockSearch).toHaveBeenCalledTimes(1);
      });
    });
  });
});
