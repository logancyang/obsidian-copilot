import { DEFAULT_SYSTEM_PROMPT } from "@/constants";
import React from "react";
import { TextAreaComponent } from "./SettingBlocks";
import { updateSetting, useSettingsValue } from "@/settings/model";

const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();
  return (
    <div>
      <h1>Advanced Settings</h1>
      <TextAreaComponent
        name="User System Prompt"
        description="Warning: It will override the default system prompt for all messages!"
        value={settings.userSystemPrompt}
        onChange={(value) => updateSetting("userSystemPrompt", value)}
        placeholder={settings.userSystemPrompt || "Default: " + DEFAULT_SYSTEM_PROMPT}
        rows={10}
      />
    </div>
  );
};

export default AdvancedSettings;
