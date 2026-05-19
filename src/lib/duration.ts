/**
 * Format a millisecond duration as a short human-readable string.
 *
 * Rules:
 * - `< 1000 ms` → `< 1s`
 * - `< 60 s` → `Ns` (e.g. `42s`)
 * - `< 60 min` → `Xm Ys`, omit seconds if zero (e.g. `3m 30s`, `5m`)
 * - `≥ 60 min` → `Xh Ym`, omit minutes if zero (e.g. `1h 12m`, `2h`)
 *
 * Negative inputs are clamped to zero.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "< 1s";
  if (ms < 1000) return "< 1s";

  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
