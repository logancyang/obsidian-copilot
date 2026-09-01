import {
  appendOpenArtifactsLedgerEntry,
  migrateOpenArtifactsFolder,
  type OpenArtifactsLedgerEntry,
} from "./openArtifactsLedger";
import { ensureFolderExists } from "@/utils";
import type { Vault } from "obsidian";

jest.mock("@/utils", () => ({ ensureFolderExists: jest.fn() }));

const LEDGER_PATH = ".openartifacts/publish-history.md";
const LEDGER_HEADER =
  "| Document ID | Status | Note | URL | Published at (UTC) | Version | Content SHA-256 |\r\n" +
  "| --- | --- | --- | --- | --- | ---: | --- |";
const ENTRY: OpenArtifactsLedgerEntry = {
  docId: "9f2k4mvq7t0xbz3n",
  status: "published",
  notePath: String.raw`Notes/Architecture \| Review.md`,
  url: "https://openartifacts.site/d/9f2k4mvq7t0xbz3n",
  publishedAt: "2026-07-27T18:30:00.000Z",
  version: 1,
  contentHash: "abc123",
};

describe("openArtifactsLedger", () => {
  describe("appendOpenArtifactsLedgerEntry()", () => {
    const append = jest.fn();
    const exists = jest.fn();
    const read = jest.fn();
    const rename = jest.fn();
    const vault = { adapter: { append, exists, read, rename } } as unknown as Vault;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(ensureFolderExists).mockResolvedValue(undefined);
      append.mockResolvedValue(undefined);
      read.mockResolvedValue(LEDGER_HEADER);
    });

    it("creates hidden Markdown history and escapes table-breaking note paths", async () => {
      exists.mockResolvedValue(false);

      await appendOpenArtifactsLedgerEntry(vault, ENTRY);

      expect(ensureFolderExists).toHaveBeenCalledWith(vault, ".openartifacts");
      expect(append).toHaveBeenCalledWith(
        LEDGER_PATH,
        expect.stringContaining(
          String.raw`| 9f2k4mvq7t0xbz3n | published | Notes/Architecture \\\| Review.md | <https://openartifacts.site/d/9f2k4mvq7t0xbz3n> | 2026-07-27T18:30:00.000Z | 1 | abc123 |`
        )
      );
      expect(append.mock.calls[0][1]).toContain("| Document ID | Status | Note | URL |");
    });

    it("appends withdrawal records without adding another header", async () => {
      exists.mockResolvedValue(true);

      await appendOpenArtifactsLedgerEntry(vault, {
        ...ENTRY,
        status: "unpublished",
        url: null,
        publishedAt: null,
        version: null,
        contentHash: null,
      });

      expect(append).toHaveBeenCalledWith(
        LEDGER_PATH,
        `\n${String.raw`| 9f2k4mvq7t0xbz3n | unpublished | Notes/Architecture \\\| Review.md | — | — | — | — |`}\n`
      );
    });

    it("continues when another publish creates the ledger folder first", async () => {
      jest.mocked(ensureFolderExists).mockRejectedValueOnce(new Error("already exists"));
      exists.mockImplementation(async (path: string) => path === ".openartifacts");

      await appendOpenArtifactsLedgerEntry(vault, ENTRY);

      expect(append).toHaveBeenCalledWith(LEDGER_PATH, expect.stringContaining(ENTRY.docId));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/337 moves a stranded Symposium history before appending, and retries when the move fails", async () => {
      exists.mockImplementation(
        async (path: string) =>
          path === ".openartifacts" || path === ".symposium/publish-history.md"
      );
      rename.mockRejectedValueOnce(new Error("EBUSY")).mockResolvedValueOnce(undefined);

      await expect(appendOpenArtifactsLedgerEntry(vault, ENTRY)).rejects.toThrow("EBUSY");
      expect(append).not.toHaveBeenCalled();

      await appendOpenArtifactsLedgerEntry(vault, ENTRY);

      expect(rename).toHaveBeenLastCalledWith(".symposium/publish-history.md", LEDGER_PATH);
      expect(append).toHaveBeenCalledWith(LEDGER_PATH, expect.stringContaining(ENTRY.docId));
    });

    it("refuses to append to an unrelated existing file", async () => {
      exists.mockResolvedValue(true);
      read.mockResolvedValue(`${LEDGER_HEADER.split("\r\n")[0]}\nNot a ledger`);

      await expect(appendOpenArtifactsLedgerEntry(vault, ENTRY)).rejects.toThrow("non-ledger file");
      expect(append).not.toHaveBeenCalled();
    });
  });

  describe("migrateOpenArtifactsFolder()", () => {
    const exists = jest.fn();
    const rename = jest.fn();
    const vault = { adapter: { exists, rename } } as unknown as Vault;

    beforeEach(() => {
      jest.clearAllMocks();
      rename.mockResolvedValue(undefined);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/337 moves a Symposium-era folder to .openartifacts once", async () => {
      exists.mockImplementation(async (path: string) => path === ".symposium");

      await expect(migrateOpenArtifactsFolder(vault)).resolves.toBe(true);

      expect(rename).toHaveBeenCalledWith(".symposium", ".openartifacts");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/337 leaves both histories alone when the new one already exists", async () => {
      exists.mockResolvedValue(true);

      await expect(migrateOpenArtifactsFolder(vault)).resolves.toBe(false);

      expect(rename).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/337 moves only the history file when .openartifacts already exists", async () => {
      exists.mockImplementation(
        async (path: string) =>
          path === ".openartifacts" || path === ".symposium/publish-history.md"
      );

      await expect(migrateOpenArtifactsFolder(vault)).resolves.toBe(true);

      expect(rename).toHaveBeenCalledWith(
        ".symposium/publish-history.md",
        ".openartifacts/publish-history.md"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/337 does nothing in a vault that never published", async () => {
      exists.mockResolvedValue(false);

      await expect(migrateOpenArtifactsFolder(vault)).resolves.toBe(false);

      expect(rename).not.toHaveBeenCalled();
    });
  });
});
