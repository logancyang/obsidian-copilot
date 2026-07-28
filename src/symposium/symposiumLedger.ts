import { COPILOT_FOLDER_ROOT } from "@/constants";
import { ensureFolderExists } from "@/utils";
import type { Vault } from "obsidian";

export const SYMPOSIUM_LEDGER_FOLDER = `${COPILOT_FOLDER_ROOT}/symposium`;
export const SYMPOSIUM_LEDGER_PATH = `${SYMPOSIUM_LEDGER_FOLDER}/published-documents.md`;

export interface SymposiumLedgerEntry {
  docId: string;
  status: "published" | "unpublished";
  notePath: string;
  url: string | null;
  publishedAt: string | null;
  version: number | null;
  contentHash: string | null;
}

const LEDGER_HEADER = `# Symposium publication ledger

This append-only ledger keeps Symposium document IDs recoverable independently of note properties.

| Document ID | Status | Note | URL | Published at (UTC) | Version | Content SHA-256 |
| --- | --- | --- | --- | --- | ---: | --- |
`;
const ledgerWriteTails = new WeakMap<Vault, Promise<void>>();

function tableCell(value: string | number | null): string {
  if (value === null) {
    return "—";
  }
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function ledgerRow(entry: SymposiumLedgerEntry): string {
  const url = entry.url ? `<${entry.url}>` : null;
  return `| ${tableCell(entry.docId)} | ${entry.status} | ${tableCell(entry.notePath)} | ${tableCell(url)} | ${tableCell(entry.publishedAt)} | ${tableCell(entry.version)} | ${tableCell(entry.contentHash)} |`;
}

async function writeLedgerEntry(vault: Vault, entry: SymposiumLedgerEntry): Promise<void> {
  await ensureFolderExists(vault, SYMPOSIUM_LEDGER_FOLDER);
  const exists = await vault.adapter.exists(SYMPOSIUM_LEDGER_PATH);
  const current = exists ? await vault.adapter.read(SYMPOSIUM_LEDGER_PATH) : LEDGER_HEADER;
  const separator = current.endsWith("\n") ? "" : "\n";
  await vault.adapter.write(SYMPOSIUM_LEDGER_PATH, `${current}${separator}${ledgerRow(entry)}\n`);
}

/**
 * Appends one durable publication record while serializing all writes for the vault.
 *
 * @param vault The vault that owns the human-readable ledger.
 * @param entry The successful remote action to preserve.
 */
export async function appendSymposiumLedgerEntry(
  vault: Vault,
  entry: SymposiumLedgerEntry
): Promise<void> {
  const previous = ledgerWriteTails.get(vault) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeLedgerEntry(vault, entry));
  ledgerWriteTails.set(vault, current);
  try {
    await current;
  } finally {
    if (ledgerWriteTails.get(vault) === current) {
      ledgerWriteTails.delete(vault);
    }
  }
}
