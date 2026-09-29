export function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (hostname === "youtube.com" && u.pathname === "/watch") {
      return u.searchParams.get("v");
    }

    if (hostname === "youtu.be" && u.pathname.length > 1) {
      return u.pathname.slice(1).split("/")[0];
    }

    if (hostname === "youtube.com" && u.pathname.startsWith("/shorts/")) {
      return u.pathname.split("/")[2] || null;
    }

    if (hostname === "youtube.com" && u.pathname.startsWith("/embed/")) {
      return u.pathname.split("/")[2] || null;
    }

    return null;
  } catch {
    return null;
  }
}
