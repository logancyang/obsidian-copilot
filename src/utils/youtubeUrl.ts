/**
 * Pure YouTube URL parsing utilities.
 *
 * Reason: These functions are needed by both utils (urlTagUtils) and services
 * (webViewerService). Placing them in a neutral utils module avoids a utils → service
 * dependency and keeps the dependency graph clean.
 */

/**
 * Extract YouTube video ID from various URL formats.
 * Supports: youtube.com/watch, youtu.be, youtube.com/shorts, m.youtube.com, embed
 * @returns video ID or null if not a valid YouTube video URL
 */
export function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

    // youtube.com/watch?v=xxx or youtube.com/watch?v=xxx&t=120
    if (hostname === "youtube.com" && u.pathname === "/watch") {
      return u.searchParams.get("v");
    }

    // youtu.be/xxx or youtu.be/xxx?t=120
    if (hostname === "youtu.be" && u.pathname.length > 1) {
      return u.pathname.slice(1).split("/")[0];
    }

    // youtube.com/shorts/xxx
    if (hostname === "youtube.com" && u.pathname.startsWith("/shorts/")) {
      return u.pathname.split("/")[2] || null;
    }

    // youtube.com/embed/xxx
    if (hostname === "youtube.com" && u.pathname.startsWith("/embed/")) {
      return u.pathname.split("/")[2] || null;
    }

    return null;
  } catch {
    return null;
  }
}

/** Check if URL is a YouTube video page */
export function isYouTubeVideoUrl(url: string): boolean {
  return getYouTubeVideoId(url) !== null;
}
