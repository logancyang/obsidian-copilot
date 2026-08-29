import { Button } from "@/components/ui/button";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { useApp } from "@/context";
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
  const app = useApp();
  const { latestVersion, latestRelease, hasUpdate } = useLatestVersion(currentVersion);
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
      window.setTimeout(() => {
        updateSetting("lastDismissedVersion", latestVersion);
      }, 300);
    }
  };

  // A version without its matching release record cannot open the shared dialog,
  // so wait for the complete response instead of showing a dead link.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  if (!showBanner || !latestRelease) {
    return null;
  }

  const handleOpenReleaseNotes = () => {
    // Version detection and dialog content share one GitHub response, so opening
    // the notes never adds another content request.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
    new ReleaseNotesModal(app, latestRelease).open();
  };

  return (
    <div
      className={cn(
        "tw-min-h-14 tw-overflow-hidden",
        isVisible
          ? "tw-duration-300 tw-animate-in tw-slide-in-from-top"
          : "tw-duration-300 tw-animate-out tw-slide-out-to-top"
      )}
    >
      <div className="tw-mb-1 tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2 tw-pl-3 tw-text-xs">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-font-medium">Update available:</span>
          <Button
            aria-label={`View release notes for v${latestVersion}`}
            className="tw-text-normal"
            onClick={handleOpenReleaseNotes}
            size="fit"
            variant="link"
          >
            v{latestVersion}
          </Button>
        </div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <Button
            size="fit"
            variant="ghost2"
            className="tw-text-accent hover:tw-text-accent-hover"
            onClick={() => {
              window.open(`obsidian://show-plugin?id=copilot`, "_blank");
              handleDismiss();
            }}
          >
            Update
          </Button>
          <Button variant="ghost2" size="icon" onClick={handleDismiss}>
            <XIcon className="tw-size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
