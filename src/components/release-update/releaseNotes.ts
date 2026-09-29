import { logWarn } from "@/logger";
import type { LatestRelease } from "@/utils";
import { compareSemver } from "@/utils/semver";
import { requestUrl } from "obsidian";

const GITHUB_REFERENCE_URL =
  /^https:\/\/github\.com\/logancyang\/obsidian-copilot\/(?:pull|issues)\/(\d+)$/;

// Demo video shape: `[![Demo video: <title>](<thumbnail>)](<video>)`. The alt-text
// keyword distinguishes it from screenshots.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/603
const DEMO_VIDEO = /\[!\[Demo video:\s*([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)/;

export interface ReleaseVideo {
  thumbnailUrl: string;
  title: string;
  url: string;
}

export function findReleaseVideo(markdown: string): ReleaseVideo | null {
  const match = DEMO_VIDEO.exec(markdown);
  return match ? { title: match[1], thumbnailUrl: match[2], url: match[3] } : null;
}

export function formatReleaseNotesForObsidian(container: HTMLElement): void {
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    // Only rewrite labels Obsidian's linkifier produced, never authored ones.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
    if (link.closest("code, pre")) continue;

    const href = link.getAttribute("href");
    if (!href || link.textContent !== href) continue;

    const reference = GITHUB_REFERENCE_URL.exec(href);
    if (reference) {
      link.textContent = `#${reference[1]}`;
    }
  }
}

const RELEASES_PAGE_SIZE = 30;
const RELEASES_API_URL = `https://api.github.com/repos/logancyang/obsidian-copilot/releases?per_page=${RELEASES_PAGE_SIZE}`;
const MAX_RELEASE_NOTES = 10;

interface GitHubReleaseListItem {
  body?: unknown;
  draft?: unknown;
  html_url?: unknown;
  prerelease?: unknown;
  tag_name?: unknown;
}

export async function requestReleaseNotesSince(
  currentVersion: string,
  latest: LatestRelease
): Promise<LatestRelease[]> {
  try {
    const skipped: LatestRelease[] = [];
    // Prereleases can fill whole pages, so keep paging until enough stable notes are found.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/600
    for (let page = 1; skipped.length < MAX_RELEASE_NOTES - 1; page++) {
      const response = await requestUrl({ url: `${RELEASES_API_URL}&page=${page}`, method: "GET" });
      const items: GitHubReleaseListItem[] = Array.isArray(response.json) ? response.json : [];
      let reachedInstalled = false;
      for (const item of items) {
        // Match the latest by URL: its tag can differ from its manifest version.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/600
        if (item.draft || item.prerelease || typeof item.tag_name !== "string") continue;
        if (item.html_url === latest.htmlUrl) continue;
        const version = item.tag_name.replace(/^v/, "");
        if (compareSemver(version, currentVersion) <= 0) {
          reachedInstalled = true;
          continue;
        }
        if (compareSemver(version, latest.version) >= 0) continue;
        skipped.push({
          body: typeof item.body === "string" ? item.body : "",
          htmlUrl: typeof item.html_url === "string" ? item.html_url : latest.htmlUrl,
          version,
        });
      }
      if (reachedInstalled || items.length < RELEASES_PAGE_SIZE) break;
    }
    skipped.sort((a, b) => compareSemver(b.version, a.version));
    return [latest, ...skipped].slice(0, MAX_RELEASE_NOTES);
  } catch (error) {
    logWarn("Copilot release history request failed", error);
    return [latest];
  }
}
