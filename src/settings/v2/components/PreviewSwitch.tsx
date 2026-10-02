import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsPreviewAvailable } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { isNewerVersion } from "@/utils";
import { Notice } from "obsidian";
import * as React from "react";

export type ReleaseChannel = "official" | "preview";

export interface PreviewChannelSwitchProps {
  previewVersion: string | null;
  previewEnabled: boolean;
  onSelect: (channel: ReleaseChannel) => void;
}

interface PreviewSwitchProps {
  currentVersion: string;
  latestVersion: string | null;
}

function selectChannel(channel: ReleaseChannel): void {
  const previewEnabled = channel === "preview";
  updateSetting("previewEnabled", previewEnabled);
  new Notice(previewEnabled ? "Copilot Preview is on." : "Copilot is back on Official.");
}

export function PreviewChannelSwitch({
  previewVersion,
  previewEnabled,
  onSelect,
}: PreviewChannelSwitchProps): React.ReactElement {
  return (
    <SegmentedControl<ReleaseChannel>
      aria-label="Copilot release channel"
      className="tw-shrink-0 tw-whitespace-nowrap tw-font-normal"
      onChange={onSelect}
      options={[
        { label: "Official", value: "official" },
        { label: previewVersion ? `Preview · v${previewVersion}` : "Preview", value: "preview" },
      ]}
      value={previewEnabled ? "preview" : "official"}
    />
  );
}

export function PreviewSwitch({
  currentVersion,
  latestVersion,
}: PreviewSwitchProps): React.ReactElement | null {
  const previewAvailable = useIsPreviewAvailable();
  const { previewEnabled } = useSettingsValue();
  if (!previewAvailable) return null;

  // The header already shows the installed version, so Preview names a version only when it is ahead of the latest official.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/626
  const isAheadOfOfficial = latestVersion !== null && isNewerVersion(currentVersion, latestVersion);
  return (
    <PreviewChannelSwitch
      onSelect={selectChannel}
      previewEnabled={previewEnabled}
      previewVersion={isAheadOfOfficial ? currentVersion : null}
    />
  );
}
