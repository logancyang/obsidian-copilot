import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Platform } from "obsidian";
import React from "react";

export const AgentModeSettings: React.FC = () => {
  const settings = useSettingsValue();

  if (Platform.isMobile) return null;

  return (
    <section>
      <div className="tw-mb-3 tw-text-xl tw-font-bold">Agent Mode (alpha)</div>
      <div className="tw-space-y-4">
        <SettingItem
          type="switch"
          title="Enable Agent Mode"
          description="BYOK agent harness backed by a local opencode subprocess. Setup flow ships in the next release."
          checked={settings.agentMode.enabled}
          onCheckedChange={(checked) =>
            updateSetting("agentMode", { ...settings.agentMode, enabled: checked })
          }
        />
      </div>
    </section>
  );
};
