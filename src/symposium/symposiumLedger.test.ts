import { appendSymposiumLedgerEntry, type SymposiumLedgerEntry } from "./symposiumLedger";
import { ensureFolderExists } from "@/utils";
import type { Vault } from "obsidian";

jest.mock("@/utils", () => ({ ensureFolderExists: jest.fn() }));

const LEDGER_PATH = ".symposium/publish-history.md";
const LEDGER_HEADER =
  "| Document ID | Status | Note | URL | Published at (UTC) | Version | Content SHA-256 |\r\n" +
  "| --- | --- | --- | --- | --- | ---: | --- |";
const ENTRY: SymposiumLedgerEntry = {
  docId: "9f2k4mvq7t0xbz3n",
  status: "published",
  notePath: String.raw`Notes/Architecture \| Review.md`,
  url: "https://symposium.site/d/9f2k4mvq7t0xbz3n",
  publishedAt: "2026-07-27T18:30:00.000Z",
  version: 1,
  contentHash: "abc123",
};

describe("symposiumLedger", () => {
  describe("appendSymposiumLedgerEntry()", () => {
    const append = jest.fn();
    const exists = jest.fn();
    const read = jest.fn();
    const vault = { adapter: { append, exists, read } } as unknown as Vault;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(ensureFolderExists).mockResolvedValue(undefined);
      append.mockResolvedValue(undefined);
      read.mockResolvedValue(LEDGER_HEADER);
    });

    it("creates hidden Markdown history and escapes table-breaking note paths", async () => {
      exists.mockResolvedValue(false);

      await appendSymposiumLedgerEntry(vault, ENTRY);

      expect(ensureFolderExists).toHaveBeenCalledWith(vault, ".symposium");
      expect(append).toHaveBeenCalledWith(
        LEDGER_PATH,
        expect.stringContaining(
          String.raw`| 9f2k4mvq7t0xbz3n | published | Notes/Architecture \\\| Review.md | <https://symposium.site/d/9f2k4mvq7t0xbz3n> | 2026-07-27T18:30:00.000Z | 1 | abc123 |`
        )
      );
      expect(append.mock.calls[0][1]).toContain("| Document ID | Status | Note | URL |");
    });

    it("appends withdrawal records without adding another header", async () => {
      exists.mockResolvedValue(true);

      await appendSymposiumLedgerEntry(vault, {
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
      exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await appendSymposiumLedgerEntry(vault, ENTRY);

      expect(append).toHaveBeenCalledWith(LEDGER_PATH, expect.stringContaining(ENTRY.docId));
    });

    it("refuses to append to an unrelated existing file", async () => {
      exists.mockResolvedValue(true);
      read.mockResolvedValue(`${LEDGER_HEADER.split("\r\n")[0]}\nNot a ledger`);

      await expect(appendSymposiumLedgerEntry(vault, ENTRY)).rejects.toThrow("non-ledger file");
      expect(append).not.toHaveBeenCalled();
    });
  });
});
