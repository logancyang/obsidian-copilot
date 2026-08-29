import { logError } from "@/logger";
import { checkLatestVersion, isNewerVersion } from "@/utils";
import type { LatestRelease } from "@/utils/latestRelease";
import { useEffect, useState } from "react";

interface UseLatestVersionResult {
  latestVersion: string | null;
  latestRelease: LatestRelease | null;
  hasUpdate: boolean;
}

export function useLatestVersion(currentVersion: string): UseLatestVersionResult {
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null);

  useEffect(() => {
    const checkVersion = async () => {
      const result = await checkLatestVersion();
      if (result.release) {
        setLatestRelease(result.release);
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
