import { listBackendDescriptors } from "@/agentMode";
import { SettingItem } from "@/components/ui/setting-item";
import { usePlugin } from "@/contexts/PluginContext";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Platform } from "obsidian";
import React from "react";

/**
 * Settings tab section for Agent Mode. Stacks every registered backend's
 * `SettingsPanel` so users can configure all of them at once — independent
 * of which one is currently the default. The "default backend" picker
 * tracks `settings.agentMode.activeBackend`, which determines which backend
 * the `+` button and auto-spawn-on-mount land on (the model picker also
 * keeps this field in sync as the user picks models).
 */
export const AgentModeSettings: React.FC = () => {
  const settings = useSettingsValue();
  const plugin = usePlugin();
  const descriptors = React.useMemo(() => listBackendDescriptors(), []);

  if (Platform.isMobile) return null;

  return (
    <section>
      <div className="tw-mb-3 tw-text-xl tw-font-bold">Agent Mode (alpha)</div>
      <div className="tw-space-y-4">
        <SettingItem
          type="switch"
          title="Enable Agent Mode"
          description="BYOK agent harness backed by a local ACP subprocess. Desktop only."
          checked={settings.agentMode.enabled}
          onCheckedChange={(checked) =>
            updateSetting("agentMode", { ...settings.agentMode, enabled: checked })
          }
        />

        {settings.agentMode.enabled && (
          <SettingItem
            type="select"
            title="Default backend"
            description="Used when you click `+` to start a new session and for auto-spawn on mount. Selecting a model from the model picker also updates this."
            value={settings.agentMode.activeBackend}
            onChange={(value) =>
              updateSetting("agentMode", { ...settings.agentMode, activeBackend: value })
            }
            options={descriptors.map((d) => ({ label: d.displayName, value: d.id }))}
          />
        )}

        {settings.agentMode.enabled &&
          descriptors.map((descriptor) => {
            const Panel = descriptor.SettingsPanel;
            if (!Panel) return null;
            return (
              <div key={descriptor.id} className="tw-space-y-2">
                <div className="tw-text-base tw-font-semibold">{descriptor.displayName}</div>
                <Panel plugin={plugin} app={plugin.app} />
              </div>
            );
          })}
      </div>
    </section>
  );
};
