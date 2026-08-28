import { requestUrl } from "obsidian";

export const GITHUB_RELEASES_URL = "https://github.com/logancyang/obsidian-copilot/releases/latest";

const GITHUB_RELEASES_API_URL =
  "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest";

// GitHub labels bare links to this repository as #1234; Obsidian does not.
// Skip URLs already owned by a Markdown link so authored labels stay intact.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/317
const BARE_GITHUB_REFERENCE =
  /(?<!\]\()https:\/\/github\.com\/logancyang\/obsidian-copilot\/(?:pull|issues)\/(\d+)/g;

interface GitHubReleaseResponse {
  body: string;
  html_url: string;
  tag_name: string;
}

function isGitHubReleaseResponse(value: unknown): value is GitHubReleaseResponse {
  if (typeof value !== "object" || value === null) return false;
  const release = value as Partial<GitHubReleaseResponse>;
  return (
    typeof release.body === "string" &&
    typeof release.html_url === "string" &&
    typeof release.tag_name === "string"
  );
}

export interface ReleaseNotes {
  body: string;
  htmlUrl: string;
  version: string;
}

/** Preserves GitHub's compact issue and PR labels in Obsidian-rendered release notes. */
export function formatReleaseNotesForObsidian(markdown: string): string {
  return markdown.replace(BARE_GITHUB_REFERENCE, "[#$1]($&)");
}

/**
 * Loads the latest release as raw Markdown so Obsidian, rather than GitHub's
 * expiring rendered HTML, owns the in-app presentation.
 */
export async function loadLatestReleaseNotes(): Promise<ReleaseNotes> {
  const response = await requestUrl({
    url: GITHUB_RELEASES_API_URL,
    method: "GET",
  });
  const release: unknown = response.json;

  // A partial API payload must enter the dialog's recoverable failure state,
  // not render broken links or an undefined body. https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  if (!isGitHubReleaseResponse(release)) {
    throw new Error("GitHub returned invalid release notes");
  }

  return {
    body: release.body,
    htmlUrl: release.html_url,
    version: release.tag_name.replace(/^v/, ""),
  };
}
