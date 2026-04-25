import { useActiveBackendDescriptor } from "@/agentMode";
import { SettingItem } from "@/components/ui/setting-item";
import { usePlugin } from "@/contexts/PluginContext";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Platform } from "obsidian";
import React from "react";

export const AgentModeSettings: React.FC = () => {
  const settings = useSettingsValue();
  const plugin = usePlugin();
  const descriptor = useActiveBackendDescriptor();

  if (Platform.isMobile) return null;

  const Panel = descriptor.SettingsPanel;

  return (
    <section>
      <div className="tw-mb-3 tw-text-xl tw-font-bold">Agent Mode (alpha)</div>
      <div className="tw-space-y-4">
        <SettingItem
          type="switch"
          title="Enable Agent Mode"
          description={`BYOK agent harness backed by a local ${descriptor.displayName} subprocess. Desktop only.`}
          checked={settings.agentMode.enabled}
          onCheckedChange={(checked) =>
            updateSetting("agentMode", { ...settings.agentMode, enabled: checked })
          }
        />

        {settings.agentMode.enabled && Panel && <Panel plugin={plugin} app={plugin.app} />}
      </div>
    </section>
  );
};
