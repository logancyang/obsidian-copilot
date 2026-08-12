/**
 * Migration-only reader for values the plugin wrote to raw `localStorage`
 * before moving to Obsidian's vault-scoped `App.loadLocalStorage` /
 * `App.saveLocalStorage` (GitHub #298). Callers copy the value forward into
 * vault-scoped storage on first read.
 *
 * This is the single place production code still touches raw storage, and it
 * only ever reads: legacy keys are never written or deleted, because other
 * vaults on the same device may not have migrated yet and still need them.
 */

/** Read a legacy raw-localStorage value, or `null` when absent or unreadable. */
export function readLegacyLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage is disabled or restricted; there is nothing to migrate.
    return null;
  }
}
