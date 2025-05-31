import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { PromptSortStrategy } from "@/types";
import React from "react";

export const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <div className="tw-space-y-4">
      {/* Privacy Settings Section */}
      <section>
        <SettingItem
          type="textarea"
          title="User System Prompt"
          description="Customize the system prompt for all messages, may result in unexpected behavior!"
          value={settings.userSystemPrompt}
          onChange={(value) => updateSetting("userSystemPrompt", value)}
          placeholder="Enter your system prompt here..."
        />

        <div className="tw-space-y-4">
          <SettingItem
            type="switch"
            title="Custom Prompt Templating"
            description="Enable templating to process variables like {activenote}, {foldername} or {#tag} in prompts. Disable to use raw prompts without any processing."
            checked={settings.enableCustomPromptTemplating}
            onCheckedChange={(checked) => {
              updateSetting("enableCustomPromptTemplating", checked);
            }}
          />

          <SettingItem
            type="select"
            title="Custom Prompts Sort Strategy"
            description="Choose how to sort custom prompts (by recent usage or alphabetically)"
            value={settings.promptSortStrategy}
            onChange={(value) => updateSetting("promptSortStrategy", value)}
            options={[
              { label: "Recency", value: PromptSortStrategy.TIMESTAMP },
              { label: "Alphabetical", value: PromptSortStrategy.ALPHABETICAL },
            ]}
          />

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
            description="Debug mode will log some debug message to the console."
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
