import {
  appendSymposiumLedgerEntry,
  SYMPOSIUM_LEDGER_FOLDER,
  SYMPOSIUM_LEDGER_PATH,
  type SymposiumLedgerEntry,
} from "@/symposium/symposiumLedger";
import type { Vault } from "obsidian";

const ENTRY: SymposiumLedgerEntry = {
  docId: "9f2k4mvq7t0xbz3n",
  status: "published",
  notePath: "Notes/Architecture | Review.md",
  url: "https://symposium.site/d/9f2k4mvq7t0xbz3n",
  publishedAt: "2026-07-27T18:30:00.000Z",
  version: 1,
  contentHash: "abc123",
};

interface VaultHarness {
  contents: Map<string, string>;
  mkdir: jest.Mock;
  vault: Vault;
  write: jest.Mock;
}

function createVault(): VaultHarness {
  const contents = new Map<string, string>();
  const folders = new Set<string>();
  const mkdir = jest.fn(async (path: string) => {
    folders.add(path);
  });
  const write = jest.fn(async (path: string, content: string) => {
    contents.set(path, content);
  });
  const vault = {
    getAbstractFileByPath: jest.fn((path: string) =>
      folders.has(path) ? { path, children: [] } : null
    ),
    adapter: {
      exists: jest.fn(async (path: string) => contents.has(path)),
      mkdir,
      read: jest.fn(async (path: string) => contents.get(path) ?? ""),
      write,
    },
  } as unknown as Vault;
  return { contents, mkdir, vault, write };
}

describe("symposiumLedger", () => {
  describe("appendSymposiumLedgerEntry()", () => {
    it("creates a readable Markdown ledger and escapes table-breaking note paths", async () => {
      const harness = createVault();

      await appendSymposiumLedgerEntry(harness.vault, ENTRY);

      expect(harness.mkdir).toHaveBeenCalledWith("copilot");
      expect(harness.mkdir).toHaveBeenCalledWith(SYMPOSIUM_LEDGER_FOLDER);
      expect(harness.contents.get(SYMPOSIUM_LEDGER_PATH)).toContain(
        "| Document ID | Status | Note | URL | Published at (UTC) | Version | Content SHA-256 |"
      );
      expect(harness.contents.get(SYMPOSIUM_LEDGER_PATH)).toContain(
        "| 9f2k4mvq7t0xbz3n | published | Notes/Architecture \\| Review.md | <https://symposium.site/d/9f2k4mvq7t0xbz3n> | 2026-07-27T18:30:00.000Z | 1 | abc123 |"
      );
    });

    it("appends withdrawal records without deleting publication history", async () => {
      const harness = createVault();
      await appendSymposiumLedgerEntry(harness.vault, ENTRY);

      await appendSymposiumLedgerEntry(harness.vault, {
        ...ENTRY,
        status: "unpublished",
        url: null,
        publishedAt: null,
        version: null,
        contentHash: null,
      });

      const ledger = harness.contents.get(SYMPOSIUM_LEDGER_PATH) ?? "";
      expect(ledger.match(/\| 9f2k4mvq7t0xbz3n \|/g)).toHaveLength(2);
      expect(ledger).toContain(
        "| 9f2k4mvq7t0xbz3n | unpublished | Notes/Architecture \\| Review.md | — | — | — | — |"
      );
    });

    it("serializes concurrent writes and continues after an earlier write fails", async () => {
      const harness = createVault();
      let releaseFirst: (() => void) | undefined;
      harness.write
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              releaseFirst = () => reject(new Error("read-only"));
            })
        )
        .mockImplementation(async (path: string, content: string) => {
          harness.contents.set(path, content);
        });

      const first = appendSymposiumLedgerEntry(harness.vault, ENTRY);
      const second = appendSymposiumLedgerEntry(harness.vault, {
        ...ENTRY,
        docId: "0123456789abcdef",
      });
      for (let turn = 0; turn < 20 && !releaseFirst; turn += 1) {
        await Promise.resolve();
      }

      expect(releaseFirst).toBeDefined();
      expect(harness.write).toHaveBeenCalledTimes(1);
      releaseFirst?.();
      await expect(first).rejects.toThrow("read-only");
      await expect(second).resolves.toBeUndefined();
      expect(harness.write).toHaveBeenCalledTimes(2);
      expect(harness.contents.get(SYMPOSIUM_LEDGER_PATH)).toContain("0123456789abcdef");
    });
  });
});
