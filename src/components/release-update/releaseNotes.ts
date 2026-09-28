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

// Canary prereleases share this list, so fetch past them to reach the stable releases.
const RELEASES_API_URL =
  "https://api.github.com/repos/logancyang/obsidian-copilot/releases?per_page=30";
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
    const response = await requestUrl({ url: RELEASES_API_URL, method: "GET" });
    const items: GitHubReleaseListItem[] = Array.isArray(response.json) ? response.json : [];
    const skipped = items.flatMap((item): LatestRelease[] => {
      // Only stable releases the user skipped belong here; the latest already leads the
      // list under its manifest version, which can differ from its tag.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/600
      if (item.draft || item.prerelease || typeof item.tag_name !== "string") return [];
      const version = item.tag_name.replace(/^v/, "");
      if (compareSemver(version, currentVersion) <= 0) return [];
      if (compareSemver(version, latest.version) >= 0) return [];
      return [
        {
          body: typeof item.body === "string" ? item.body : "",
          htmlUrl: typeof item.html_url === "string" ? item.html_url : latest.htmlUrl,
          version,
        },
      ];
    });
    skipped.sort((a, b) => compareSemver(b.version, a.version));
    return [latest, ...skipped].slice(0, MAX_RELEASE_NOTES);
  } catch (error) {
    // A rate-limited or offline list must not hide the notes the dialog already has.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/600
    logWarn("Copilot release history request failed", error);
    return [latest];
  }
}
