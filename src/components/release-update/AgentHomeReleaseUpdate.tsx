import { AgentHomeReleaseUpdatePrompt } from "@/components/release-update/AgentHomeReleaseUpdatePrompt";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import { useApp } from "@/context";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { updateSetting, useSettingsValue } from "@/settings/model";
import * as React from "react";

interface AgentHomeReleaseUpdateProps {
  currentVersion: string;
  visible: boolean;
}

/** Connects release detection and dismissal state to the Agent Home update prompt. */
export function AgentHomeReleaseUpdate({
  currentVersion,
  visible,
}: AgentHomeReleaseUpdateProps): React.ReactElement | null {
  const app = useApp();
  const { latestRelease, hasUpdate } = useLatestVersion(currentVersion);
  const lastDismissedVersion = useSettingsValue().lastDismissedVersion;

  // Release notifications belong only on the global empty home. A dismissal
  // suppresses that release without hiding a future version.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  if (!visible || !hasUpdate || !latestRelease || lastDismissedVersion === latestRelease.version) {
    return null;
  }

  return (
    <AgentHomeReleaseUpdatePrompt
      onDismiss={() => updateSetting("lastDismissedVersion", latestRelease.version)}
      onOpen={() => new ReleaseNotesModal(app, latestRelease).open()}
      version={latestRelease.version}
    />
  );
}
