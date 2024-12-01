import { updateSetting, useSettingsValue } from "@/settings/model";
import React from "react";
import { TextAreaComponent } from "./SettingBlocks";

const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();
  return (
    <div>
      <h1>Advanced Settings</h1>
      <TextAreaComponent
        name="User System Prompt"
        description="Customize the system prompt for all messages, may result in unexpected behavior!"
        value={settings.userSystemPrompt}
        onChange={(value) => updateSetting("userSystemPrompt", value)}
        placeholder={""}
        rows={10}
      />
    </div>
  );
};

export default AdvancedSettings;
