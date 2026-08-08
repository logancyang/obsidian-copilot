/**
 * Maximum number of characters fed to the markdown renderer in a single
 * synchronous pass. `MarkdownRenderer.render` builds the whole DOM tree on the
 * main thread with no lazy/section rendering, so an unbounded parsed snapshot
 * (PDF/URL text can reach several MB) freezes the UI until it finishes. Render
 * cost scales with this cap, so it is kept modest to keep open latency low —
 * dense single-line payloads (e.g. a spreadsheet dumped as one JSON line) are
 * especially expensive to lay out. ~30 KB still shows plenty to confirm a parse;
 * the full content is always available via Copy.
 */
export const PREVIEW_RENDER_LIMIT = 30_000;

/**
 * How far back from the limit we'll hunt for a line break to cut on. Kept small
 * so a single very long line (e.g. minified JSON / a one-line spreadsheet dump)
 * can't snap the cut back near the start and collapse the preview to a handful
 * of characters — past this window we just hard-cut and keep the full budget.
 */
const SNAP_BACK_WINDOW = 1_024;

export interface TruncatedPreview {
  /** The slice safe to render (whole content when not truncated). */
  text: string;
  /** True when the content exceeded the limit and `text` is a prefix of it. */
  truncated: boolean;
}

/**
 * Bound the cost of a one-shot markdown render by capping the input length.
 *
 * When truncation is needed we back the cut up to the last newline at or before
 * `limit` so the visible content ends on a clean line boundary instead of
 * mid-word; if there is no newline in range we hard-cut at `limit`.
 */
export function truncateForPreview(
  content: string,
  limit = PREVIEW_RENDER_LIMIT
): TruncatedPreview {
  if (content.length <= limit) {
    return { text: content, truncated: false };
  }

  // Snap to a line break only when one sits within SNAP_BACK_WINDOW of the
  // limit, so normal multi-line text cuts cleanly; a long unbroken line has no
  // nearby newline and gets hard-cut at the limit to preserve the budget.
  const newlineIndex = content.lastIndexOf("\n", limit);
  const endIndex =
    newlineIndex >= limit - SNAP_BACK_WINDOW && newlineIndex > 0 ? newlineIndex : limit;
  return { text: content.slice(0, endIndex), truncated: true };
}
