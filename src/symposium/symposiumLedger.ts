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

const LEDGER_COLUMNS =
  "| Document ID | Status | Note | URL | Published at (UTC) | Version | Content SHA-256 |";
const LEDGER_HEADER = `${LEDGER_COLUMNS}
| --- | --- | --- | --- | --- | ---: | --- |
`;

function tableCell(value: string | number | null): string {
  if (value === null) return "—";
  return String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

export async function appendSymposiumLedgerEntry(
  vault: Vault,
  entry: SymposiumLedgerEntry
): Promise<void> {
  await ensureFolderExists(vault, SYMPOSIUM_LEDGER_FOLDER).catch(async (error) => {
    if (!(await vault.adapter.exists(SYMPOSIUM_LEDGER_FOLDER))) throw error;
  });
  const row = [
    entry.docId,
    entry.status,
    entry.notePath,
    entry.url ? `<${entry.url}>` : null,
    entry.publishedAt,
    entry.version,
    entry.contentHash,
  ]
    .map(tableCell)
    .join(" | ");
  const exists = await vault.adapter.exists(SYMPOSIUM_LEDGER_PATH);
  if (exists && !(await vault.adapter.read(SYMPOSIUM_LEDGER_PATH)).startsWith(LEDGER_COLUMNS)) {
    throw new Error(`Refusing to append to non-ledger note: ${SYMPOSIUM_LEDGER_PATH}`);
  }
  await vault.adapter.append(SYMPOSIUM_LEDGER_PATH, `${exists ? "" : LEDGER_HEADER}| ${row} |\n`);
}
