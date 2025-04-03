import { checkLatestVersion, isNewerVersion } from "@/utils";
import { useEffect, useState } from "react";

interface UseLatestVersionResult {
  latestVersion: string | null;
  hasUpdate: boolean;
}

export function useLatestVersion(currentVersion: string): UseLatestVersionResult {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    const checkVersion = async () => {
      const result = await checkLatestVersion();
      if (result.version) {
        setLatestVersion(result.version);
      }
    };
    checkVersion();
  }, []);

  const hasUpdate = latestVersion !== null && isNewerVersion(latestVersion, currentVersion);

  return {
    latestVersion,
    hasUpdate,
  };
}
