import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import React from "react";

export interface DebuggingSupportSectionProps {
  /** Whether full Agent Mode frames are written to disk. */
  frameLogEnabled: boolean;
  onFrameLogChange: (checked: boolean) => void;
  /**
   * Where the frame log lives, shown so the user can find it without this
   * component knowing whether the platform has a filesystem at all.
   */
  frameLogPath: string;
  onReportIssue: React.MouseEventHandler<HTMLButtonElement>;
  onOpenFrameLog: React.MouseEventHandler<HTMLButtonElement>;
  onClearFrameLog: React.MouseEventHandler<HTMLButtonElement>;
}

/**
 * The Advanced tab's "Agent Mode debugging" section: the report entry point and
 * the activity log a report can carry.
 *
 * Presentational on purpose — it takes the switch value and the four actions
 * rather than reading settings or touching the sink itself, so the section's
 * states can be rendered in the gallery without standing up a settings context
 * or a desktop runtime.
 */
export const DebuggingSupportSection: React.FC<DebuggingSupportSectionProps> = ({
  frameLogEnabled,
  onFrameLogChange,
  frameLogPath,
  onReportIssue,
  onOpenFrameLog,
  onClearFrameLog,
}) => (
  <SettingSection
    label="Agent Mode debugging"
    description="Tools for diagnosing Agent Mode problems, separate from the regular Copilot chat logs above."
  >
    <SettingItem
      type="custom"
      title="Report an Issue"
      description="Bundles a screenshot of the Agent Mode chat pane and a recent activity log into a folder, then opens a prefilled GitHub issue for you to attach them to."
    >
      <Button variant="secondary" size="sm" onClick={onReportIssue}>
        Report an Issue
      </Button>
    </SettingItem>

    <SettingItem
      type="switch"
      title="Keep an Agent Mode activity log"
      description="Records the behind-the-scenes messages between Copilot and the agent so the Report an Issue button always has recent activity to attach. Stored on this device only, outside your vault, and can include your prompts and note contents in plain text. On by default; turn off to stop logging."
      checked={frameLogEnabled}
      onCheckedChange={onFrameLogChange}
    />

    <SettingItem
      type="custom"
      title="Agent Mode activity log file"
      description={`Open or clear the log file on disk (${frameLogPath}).`}
    >
      <div className="tw-flex tw-gap-2">
        <Button variant="secondary" size="sm" onClick={onOpenFrameLog}>
          Open
        </Button>
        <Button variant="secondary" size="sm" onClick={onClearFrameLog}>
          Clear
        </Button>
      </div>
    </SettingItem>
  </SettingSection>
);
