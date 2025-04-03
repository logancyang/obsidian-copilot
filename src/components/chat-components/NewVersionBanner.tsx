import { Button } from "@/components/ui/button";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { cn } from "@/lib/utils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { isNewerVersion } from "@/utils";
import { XIcon } from "lucide-react";
import React, { useState } from "react";

interface NewVersionBannerProps {
  currentVersion: string;
}

export function NewVersionBanner({ currentVersion }: NewVersionBannerProps) {
  const { latestVersion, hasUpdate } = useLatestVersion(currentVersion);
  const lastDismissedVersion = useSettingsValue().lastDismissedVersion;
  const [isVisible, setIsVisible] = useState(true);

  const showBanner =
    hasUpdate &&
    latestVersion &&
    isNewerVersion(latestVersion, currentVersion) &&
    lastDismissedVersion !== latestVersion;

  const handleDismiss = () => {
    if (latestVersion) {
      setIsVisible(false);
      // Wait for animation to complete before updating setting
      setTimeout(() => {
        updateSetting("lastDismissedVersion", latestVersion);
      }, 300);
    }
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div
      className={cn(
        "min-h-14 overflow-hidden",
        isVisible
          ? "animate-in slide-in-from-top duration-300"
          : "animate-out slide-out-to-top duration-300"
      )}
    >
      <div className="flex items-center justify-between gap-2 p-2 pl-3 mb-1 text-xs border border-border border-solid rounded-md">
        <div className="flex items-center gap-2">
          <span className="font-medium">Update available:</span>(
          <a
            href={`https://github.com/logancyang/obsidian-copilot/releases/latest`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-normal"
          >
            v{latestVersion}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="fit"
            variant="ghost2"
            className="text-accent hover:text-accent-hover"
            onClick={() => {
              window.open(`obsidian://show-plugin?id=copilot`, "_blank");
              handleDismiss();
            }}
          >
            Update
          </Button>
          <Button variant="ghost2" size="icon" onClick={handleDismiss}>
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
