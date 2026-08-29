/**
 * Parse the context-window label published by the Copilot Plus catalog.
 *
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 *
 * @param display - Server-provided token count such as `1M`, `256K`, or `8192`.
 */
export function parseCopilotPlusContextLength(display: unknown): number | null {
  if (typeof display !== "string") return null;
  const match = /^\s*([\d.]+)\s*([KMkm])?\s*$/.exec(display);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2]?.toUpperCase();
  const multiplier = unit === "M" ? 1024 * 1024 : unit === "K" ? 1024 : 1;
  return Math.round(value * multiplier);
}
