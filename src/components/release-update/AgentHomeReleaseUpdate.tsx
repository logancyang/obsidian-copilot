import { AgentHomeReleaseUpdatePrompt } from "@/components/release-update/AgentHomeReleaseUpdatePrompt";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { findReleaseVideo } from "@/components/release-update/releaseNotes";
import { useApp } from "@/context";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { updateSetting, useSettingsValue } from "@/settings/model";
import * as React from "react";

interface AgentHomeReleaseUpdateProps {
  currentVersion: string;
  visible: boolean;
}

export function AgentHomeReleaseUpdate({
  currentVersion,
  visible,
}: AgentHomeReleaseUpdateProps): React.ReactElement | null {
  const app = useApp();
  const { latestRelease, hasUpdate } = useLatestVersion(currentVersion);
  const lastDismissedVersion = useSettingsValue().lastDismissedVersion;

  if (!visible || !hasUpdate || !latestRelease || lastDismissedVersion === latestRelease.version) {
    return null;
  }

  return (
    <AgentHomeReleaseUpdatePrompt
      onDismiss={() => updateSetting("lastDismissedVersion", latestRelease.version)}
      onOpen={() => new ReleaseNotesModal(app, latestRelease, currentVersion).open()}
      version={latestRelease.version}
      video={findReleaseVideo(latestRelease.body)}
    />
  );
}
