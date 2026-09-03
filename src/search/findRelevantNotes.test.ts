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
import { getSettings, type CopilotSettings } from "@/settings/model";
import { TFile } from "obsidian";

jest.mock("@/noteUtils", () => ({
  getLinkedNotes: jest.fn(),
  getBacklinkedNotes: jest.fn(),
}));

jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));

const mockResolveBaseUrl = jest.fn();
const mockSearchRelated = jest.fn();
const mockFileStatus = jest.fn();

jest.mock("@/miyo/MiyoClient", () => {
  const actual = jest.requireActual<typeof import("@/miyo/MiyoClient")>("@/miyo/MiyoClient");
  return {
    MiyoRequestError: actual.MiyoRequestError,
    MiyoClient: jest.fn().mockImplementation(() => ({
      resolveBaseUrl: (...args: unknown[]) => mockResolveBaseUrl(...args) as unknown,
      searchRelated: (...args: unknown[]) => mockSearchRelated(...args) as unknown,
      fileStatus: (...args: unknown[]) => mockFileStatus(...args) as unknown,
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
      mockedGetSettings.mockReturnValue({
        enableMiyo: true,
        miyoServerUrl: "",
        debug: false,
      } as CopilotSettings);
      mockedShouldUseMiyo.mockReturnValue(true);
      mockedGetLinkedNotes.mockReturnValue([]);
      mockedGetBacklinkedNotes.mockReturnValue([]);
      mockedGetMiyoFolderName.mockReturnValue("vault");
      mockedGetMiyoFilePath.mockImplementation((_: unknown, path: string) => `vault/${path}`);
      mockedGetVaultRelativeMiyoPath.mockImplementation((_: unknown, path: string) =>
        path.replace(/^vault\//, "")
      );
      mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
      mockSearchRelated.mockResolvedValue({ results: [] });
      mockFileStatus.mockResolvedValue({ status: "pending" });
      mockedMiyoClient.mockImplementation(() => ({
        resolveBaseUrl: mockResolveBaseUrl,
        searchRelated: mockSearchRelated,
        fileStatus: mockFileStatus,
      }));

      const paths = [
        "source.md",
        "alpha.md",
        "beta.md",
        "linked-only.md",
        "attachment.pdf",
        ...Array.from({ length: 25 }, (_, index) => `note-${index}.md`),
      ];
      const filesByPath = new Map(paths.map((path) => [path, createMarkdownFile(path)]));
      (window.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => filesByPath.get(path) ?? null
      );
    });

    it("preserves Miyo result order and the first score for each file (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockResolvedValue({
        results: [
          { path: "vault/source.md", score: 0.99 },
          { path: "vault/alpha.md", score: 0.45 },
          { path: "vault/beta.md", score: 0.88 },
          { path: "vault/alpha.md", score: 0.6 },
        ],
      });

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result.notes.map((entry) => entry.note.path)).toEqual(["alpha.md", "beta.md"]);
      expect(result.notes[0].metadata.score).toBe(0.45);
      expect(result.status).toBe("matches");
      expect(mockSearchRelated).toHaveBeenCalledWith("http://127.0.0.1:8742", "vault/source.md", {
        folderName: "vault",
        limit: 20,
      });
    });

    it("uses the first finite score and ignores malformed Miyo results (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockResolvedValue({
        results: [
          { path: "vault/alpha.md", score: undefined },
          { path: "vault/alpha.md", score: 0.6 },
          { path: "vault/beta.md", score: Number.POSITIVE_INFINITY },
          { path: "vault/beta.md", score: 0.5 },
          { path: "vault/linked-only.md", score: "invalid" },
        ],
      });

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result.notes.map((entry) => [entry.note.path, entry.metadata.score])).toEqual([
        ["alpha.md", 0.6],
        ["beta.md", 0.5],
      ]);
      expect(result.status).toBe("matches");
    });

    it("annotates Miyo results without appending link-only candidates (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockResolvedValue({
        results: [
          { path: "vault/alpha.md", score: 0.6 },
          { path: "vault/beta.md", score: 0.58 },
        ],
      });
      mockedGetLinkedNotes.mockReturnValue([
        createMarkdownFile("alpha.md"),
        createMarkdownFile("linked-only.md"),
      ]);
      mockedGetBacklinkedNotes.mockReturnValue([createMarkdownFile("beta.md")]);

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result.notes.map((entry) => entry.note.path)).toEqual(["alpha.md", "beta.md"]);
      expect(result.notes[0].metadata.hasOutgoingLinks).toBe(true);
      expect(result.notes[1].metadata.hasBacklinks).toBe(true);
    });

    it("trusts Miyo to apply the requested result limit instead of capping or sorting again (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockResolvedValue({
        results: Array.from({ length: 25 }, (_, index) => ({
          path: `vault/note-${index}.md`,
          score: index / 100,
        })),
      });

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result.notes).toHaveLength(25);
      expect(result.notes[0].note.path).toBe("note-0.md");
      expect(result.notes[24].note.path).toBe("note-24.md");
    });

    it("returns no rows for Miyo's no-match state regardless of links (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result).toEqual({ status: "no-matches", notes: [] });
      expect(mockFileStatus).not.toHaveBeenCalled();
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
    });

    it("reports unavailable when a successful Miyo response omits its results array (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockResolvedValue({});

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result).toEqual({ notes: [], status: "unavailable" });
      expect(mockedLogError).toHaveBeenCalledWith(
        "RelevantNotes(Miyo): related search response is missing its results array"
      );
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
    });

    it("returns no link-only rows when Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedGetSettings.mockReturnValue({ enableMiyo: false } as CopilotSettings);
      mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result).toEqual({ notes: [], status: "disabled" });
      expect(mockSearchRelated).not.toHaveBeenCalled();
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
    });

    it("returns no link-only rows when enabled Miyo cannot run (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedShouldUseMiyo.mockReturnValue(false);
      mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result).toEqual({ notes: [], status: "unavailable" });
      expect(mockResolveBaseUrl).not.toHaveBeenCalled();
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
    });

    it("reports unavailable when the source path is not a Markdown file (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      const result = await findRelevantNotes({
        app: window.app,
        filePath: "attachment.pdf",
      });

      expect(result).toEqual({ notes: [], status: "unavailable" });
      expect(mockResolveBaseUrl).not.toHaveBeenCalled();
    });

    it("reuses one frozen notes array for every empty result (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      const missingFileResult = await findRelevantNotes({
        app: window.app,
        filePath: "missing.md",
      });

      mockedGetSettings.mockReturnValue({ enableMiyo: false } as CopilotSettings);
      const disabledResult = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      mockedGetSettings.mockReturnValue({ enableMiyo: true } as CopilotSettings);
      mockedShouldUseMiyo.mockReturnValue(false);
      const runtimeUnavailableResult = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      mockedShouldUseMiyo.mockReturnValue(true);
      mockSearchRelated.mockRejectedValue(new MiyoRequestError(503, "Service unavailable"));
      const failedSearchResult = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      mockSearchRelated.mockResolvedValue({ results: [] });
      const noMatchesResult = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      mockSearchRelated.mockRejectedValue(new MiyoRequestError(404, ""));
      mockFileStatus.mockRejectedValue(
        new MiyoRequestError(501, '{"error":"not_implemented"}', "not_implemented")
      );
      const notIndexedResult = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      mockSearchRelated.mockResolvedValue({
        results: [{ path: "vault/missing-result.md", score: 0.5 }],
      });
      const filteredResult = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      const emptyResults = [
        missingFileResult,
        disabledResult,
        runtimeUnavailableResult,
        failedSearchResult,
        noMatchesResult,
        notIndexedResult,
        filteredResult,
      ];
      expect(emptyResults.map((result) => result.status)).toEqual([
        "unavailable",
        "disabled",
        "unavailable",
        "unavailable",
        "no-matches",
        "not-indexed",
        "matches",
      ]);
      expect(Object.isFrozen(missingFileResult.notes)).toBe(true);
      for (const result of emptyResults) {
        expect(result.notes).toBe(missingFileResult.notes);
      }
    });

    it.each(["", "Source file is not indexed"])(
      "classifies every related-search 404 regardless of detail %p (https://github.com/Brevilabs/obsidian-copilot-private/issues/280; https://github.com/logancyang/obsidian-copilot/pull/2992#discussion_r3919646861)",
      async (detail) => {
        mockSearchRelated.mockRejectedValue(new MiyoRequestError(404, detail));
        mockFileStatus.mockResolvedValue({ status: "pending" });

        const result = await findRelevantNotes({
          app: window.app,
          filePath: "source.md",
        });

        expect(result.status).toBe("indexing");
        expect(mockFileStatus).toHaveBeenCalledWith("http://127.0.0.1:8742", "vault/source.md");
      }
    );

    it.each([
      {
        fileStatus: { status: "indexed", total_chunks: 0 },
        expectedStatus: "no-text",
        expectedDetails: undefined,
      },
      {
        fileStatus: { status: "pending" },
        expectedStatus: "indexing",
        expectedDetails: undefined,
      },
      {
        fileStatus: { status: "not_scanned" },
        expectedStatus: "indexing",
        expectedDetails: undefined,
      },
      {
        fileStatus: { status: "missing" },
        expectedStatus: "indexing",
        expectedDetails: undefined,
      },
      {
        fileStatus: {
          status: "error",
          error_message: "Markdown parser failed",
        },
        expectedStatus: "index-error",
        expectedDetails: { errorMessage: "Markdown parser failed" },
      },
      {
        fileStatus: {
          status: "excluded",
          reason: "exclude_pattern",
          rule: "private/**",
        },
        expectedStatus: "excluded",
        expectedDetails: {
          exclusionReason: "exclude_pattern",
          exclusionRule: "private/**",
        },
      },
    ])(
      "maps $fileStatus.status status without returning link-only rows (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      async ({ fileStatus, expectedStatus, expectedDetails }) => {
        mockSearchRelated.mockRejectedValue(
          new MiyoRequestError(404, "No indexed chunks found for file_path")
        );
        mockFileStatus.mockResolvedValue(fileStatus);
        mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

        const result = await findRelevantNotes({
          app: window.app,
          filePath: "source.md",
        });

        expect(result.notes).toEqual([]);
        expect(result.status).toBe(expectedStatus);
        expect(result.details).toEqual(expectedDetails);
        expect(mockFileStatus).toHaveBeenCalledWith("http://127.0.0.1:8742", "vault/source.md");
        expect(mockedGetMiyoFilePath).toHaveBeenCalledWith(window.app, "source.md");
        expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
        expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
        expect(mockedLogError).not.toHaveBeenCalled();
      }
    );

    it("keeps the original authorization identity for related search and its file-status probe after live settings change (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      const requestAuthorizationIdentities: Array<string | undefined> = [];
      mockedGetSettings.mockReturnValue({
        enableMiyo: true,
        miyoServerUrl: "https://old-miyo.example",
        plusLicenseKey: "old-license",
        debug: false,
      } as CopilotSettings);
      mockedMiyoClient.mockImplementation((authSnapshot) => {
        const clientAuthSnapshot = authSnapshot as { plusLicenseKey?: string };
        return {
          resolveBaseUrl: mockResolveBaseUrl,
          searchRelated: async (...args: unknown[]) => {
            requestAuthorizationIdentities.push(clientAuthSnapshot.plusLicenseKey);
            mockedGetSettings.mockReturnValue({
              enableMiyo: true,
              miyoServerUrl: "https://new-miyo.example",
              plusLicenseKey: "new-license",
              debug: false,
            } as CopilotSettings);
            return mockSearchRelated(...args) as unknown;
          },
          fileStatus: (...args: unknown[]) => {
            requestAuthorizationIdentities.push(clientAuthSnapshot.plusLicenseKey);
            return mockFileStatus(...args) as unknown;
          },
        };
      });
      mockSearchRelated.mockRejectedValue(new MiyoRequestError(404, ""));
      mockFileStatus.mockResolvedValue({ status: "pending" });

      const result = await findRelevantNotes({ app: window.app, filePath: "source.md" });

      expect(result.status).toBe("indexing");
      expect(mockedMiyoClient).toHaveBeenCalledWith({ plusLicenseKey: "old-license" });
      expect(requestAuthorizationIdentities).toEqual(["old-license", "old-license"]);
      expect(mockedGetSettings).toHaveBeenCalledTimes(1);
    });

    it("retries related search when indexing completes after the first 404 (https://github.com/logancyang/obsidian-copilot/pull/3088#discussion_r3921456717)", async () => {
      mockSearchRelated
        .mockRejectedValueOnce(new MiyoRequestError(404, "No indexed chunks found for file_path"))
        .mockResolvedValueOnce({ results: [{ path: "vault/alpha.md", score: 0.82 }] });
      mockFileStatus.mockResolvedValue({ status: "indexed", total_chunks: 4 });

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result.status).toBe("matches");
      expect(result.notes.map((entry) => entry.note.path)).toEqual(["alpha.md"]);
      expect(mockSearchRelated).toHaveBeenCalledTimes(2);
      expect(mockFileStatus).toHaveBeenCalledTimes(1);
    });

    it("reports unavailable when the indexed-race retry fails (https://github.com/logancyang/obsidian-copilot/pull/3088#discussion_r3921456717)", async () => {
      mockSearchRelated
        .mockRejectedValueOnce(new MiyoRequestError(404, "No indexed chunks found for file_path"))
        .mockRejectedValueOnce(new MiyoRequestError(503, "Service unavailable"));
      mockFileStatus.mockResolvedValue({ status: "indexed", total_chunks: 4 });
      mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result).toEqual({ notes: [], status: "unavailable" });
      expect(mockSearchRelated).toHaveBeenCalledTimes(2);
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedLogError).toHaveBeenCalledTimes(1);
    });

    it("returns no link-only rows for the compatibility state from an exact old-Miyo response (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockRejectedValue(
        new MiyoRequestError(404, "No indexed chunks found for file_path")
      );
      mockFileStatus.mockRejectedValue(
        new MiyoRequestError(501, '{"error":"not_implemented"}', "not_implemented")
      );
      mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result.notes).toEqual([]);
      expect(result.status).toBe("not-indexed");
      expect(mockFileStatus).toHaveBeenCalledWith("http://127.0.0.1:8742", "vault/source.md");
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
      expect(mockedLogError).not.toHaveBeenCalled();
    });

    it.each([
      new MiyoRequestError(501, "not supported", "other_error"),
      new MiyoRequestError(501, "not_implemented"),
      new MiyoRequestError(404, "Folder unavailable"),
      new Error("network down"),
    ])(
      "returns no graph-only rows when file status fails with $message (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      async (statusError) => {
        mockSearchRelated.mockRejectedValue(
          new MiyoRequestError(404, "No indexed chunks found for file_path")
        );
        mockFileStatus.mockRejectedValue(statusError);
        mockedGetBacklinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

        const result = await findRelevantNotes({
          app: window.app,
          filePath: "source.md",
        });

        expect(result).toEqual({ notes: [], status: "unavailable" });
        expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
        expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
        expect(mockedLogError).toHaveBeenCalledTimes(1);
      }
    );

    it("returns no graph-only rows for an unknown file-status classification (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockRejectedValue(
        new MiyoRequestError(404, "No indexed chunks found for file_path")
      );
      mockFileStatus.mockResolvedValue({ status: "future_status" });
      mockedGetBacklinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result).toEqual({ notes: [], status: "unavailable" });
      expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      expect(mockedGetBacklinkedNotes).not.toHaveBeenCalled();
      expect(mockedLogError).toHaveBeenCalledTimes(1);
    });

    it("reports unavailable when the file-status request times out (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      jest.useFakeTimers();
      try {
        mockSearchRelated.mockRejectedValue(
          new MiyoRequestError(404, "No indexed chunks found for file_path")
        );
        mockFileStatus.mockReturnValue(new Promise(() => undefined));

        const resultPromise = findRelevantNotes({
          app: window.app,
          filePath: "source.md",
        });
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(8000);

        await expect(resultPromise).resolves.toMatchObject({ status: "unavailable" });
        expect(mockedLogError).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("returns no link-only rows when the primary search times out (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      jest.useFakeTimers();
      try {
        mockSearchRelated.mockReturnValue(new Promise(() => undefined));
        mockedGetLinkedNotes.mockReturnValue([createMarkdownFile("linked-only.md")]);

        const resultPromise = findRelevantNotes({
          app: window.app,
          filePath: "source.md",
        });
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(8000);

        await expect(resultPromise).resolves.toEqual({ notes: [], status: "unavailable" });
        expect(mockFileStatus).not.toHaveBeenCalled();
        expect(mockedGetLinkedNotes).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("reports unavailable when endpoint resolution times out (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      jest.useFakeTimers();
      try {
        mockResolveBaseUrl.mockReturnValue(new Promise(() => undefined));

        const resultPromise = findRelevantNotes({
          app: window.app,
          filePath: "source.md",
        });
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(8000);

        await expect(resultPromise).resolves.toMatchObject({ status: "unavailable" });
        expect(mockSearchRelated).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("reports a related-search outage as unavailable without probing registration (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSearchRelated.mockRejectedValue(new MiyoRequestError(503, "Service unavailable"));

      const result = await findRelevantNotes({
        app: window.app,
        filePath: "source.md",
      });

      expect(result.status).toBe("unavailable");
      expect(mockFileStatus).not.toHaveBeenCalled();
      expect(mockedLogError).toHaveBeenCalledTimes(1);
    });
  });
});
