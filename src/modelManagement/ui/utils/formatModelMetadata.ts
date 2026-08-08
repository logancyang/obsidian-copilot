/**
 * Shared formatters for catalog-sourced model metadata (context window,
 * release date). Used by both the catalog picker (`ProviderCatalogList`)
 * and the configured-models table (`ByokGlobalTable`) so the same value
 * renders identically wherever it appears. Pure — no imports.
 */

/**
 * Format a token-count context window as a compact label.
 *
 *   - `>= 1_000_000` → `"1.5M"` (one decimal, trailing `.0` trimmed)
 *   - `>= 1_000`     → `"200K"` (rounded)
 *   - smaller        → the number as-is
 *   - missing / zero → `""` so callers can render unconditionally
 */
export function formatContextWindow(context?: number): string {
  if (!context) return "";
  if (context >= 1_000_000) return `${(context / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (context >= 1_000) return `${Math.round(context / 1_000)}K`;
  return String(context);
}

/**
 * Pretty-print a catalog release date (ISO-ish "YYYY-MM-DD") as e.g.
 * `Sep 25`. Returns `""` for missing or unparseable input so callers can
 * render unconditionally.
 */
export function formatReleaseDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Date-only ISO strings parse as UTC midnight; format in UTC too so a
  // negative-offset timezone doesn't shift "2025-09-01" back to August.
  return d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}
