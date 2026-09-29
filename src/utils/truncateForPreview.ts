export const PREVIEW_RENDER_LIMIT = 30_000;

const SNAP_BACK_WINDOW = 1_024;

export interface TruncatedPreview {
  text: string;
  truncated: boolean;
}

export function truncateForPreview(
  content: string,
  limit = PREVIEW_RENDER_LIMIT
): TruncatedPreview {
  if (content.length <= limit) {
    return { text: content, truncated: false };
  }

  const newlineIndex = content.lastIndexOf("\n", limit);
  const endIndex =
    newlineIndex >= limit - SNAP_BACK_WINDOW && newlineIndex > 0 ? newlineIndex : limit;
  return { text: content.slice(0, endIndex), truncated: true };
}
