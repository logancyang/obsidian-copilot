import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsPreviewAvailable } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import * as React from "react";

export type ReleaseChannel = "official" | "preview";

export interface PreviewChannelSwitchProps {
  currentVersion: string;
  hasUpdate: boolean;
  previewEnabled: boolean;
  onSelect: (channel: ReleaseChannel) => void;
}

interface PreviewSwitchProps {
  currentVersion: string;
  hasUpdate: boolean;
}

function selectChannel(channel: ReleaseChannel): void {
  const previewEnabled = channel === "preview";
  updateSetting("previewEnabled", previewEnabled);
  new Notice(previewEnabled ? "Copilot Preview is on." : "Copilot is back on Official.");
}

export function PreviewChannelSwitch({
  currentVersion,
  hasUpdate,
  previewEnabled,
  onSelect,
}: PreviewChannelSwitchProps): React.ReactElement {
  return (
    <div className="tw-flex tw-flex-col tw-gap-1 tw-text-ui-smaller tw-font-normal">
      <SegmentedControl<ReleaseChannel>
        aria-label="Copilot release channel"
        className="tw-self-start"
        onChange={onSelect}
        options={[
          { label: "Official", value: "official" },
          { label: `Preview · ${currentVersion}`, value: "preview" },
        ]}
        value={previewEnabled ? "preview" : "official"}
      />
      <span className="tw-text-muted">
        Preview turns on features still in testing, for Believers and Supporters.{" "}
        <a
          href={`https://github.com/logancyang/obsidian-copilot/releases/tag/${currentVersion}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          See what is in this preview
        </a>
      </span>
      {hasUpdate && (
        <a
          className="tw-text-accent"
          href="obsidian://show-plugin?id=copilot"
          rel="noopener noreferrer"
          target="_blank"
        >
          Update to get the latest preview
        </a>
      )}
    </div>
  );
}

export function PreviewSwitch({
  currentVersion,
  hasUpdate,
}: PreviewSwitchProps): React.ReactElement | null {
  const previewAvailable = useIsPreviewAvailable();
  const { previewEnabled } = useSettingsValue();
  if (!previewAvailable) return null;

  return (
    <PreviewChannelSwitch
      currentVersion={currentVersion}
      hasUpdate={hasUpdate}
      onSelect={selectChannel}
      previewEnabled={previewEnabled}
    />
  );
}
