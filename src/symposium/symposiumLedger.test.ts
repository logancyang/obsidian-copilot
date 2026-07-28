import { appendSymposiumLedgerEntry, type SymposiumLedgerEntry } from "./symposiumLedger";
import { ensureFolderExists } from "@/utils";
import type { Vault } from "obsidian";

jest.mock("@/utils", () => ({ ensureFolderExists: jest.fn() }));

const LEDGER_PATH = "copilot/symposium/published-documents.md";
const ENTRY: SymposiumLedgerEntry = {
  docId: "9f2k4mvq7t0xbz3n",
  status: "published",
  notePath: "Notes/Architecture | Review.md",
  url: "https://symposium.site/d/9f2k4mvq7t0xbz3n",
  publishedAt: "2026-07-27T18:30:00.000Z",
  version: 1,
  contentHash: "abc123",
};

describe("symposiumLedger", () => {
  describe("appendSymposiumLedgerEntry()", () => {
    const append = jest.fn();
    const exists = jest.fn();
    const vault = { adapter: { append, exists } } as unknown as Vault;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(ensureFolderExists).mockResolvedValue(undefined);
      append.mockResolvedValue(undefined);
    });

    it("creates a readable Markdown ledger and escapes table-breaking note paths", async () => {
      exists.mockResolvedValue(false);

      await appendSymposiumLedgerEntry(vault, ENTRY);

      expect(ensureFolderExists).toHaveBeenCalledWith(vault, "copilot/symposium");
      expect(append).toHaveBeenCalledWith(
        LEDGER_PATH,
        expect.stringContaining(
          "| 9f2k4mvq7t0xbz3n | published | Notes/Architecture \\| Review.md | <https://symposium.site/d/9f2k4mvq7t0xbz3n> | 2026-07-27T18:30:00.000Z | 1 | abc123 |"
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
        "| 9f2k4mvq7t0xbz3n | unpublished | Notes/Architecture \\| Review.md | — | — | — | — |\n"
      );
    });

    it("continues when another publish creates the ledger folder first", async () => {
      jest.mocked(ensureFolderExists).mockRejectedValueOnce(new Error("already exists"));
      exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await appendSymposiumLedgerEntry(vault, ENTRY);

      expect(append).toHaveBeenCalledWith(LEDGER_PATH, expect.stringContaining(ENTRY.docId));
    });
  });
});
