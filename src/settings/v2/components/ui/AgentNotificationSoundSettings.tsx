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
      title="Notification"
      description="Plays a short sound when an agent finishes a turn."
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
        description="Choose which sound to play."
        value={soundId}
        onChange={onSoundChange}
        options={[...soundOptions]}
      />
    )}
  </>
);
