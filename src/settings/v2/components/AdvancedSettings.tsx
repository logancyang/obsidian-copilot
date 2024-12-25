import React from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting, useSettingsValue } from "@/settings/model";

const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <div className="space-y-4">
      {/* Privacy Settings Section */}
      <section>
        <h3 className="text-2xl font-bold mb-4">Privacy/Additional Settings</h3>
        <div className="space-y-4">
          <SettingItem
            type="switch"
            title="Enable Encryption"
            description="Enable encryption for the API keys."
            checked={settings.enableEncryption}
            onCheckedChange={(checked) => {
              updateSetting("enableEncryption", checked);
            }}
          />

          <SettingItem
            type="switch"
            title="Debug Mode"
            description="Debug mode will log all API requests and prompts to the console."
            checked={settings.debug}
            onCheckedChange={(checked) => {
              updateSetting("debug", checked);
            }}
          />
        </div>
      </section>
    </div>
  );
};

export default AdvancedSettings;
