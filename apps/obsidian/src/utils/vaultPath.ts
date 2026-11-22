import { App, FileSystemAdapter } from "obsidian";

let cachedBase: string | null | undefined;

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

export function __resetVaultBaseCache(): void {
  cachedBase = undefined;
}

export function toVaultRelative(p: string, vaultBase: string | null): string {
  if (!vaultBase || !p || !isAbsolutePath(p)) return p;
  const base = stripTrailingSep(vaultBase);
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
