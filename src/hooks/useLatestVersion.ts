import { logError } from "@/logger";
import { checkLatestVersion, isNewerVersion, type LatestRelease } from "@/utils";
import { useEffect, useState } from "react";

interface UseLatestVersionResult {
  latestVersion: string | null;
  latestRelease: LatestRelease | null;
  hasUpdate: boolean;
}

let latestReleaseRequest: Promise<LatestRelease | null> | null = null;

function requestLatestRelease(): Promise<LatestRelease | null> {
  // Every mounted release surface shares the same request for the lifetime of
  // the loaded plugin bundle, including settings opened after Agent Home.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  latestReleaseRequest ??= checkLatestVersion().then((result) => result.release);
  return latestReleaseRequest;
}

export function useLatestVersion(currentVersion: string): UseLatestVersionResult {
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null);

  useEffect(() => {
    const checkVersion = async () => {
      const release = await requestLatestRelease();
      if (release) {
        setLatestRelease(release);
      }
    };
    void checkVersion().catch((err) => logError("checkVersion failed", err));
  }, []);

  const latestVersion = latestRelease?.version ?? null;
  const hasUpdate = latestVersion !== null && isNewerVersion(latestVersion, currentVersion);

  return {
    latestVersion,
    latestRelease,
    hasUpdate,
  };
}
