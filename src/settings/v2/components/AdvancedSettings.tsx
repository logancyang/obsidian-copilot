import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { logFileManager } from "@/logFileManager";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Settings } from "lucide-react";
import React from "react";
import { SystemPromptManagerModal } from "@/system-prompts";
import { useSystemPrompts } from "@/system-prompts/state";

export const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();
  const prompts = useSystemPrompts();

  // Check if the default system prompt exists in the current prompts list
  const defaultPromptExists = prompts.some(
    (prompt) => prompt.title === settings.defaultSystemPromptTitle
  );

  // Display value: use the default prompt if it exists, otherwise empty string (will show placeholder)
  const displayValue = defaultPromptExists ? settings.defaultSystemPromptTitle : "";

  const handleSelectChange = (value: string) => {
    if (!value) return; // Prevent setting empty value
    updateSetting("defaultSystemPromptTitle", value);
  };

  const handleOpenModal = () => {
    const modal = new SystemPromptManagerModal(app);
    modal.open();
  };

  return (
    <div className="tw-space-y-4">
      {/* User System Prompt Section */}
      <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
        <h3 className="tw-text-lg tw-font-semibold">User System Prompt</h3>

        <SettingItem
          type="custom"
          title="Default System Prompt"
          description="Customize the system prompt for all messages, may result in unexpected behavior!"
        >
          <div className="tw-flex tw-items-center tw-gap-3">
            <ObsidianNativeSelect
              value={displayValue}
              onChange={(e) => handleSelectChange(e.target.value)}
              options={prompts.map((prompt) => ({
                label: prompt.title,
                value: prompt.title,
              }))}
              placeholder="Select system prompt"
              containerClassName="tw-flex-1"
            />

            <Button variant="default" size="icon" onClick={handleOpenModal} title="Manage prompts">
              <Settings className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>

        <SettingItem
          type="text"
          title="System Prompts Folder Name"
          description="Folder where system prompts are stored."
          value={settings.userSystemPromptsFolder}
          onChange={(value) => updateSetting("userSystemPromptsFolder", value)}
          placeholder="copilot/system-prompts"
        />
      </section>

      {/* Others Section */}
      <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
        <h3 className="tw-text-lg tw-font-semibold">Others</h3>

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

        <SettingItem
          type="custom"
          title="Create Log File"
          description={`Open the Copilot log file (${logFileManager.getLogPath()}) for easy sharing when reporting issues.`}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await flushRecordedPromptPayloadToLog();
              await logFileManager.flush();
              await logFileManager.openLogFile();
            }}
          >
            Create Log File
          </Button>
        </SettingItem>
      </section>
    </div>
  );
};
