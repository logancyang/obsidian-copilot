import { requestUrl } from "obsidian";

const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest";

export interface LatestRelease {
  body: string;
  htmlUrl: string;
  version: string;
}

export interface LatestReleaseResult {
  error: string | null;
  release: LatestRelease | null;
}

interface GitHubReleaseResponse {
  body?: unknown;
  html_url?: unknown;
  tag_name?: unknown;
}

/** Load the latest published Copilot release used for both version checks and release notes. */
export async function checkLatestRelease(): Promise<LatestReleaseResult> {
  try {
    const response = await requestUrl({
      url: LATEST_RELEASE_API_URL,
      method: "GET",
    });
    const release = response.json as GitHubReleaseResponse;
    if (typeof release.tag_name !== "string") {
      throw new Error("The latest Copilot release has no version tag.");
    }

    return {
      error: null,
      release: {
        body: typeof release.body === "string" ? release.body : "",
        htmlUrl:
          typeof release.html_url === "string"
            ? release.html_url
            : "https://github.com/logancyang/obsidian-copilot/releases/latest",
        version: release.tag_name.replace(/^v/, ""),
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to check for updates",
      release: null,
    };
  }
}
