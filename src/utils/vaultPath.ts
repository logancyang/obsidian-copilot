import { App, FileSystemAdapter } from "obsidian";

let cachedBase: string | null | undefined;

/**
 * Returns the vault root absolute path on desktop, or null on mobile /
 * test environments where the `FileSystemAdapter` isn't available. Cached
 * after the first successful read because the vault root cannot change
 * for the lifetime of the plugin instance.
 *
 * @param app The Obsidian `App` instance used to access the vault adapter.
 */
export function getVaultBase(app: App): string | null {
  if (cachedBase !== undefined) return cachedBase;
  try {
    const adapter = app.vault?.adapter;
    cachedBase =
      adapter instanceof FileSystemAdapter ? stripTrailingSep(adapter.getBasePath()) : null;
  } catch {
    cachedBase = null;
  }
  return cachedBase;
}

/** Test-only cache reset to keep `getVaultBase` deterministic across cases. */
export function __resetVaultBaseCache(): void {
  cachedBase = undefined;
}

/**
 * If `p` is an absolute path inside `vaultBase`, return it as a
 * forward-slashed vault-relative path. Otherwise (relative path,
 * outside vault, or null base) return `p` unchanged.
 *
 * Uses string ops only — `node:path` is unavailable on mobile Obsidian.
 */
export function toVaultRelative(p: string, vaultBase: string | null): string {
  if (!vaultBase || !p || !isAbsolutePath(p)) return p;
  const base = stripTrailingSep(vaultBase);
  // Match the base only on a path-segment boundary so `/vault-other/x` doesn't
  // get treated as inside `/vault`.
  const normalizedP = p.replace(/\\/g, "/");
  const normalizedBase = base.replace(/\\/g, "/");
  if (normalizedP === normalizedBase) return p;
  if (!normalizedP.startsWith(normalizedBase + "/")) return p;
  const rel = normalizedP.slice(normalizedBase.length + 1);
  return rel || p;
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

function stripTrailingSep(p: string): string {
  return p.replace(/[\\/]+$/, "");
}
