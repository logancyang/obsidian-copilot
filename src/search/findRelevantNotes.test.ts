import { logError } from "@/logger";
import { MiyoClient, MiyoRequestError } from "@/miyo/MiyoClient";
import {
  getMiyoFilePath,
  getMiyoFolderName,
  getVaultRelativeMiyoPath,
  shouldUseMiyo,
} from "@/miyo/miyoUtils";
import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { findRelevantNotes } from "@/search/findRelevantNotes";
import { createCopilotPatternFilter } from "@/search/searchUtils";
import { getSettings, type CopilotSettings } from "@/settings/model";
import { TFile } from "obsidian";

jest.mock("@/noteUtils", () => ({
  getLinkedNotes: jest.fn(),
  getBacklinkedNotes: jest.fn(),
}));

jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));
jest.mock("@/search/searchUtils", () => ({ createCopilotPatternFilter: jest.fn() }));

const mockResolveBaseUrl = jest.fn();
const mockSearchRelated = jest.fn();
const mockGetFolder = jest.fn();

jest.mock("@/miyo/MiyoClient", () => {
  const actual = jest.requireActual<typeof import("@/miyo/MiyoClient")>("@/miyo/MiyoClient");
  return {
    MiyoRequestError: actual.MiyoRequestError,
    MiyoClient: jest.fn().mockImplementation(() => ({
      resolveBaseUrl: (...args: unknown[]) => mockResolveBaseUrl(...args) as unknown,
      searchRelated: (...args: unknown[]) => mockSearchRelated(...args) as unknown,
      getFolder: (...args: unknown[]) => mockGetFolder(...args) as unknown,
    })),
  };
});

jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoFolderName: jest.fn(),
  getMiyoFilePath: jest.fn((_: unknown, path: string) => `vault/${path}`),
  getVaultRelativeMiyoPath: jest.fn((_: unknown, path: string) => path.replace(/^vault\//, "")),
  getMiyoCustomUrl: jest.fn().mockReturnValue(""),
  shouldUseMiyo: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

function createMarkdownFile(path: string): TFile {
  const TFileConstructor = TFile as unknown as new (filePath: string) => TFile;
  return new TFileConstructor(path);
}

describe("findRelevantNotes", () => {
  const mockedGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
  const mockedShouldUseMiyo = shouldUseMiyo as jest.MockedFunction<typeof shouldUseMiyo>;
  const mockedCreateCopilotPatternFilter = createCopilotPatternFilter as jest.MockedFunction<
    typeof createCopilotPatternFilter
  >;
  const mockedGetLinkedNotes = getLinkedNotes as jest.MockedFunction<typeof getLinkedNotes>;
  const mockedGetBacklinkedNotes = getBacklinkedNotes as jest.MockedFunction<
    typeof getBacklinkedNotes
  >;
  const mockedGetMiyoFolderName = getMiyoFolderName as jest.MockedFunction<
    typeof getMiyoFolderName
  >;
  const mockedGetMiyoFilePath = getMiyoFilePath as jest.MockedFunction<typeof getMiyoFilePath>;
  const mockedGetVaultRelativeMiyoPath = getVaultRelativeMiyoPath as jest.MockedFunction<
    typeof getVaultRelativeMiyoPath
  >;
  const mockedMiyoClient = MiyoClient as unknown as jest.Mock;
  const mockedLogError = logError as jest.MockedFunction<typeof logError>;

  describe("findRelevantNotes()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockedShouldUseMiyo.mockReturnValue(false);
      mockedCreateCopilotPatternFilter.mockReturnValue(() => true);
      mockedGetSettings.mockReturnValue({
        debug: false,
        miyoServerUrl: "",
        enableMiyo: false,
      } as CopilotSettings);
      mockedGetLinkedNotes.mockReturnValue([]);
      mockedGetBacklinkedNotes.mockReturnValue([]);
      mockedGetMiyoFolderName.mockReturnValue("vault");
      mockedGetMiyoFilePath.mockImplementation((_: unknown, path: string) => `vault/${path}`);
      mockedGetVaultRelativeMiyoPath.mockImplementation((_: unknown, path: string) =>
        path.replace(/^vault\//, "")
      );
      mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
      mockSearchRelated.mockResolvedValue({ results: [] });
      mockGetFolder.mockResolvedValue({ path: "vault" });
      mockedMiyoClient.mockImplementation(() => ({
        resolveBaseUrl: mockResolveBaseUrl,
        searchRelated: mockSearchRelated,
        getFolder: mockGetFolder,
      }));

      const paths = [
        "source.md",
        "alpha.md",
        "beta.md",
        "linked-only.md",
        ...Array.from({ length: 25 }, (_, index) => `note-${index}.md`),
      ];
      const filesByPath = new Map(paths.map((path) => [path, createMarkdownFile(path)]));
      (window.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => filesByPath.get(path) ?? null
      );
    });

    it("uses Miyo as the only semantic scorer and preserves vault-scoped path stripping (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({ enableMiyo: true, debug: false } as CopilotSettings);
      mockSearchRelated.mockResolvedValue({
        results: [
          { path: "vault/source.md", score: 0.99 },
          { path: "vault/alpha.md", score: 0.45 },
          { path: "vault/beta.md", score: 0.88 },
          { path: "vault/alpha.md", score: 0.6 },
        ],
      });

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result.notes.map((entry) => entry.note.path)).toEqual(["beta.md", "alpha.md"]);
      expect(
        result.notes.find((entry) => entry.note.path === "alpha.md")?.metadata.similarityScore
      ).toBe(0.6);
      expect(result.semanticState).toBe("ready");
      expect(mockSearchRelated).toHaveBeenCalledWith("http://127.0.0.1:8742", "vault/source.md", {
        folderName: "vault",
        limit: 20,
      });
    });

    it("returns no graph-only fallback rows when Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedGetLinkedNotes.mockReturnValue([
        createMarkdownFile("linked-only.md"),
        createMarkdownFile("alpha.md"),
      ]);
      mockedGetBacklinkedNotes.mockReturnValue([
        createMarkdownFile("alpha.md"),
        createMarkdownFile("beta.md"),
      ]);

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result).toEqual({ notes: [], semanticState: "disabled" });
      expect(mockSearchRelated).not.toHaveBeenCalled();
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
    });

    it("ranks by Miyo similarity without boosting a backlinked lower-scoring note", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({ enableMiyo: true, debug: false } as CopilotSettings);
      mockSearchRelated.mockResolvedValue({
        results: [
          { path: "vault/alpha.md", score: 0.6 },
          { path: "vault/beta.md", score: 0.58 },
        ],
      });
      mockedGetBacklinkedNotes.mockReturnValue([createMarkdownFile("beta.md")]);

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result.notes.map((entry) => entry.note.path)).toEqual(["alpha.md", "beta.md"]);
      expect(result.notes[1].metadata.hasBacklinks).toBe(true);
    });

    it("applies the live Copilot scope to Miyo and linked candidates", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({ enableMiyo: true, debug: false } as CopilotSettings);
      mockSearchRelated.mockResolvedValue({
        results: [
          { path: "vault/beta.md", score: 0.8 },
          { path: "vault/alpha.md", score: 0.9 },
        ],
      });
      mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);
      const isAllowed = jest.fn((path: string) => path === "beta.md");
      mockedCreateCopilotPatternFilter.mockReturnValue(isAllowed);

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result.notes.map((entry) => entry.note.path)).toEqual(["beta.md"]);
      expect(isAllowed.mock.calls.map(([path]) => path)).toEqual([
        "beta.md",
        "alpha.md",
        "linked-only.md",
      ]);
    });

    it("caps Miyo results at the existing 20-note limit", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({ enableMiyo: true, debug: false } as CopilotSettings);
      mockSearchRelated.mockResolvedValue({
        results: Array.from({ length: 25 }, (_, index) => ({
          path: `vault/note-${index}.md`,
          score: index / 100,
        })),
      });

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result.notes).toHaveLength(20);
      expect(result.notes[0].note.path).toBe("note-24.md");
      expect(result.notes[19].note.path).toBe("note-5.md");
    });

    it("reports ready when a successful Miyo search has no semantic matches (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({
        debug: false,
        miyoServerUrl: "",
        enableMiyo: true,
      } as CopilotSettings);

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result).toEqual({ notes: [], semanticState: "ready" });
      expect(mockGetFolder).not.toHaveBeenCalled();
    });

    it("keeps links and reports not-indexed when the specific no-chunks response still finds the registered folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({
        debug: false,
        miyoServerUrl: "",
        enableMiyo: true,
      } as CopilotSettings);
      mockSearchRelated.mockRejectedValue(
        new MiyoRequestError(404, "No indexed chunks found for file_path")
      );
      mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].note.path).toBe("linked-only.md");
      expect(result.notes[0].metadata.similarityScore).toBeUndefined();
      expect(result.semanticState).toBe("not-indexed");
      expect(mockGetFolder).toHaveBeenCalledWith("http://127.0.0.1:8742", "vault");
      expect(mockedLogError).not.toHaveBeenCalled();
    });

    it("returns no graph-only fallback rows when the no-chunks response cannot confirm folder registration (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({
        debug: false,
        miyoServerUrl: "",
        enableMiyo: true,
      } as CopilotSettings);
      mockSearchRelated.mockRejectedValue(
        new MiyoRequestError(404, "No indexed chunks found for file_path")
      );
      mockGetFolder.mockRejectedValue(new MiyoRequestError(404, "Folder unavailable"));
      mockedGetBacklinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result).toEqual({ notes: [], semanticState: "unavailable" });
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
      expect(mockedLogError).toHaveBeenCalledTimes(1);
    });

    it("reports unavailable when the no-chunks registration probe times out instead of hanging the pane (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      jest.useFakeTimers();
      try {
        mockedShouldUseMiyo.mockReturnValue(true);
        mockedGetSettings.mockReturnValue({
          debug: false,
          miyoServerUrl: "",
          enableMiyo: true,
        } as CopilotSettings);
        mockSearchRelated.mockRejectedValue(
          new MiyoRequestError(404, "No indexed chunks found for file_path")
        );
        mockGetFolder.mockReturnValue(new Promise(() => undefined));

        const resultPromise = findRelevantNotes({ app: window.app, filePath: "source.md" });
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(8000);

        await expect(resultPromise).resolves.toMatchObject({ semanticState: "unavailable" });
        expect(mockedLogError).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("returns no graph-only fallback rows when the primary related search never settles (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      jest.useFakeTimers();
      try {
        mockedShouldUseMiyo.mockReturnValue(true);
        mockedGetSettings.mockReturnValue({
          debug: false,
          miyoServerUrl: "",
          enableMiyo: true,
        } as CopilotSettings);
        mockSearchRelated.mockReturnValue(new Promise(() => undefined));
        mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

        const resultPromise = findRelevantNotes({ app: window.app, filePath: "source.md" });
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(8000);

        await expect(resultPromise).resolves.toEqual({
          notes: [],
          semanticState: "unavailable",
        });
        expect(mockGetFolder).not.toHaveBeenCalled();
        expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("reports unavailable when Miyo endpoint resolution never settles (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      jest.useFakeTimers();
      try {
        mockedShouldUseMiyo.mockReturnValue(true);
        mockedGetSettings.mockReturnValue({
          debug: false,
          miyoServerUrl: "",
          enableMiyo: true,
        } as CopilotSettings);
        mockResolveBaseUrl.mockReturnValue(new Promise(() => undefined));

        const resultPromise = findRelevantNotes({ app: window.app, filePath: "source.md" });
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(8000);

        await expect(resultPromise).resolves.toMatchObject({ semanticState: "unavailable" });
        expect(mockSearchRelated).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("reports a 503 related-search outage as unavailable without trusting a registered folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetSettings.mockReturnValue({
        debug: false,
        miyoServerUrl: "",
        enableMiyo: true,
      } as CopilotSettings);
      mockSearchRelated.mockRejectedValue(new MiyoRequestError(503, "Service unavailable"));

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result.semanticState).toBe("unavailable");
      expect(mockGetFolder).not.toHaveBeenCalled();
      expect(mockedLogError).toHaveBeenCalledTimes(1);
    });

    it("reports unavailable when Miyo is enabled but the runtime cannot use it (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedGetSettings.mockReturnValue({ enableMiyo: true } as CopilotSettings);

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result).toEqual({ notes: [], semanticState: "unavailable" });
      expect(mockResolveBaseUrl).not.toHaveBeenCalled();
    });
  });
});
