import { logError } from "@/logger";
import { checkLatestVersion, isNewerVersion, type LatestRelease } from "@/utils";
import { useEffect, useState, useSyncExternalStore } from "react";

interface UseLatestVersionResult {
  latestVersion: string | null;
  latestRelease: LatestRelease | null;
  hasUpdate: boolean;
}

export const LATEST_VERSION_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

let latestReleaseRequest: Promise<LatestRelease | null> | null = null;
let latestReleaseRequestedAt = 0;

export function requestLatestRelease(): Promise<LatestRelease | null> {
  if (!latestReleaseRequest) {
    latestReleaseRequestedAt = Date.now();
    latestReleaseRequest = checkLatestVersion().then((result) => result.release);
  }
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

export function refreshLatestVersion(): void {
  if (
    latestReleaseRequest &&
    Date.now() - latestReleaseRequestedAt < LATEST_VERSION_REFRESH_COOLDOWN_MS
  ) {
    return;
  }
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
