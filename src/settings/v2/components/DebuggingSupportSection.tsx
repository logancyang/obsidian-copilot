import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { SettingSwitch } from "@/components/ui/setting-switch";
import React from "react";

export interface DebuggingSupportSectionProps {
  debug: boolean;
  onDebugChange: (checked: boolean) => void;
  frameLogEnabled: boolean;
  onFrameLogChange: (checked: boolean) => void;
  frameLogPath: string;
  onReportIssue: () => void;
  onOpenFrameLog: React.MouseEventHandler<HTMLButtonElement>;
  onClearFrameLog: React.MouseEventHandler<HTMLButtonElement>;
}

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
