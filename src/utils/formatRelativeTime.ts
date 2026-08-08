const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// Month is a coarse 30-day bucket — these are glanceable labels, not precise
// calendar math.
const MONTH = 30 * DAY;

/**
 * Compact, glanceable "time ago" label for list rows (e.g. `now`, `5m`, `3h`,
 * `2d`, `4w`, `6mo`). Single-unit, no suffix word — matches the row chips in
 * the Agent Home design.
 *
 * `nowMs` is injectable so callers (and tests) control "now"; the bucket math
 * never reads the clock itself. Future timestamps and sub-minute ages both
 * render as `now`.
 *
 * A non-finite age (e.g. a corrupt `epoch` frontmatter value upstream yields an
 * Invalid Date whose `getTime()` is `NaN`) also renders as `now` rather than
 * falling through to a literal `"NaNmo"`.
 */
export function formatCompactRelativeTime(ms: number, nowMs: number = Date.now()): string {
  const diff = nowMs - ms;
  if (!Number.isFinite(diff)) return "now";
  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w`;
  return `${Math.floor(diff / MONTH)}mo`;
}
