import { OPENARTIFACTS_VAULT_FOLDER } from "@/openArtifacts/constants";
import { ensureFolderExists } from "@/utils";
import type { Vault } from "obsidian";

export const OPENARTIFACTS_LEDGER_FOLDER = OPENARTIFACTS_VAULT_FOLDER;
export const OPENARTIFACTS_LEDGER_PATH = `${OPENARTIFACTS_LEDGER_FOLDER}/publish-history.md`;
const LEGACY_LEDGER_FOLDER = ".symposium";
const LEGACY_LEDGER_PATH = `${LEGACY_LEDGER_FOLDER}/publish-history.md`;

/**
 * Moves a vault's Symposium-era publishing history to its OpenArtifacts home so it
 * stays one file after the cutover. The whole folder moves when the new one does not
 * exist yet. When it does (a staged handoff or another device created it first), only
 * the history file moves, and only while the new one is still absent, so two histories
 * are never merged. Runs at plugin start and again before every ledger append, so a
 * rename that failed once is retried rather than leaving the old history stranded.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/337
 *
 * @param vault The vault whose publishing history may still live under the old name.
 */
export async function migrateOpenArtifactsFolder(vault: Vault): Promise<boolean> {
  const { adapter } = vault;
  if (!(await adapter.exists(OPENARTIFACTS_LEDGER_FOLDER))) {
    if (!(await adapter.exists(LEGACY_LEDGER_FOLDER))) return false;
    await adapter.rename(LEGACY_LEDGER_FOLDER, OPENARTIFACTS_LEDGER_FOLDER);
    return true;
  }
  if (await adapter.exists(OPENARTIFACTS_LEDGER_PATH)) return false;
  if (!(await adapter.exists(LEGACY_LEDGER_PATH))) return false;
  await adapter.rename(LEGACY_LEDGER_PATH, OPENARTIFACTS_LEDGER_PATH);
  return true;
}

export interface OpenArtifactsLedgerEntry {
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
| --- | --- | --- | --- | --- | ---: | --- |`;

function tableCell(value: string | number | null): string {
  if (value === null) return "—";
  return String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

export async function appendOpenArtifactsLedgerEntry(
  vault: Vault,
  entry: OpenArtifactsLedgerEntry
): Promise<void> {
  // A failed move throws before anything is written, so the caller's ledger warning
  // fires and the next append retries instead of starting a second history.
  await migrateOpenArtifactsFolder(vault);
  await ensureFolderExists(vault, OPENARTIFACTS_LEDGER_FOLDER).catch(async (error) => {
    if (!(await vault.adapter.exists(OPENARTIFACTS_LEDGER_FOLDER))) throw error;
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
  const exists = await vault.adapter.exists(OPENARTIFACTS_LEDGER_PATH);
  const existing = exists ? await vault.adapter.read(OPENARTIFACTS_LEDGER_PATH) : "";
  const normalized = existing.replace(/\r\n?/g, "\n");
  if (exists && normalized !== LEDGER_HEADER && !normalized.startsWith(`${LEDGER_HEADER}\n`)) {
    throw new Error(`Refusing to append to non-ledger file: ${OPENARTIFACTS_LEDGER_PATH}`);
  }
  const rowPrefix = exists && !/[\r\n]$/.test(existing) ? "\n" : "";
  await vault.adapter.append(
    OPENARTIFACTS_LEDGER_PATH,
    `${exists ? rowPrefix : `${LEDGER_HEADER}\n`}| ${row} |\n`
  );
}
