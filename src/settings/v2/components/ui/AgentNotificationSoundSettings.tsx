import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/i18n";
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
      title={t("settings.agents.notification.title")}
      description={t("settings.agents.notification.description")}
      checked={enabled}
      onCheckedChange={onEnabledChange}
    />
    {/* Picking a sound while muted cannot produce audible feedback, so the
        choice only appears when notifications are enabled.
        https://github.com/logancyang/obsidian-copilot/issues/2987 */}
    {enabled && (
      <SettingItem
        type="select"
        title={t("settings.agents.sound.title")}
        description={t("settings.agents.sound.description")}
        value={soundId}
        onChange={onSoundChange}
        options={[...soundOptions]}
      />
    )}
  </>
);
