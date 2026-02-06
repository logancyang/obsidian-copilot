import { MD5 } from "crypto-js";
import { App } from "obsidian";

/**
 * Compute a stable source_id for Miyo based on the vault name.
 *
 * @param app - Obsidian application instance.
 * @returns MD5 hash of the vault name.
 */
export function getMiyoSourceId(app: App): string {
  return MD5(app.vault.getName()).toString();
}
