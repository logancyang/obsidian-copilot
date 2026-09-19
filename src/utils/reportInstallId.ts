import type { App } from "obsidian";
import { v4 as uuidv4, validate as validateUuid, version as uuidVersion } from "uuid";

const REPORT_INSTALL_ID_STORAGE_KEY = "obsidian-copilot:report-install-id:v1";

/**
 * Return a stable report-upload identifier for this vault on this device.
 * The random UUID groups reports and supports rate limits without linking them
 * to a Copilot account. Obsidian's vault-scoped device-local store is not synced.
 *
 * @param app - Obsidian app whose vault owns the report identifier.
 * @throws When the identifier cannot be read or persisted. The upload adapter
 *   handles the error so an ephemeral identifier cannot bypass rate limits.
 */
export function getReportInstallId(app: App): string {
  const existing = app.loadLocalStorage(REPORT_INSTALL_ID_STORAGE_KEY);
  // The endpoint rejects the entire upload unless the identifier is a UUIDv4.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
  if (typeof existing === "string" && validateUuid(existing) && uuidVersion(existing) === 4) {
    return existing;
  }

  const minted = uuidv4();
  app.saveLocalStorage(REPORT_INSTALL_ID_STORAGE_KEY, minted);
  // Obsidian can swallow write failures. Refuse an ephemeral identifier that
  // would reset the report-upload rate limit on every attempt.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
  if (app.loadLocalStorage(REPORT_INSTALL_ID_STORAGE_KEY) !== minted) {
    throw new Error("Report identifier could not be saved.");
  }
  return minted;
}
