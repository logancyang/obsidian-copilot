import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { SettingSwitch } from "@/components/ui/setting-switch";
import React from "react";

export interface DebuggingSupportSectionProps {
  /** Whether console logging of chat activity is on. */
  debug: boolean;
  onDebugChange: (checked: boolean) => void;
  /** Whether full Agent Mode frames are written to disk. */
  frameLogEnabled: boolean;
  onFrameLogChange: (checked: boolean) => void;
  /**
   * Where the frame log lives, shown so the user can find it without this
   * component knowing whether the platform has a filesystem at all.
   */
  frameLogPath: string;
  onReportIssue: () => void;
  onOpenFrameLog: React.MouseEventHandler<HTMLButtonElement>;
  onClearFrameLog: React.MouseEventHandler<HTMLButtonElement>;
}

/**
 * The Advanced tab's "Debugging & support" section: the report entry point and
 * the two logs a report can carry.
 *
 * Presentational on purpose — it takes the two switch values and the four
 * actions rather than reading settings itself, so the section's states can be
 * rendered in the gallery without standing up a settings context.
 */
export const DebuggingSupportSection: React.FC<DebuggingSupportSectionProps> = ({
  debug,
  onDebugChange,
  frameLogEnabled,
  onFrameLogChange,
  frameLogPath,
  onReportIssue,
  onOpenFrameLog,
  onClearFrameLog,
}) => (
  // The former "Create Log File" row is gone on purpose, not by omission.
  // "Report an issue" collects the same chat log as one of its attachments
  // (pre-selected when Debug Mode is on), and the command-palette
  // "Copilot: Create log file" remains for anyone who wants the note in their
  // vault by hand — README, the FAQ and the issue template all point there. A
  // second settings entry for the same log would be one more path to keep
  // consistent for no new capability.
  <SettingSection label="Debugging & support">
    <SettingItem
      type="custom"
      title="Report an issue"
      description="Walks you through collecting a screenshot and recent logs, packs them into a single zip you can review, uploads it privately, and opens a prefilled GitHub issue with the report ID already in it."
    >
      <Button variant="default" size="sm" onClick={onReportIssue}>
        Report an issue
      </Button>
    </SettingItem>

    <SettingItem
      type="switch"
      title="Debug Mode"
      description="Logs Copilot chat activity to the developer console (View → Toggle Developer Tools), and pre-selects the chat log when you report an issue."
      checked={debug}
      onCheckedChange={onDebugChange}
    />

    <SettingItem
      type="custom"
      title="Agent Mode activity log"
      description={`Records the behind-the-scenes messages between Copilot and the agent so a report always has recent activity to attach. Stored on this device only, outside your vault (${frameLogPath}), and can include your prompts and note contents in plain text.`}
    >
      <div className="tw-flex tw-items-center tw-gap-2">
        <SettingSwitch checked={frameLogEnabled} onCheckedChange={onFrameLogChange} />
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
