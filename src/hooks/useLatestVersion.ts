import { logError } from "@/logger";
import { checkLatestVersion, isNewerVersion, type LatestRelease } from "@/utils";
import { useEffect, useState, useSyncExternalStore } from "react";

interface UseLatestVersionResult {
  latestVersion: string | null;
  latestRelease: LatestRelease | null;
  hasUpdate: boolean;
}

let latestReleaseRequest: Promise<LatestRelease | null> | null = null;

/** Shares the latest release request between startup and mounted update surfaces. */
export function requestLatestRelease(): Promise<LatestRelease | null> {
  // Release surfaces share one request until a new agent tab invalidates it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  latestReleaseRequest ??= checkLatestVersion().then((result) => result.release);
  return latestReleaseRequest;
}

let releaseRevision = 0;
const releaseListeners = new Set<() => void>();

function subscribeToReleaseRefresh(listener: () => void): () => void {
  releaseListeners.add(listener);
  return () => {
    releaseListeners.delete(listener);
  };
}

function getReleaseRevision(): number {
  return releaseRevision;
}

/** Invalidates the shared release check and refreshes mounted release surfaces. */
export function refreshLatestVersion(): void {
  latestReleaseRequest = null;
  releaseRevision += 1;
  releaseListeners.forEach((listener) => listener());
}

export function useLatestVersion(currentVersion: string): UseLatestVersionResult {
  const revision = useSyncExternalStore(subscribeToReleaseRefresh, getReleaseRevision);
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null);

  useEffect(() => {
    let active = true;
    const checkVersion = async () => {
      const release = await requestLatestRelease();
      // A previous tab's slower check must not replace a newer release result.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
      if (active && release) {
        setLatestRelease(release);
      }
    };
    void checkVersion().catch((err) => logError("checkVersion failed", err));
    return () => {
      active = false;
    };
  }, [revision]);

  const latestVersion = latestRelease?.version ?? null;
  const hasUpdate = latestVersion !== null && isNewerVersion(latestVersion, currentVersion);

  return {
    latestVersion,
    latestRelease,
    hasUpdate,
  };
}
