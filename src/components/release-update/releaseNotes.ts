import { logWarn } from "@/logger";
import type { LatestRelease } from "@/utils";
import { compareSemver } from "@/utils/semver";
import { requestUrl } from "obsidian";

const GITHUB_REFERENCE_URL =
  /^https:\/\/github\.com\/logancyang\/obsidian-copilot\/(?:pull|issues)\/(\d+)$/;

/**
 * Compacts URL-only GitHub links after Obsidian has safely parsed the Markdown.
 * @param container - Rendered release-note content whose link labels may be shortened.
 */
export function formatReleaseNotesForObsidian(container: HTMLElement): void {
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    // Operate only on URL labels produced by Obsidian's linkifier; authored
    // labels, code, images, and HTML attributes remain untouched.
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

// Canary prereleases share this list, so page past them to reach the stable releases.
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

/**
 * Collects the notes for every stable release a user skipped, newest first, so
 * someone several versions behind sees each change rather than only the latest.
 * @param currentVersion - Installed plugin version; it and older releases are left out.
 * @param latest - Release found by the update check; it leads the list and is the
 *   only entry when GitHub's release list cannot be read.
 */
export async function requestReleaseNotesSince(
  currentVersion: string,
  latest: LatestRelease
): Promise<LatestRelease[]> {
  try {
    const skipped: LatestRelease[] = [];
    // Accumulated prereleases can fill whole pages, so keep reading until the notes are
    // full, an installed-or-older release appears, or the list ends.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/600
    for (let page = 1; skipped.length < MAX_RELEASE_NOTES - 1; page++) {
      const response = await requestUrl({ url: `${RELEASES_API_URL}&page=${page}`, method: "GET" });
      const items: GitHubReleaseListItem[] = Array.isArray(response.json) ? response.json : [];
      let reachedInstalled = false;
      for (const item of items) {
        // Only stable releases the user skipped belong here. The latest already leads the
        // list and is matched by URL, since its tag can differ from its manifest version.
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
    // A rate-limited or offline list must not hide the notes the dialog already has.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/600
    logWarn("Copilot release history request failed", error);
    return [latest];
  }
}
