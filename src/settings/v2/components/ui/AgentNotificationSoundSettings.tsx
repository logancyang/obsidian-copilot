import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

interface NotificationSoundOption {
  label: string;
  value: string;
}

export interface AgentNotificationSoundSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onSoundChange: (soundId: string) => void;
  soundId: string;
  soundOptions: ReadonlyArray<NotificationSoundOption>;
}

/**
 * Presents the agent notification toggle and its conditional sound picker
 * without reading or writing plugin state.
 */
export const AgentNotificationSoundSettings: React.FC<AgentNotificationSoundSettingsProps> = ({
  enabled,
  onEnabledChange,
  onSoundChange,
  soundId,
  soundOptions,
}) => (
  <>
    <SettingItem
      type="switch"
      title="Notification sound"
      description="Plays a short sound when an agent finishes a turn, stops on an error, or needs your approval, so you can look away while it works. Stays quiet while you are watching that chat."
      checked={enabled}
      onCheckedChange={onEnabledChange}
    />
    {/* Picking a sound while muted cannot produce audible feedback, so the
        choice only appears when notifications are enabled.
        https://github.com/logancyang/obsidian-copilot/issues/2987 */}
    {enabled && (
      <SettingItem
        type="select"
        title="Sound"
        description="Each one plays as you select it."
        value={soundId}
        onChange={onSoundChange}
        options={[...soundOptions]}
      />
    )}
  </>
);
