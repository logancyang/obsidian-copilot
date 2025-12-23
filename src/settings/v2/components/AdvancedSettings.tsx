import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { logFileManager } from "@/logFileManager";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { isSortStrategy } from "@/utils/recentUsageManager";
import React from "react";

export const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <div className="tw-space-y-4">
      {/* Sorting Settings Section */}
      <section>
        <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">Sorting</div>
          <div className="tw-text-sm tw-text-muted">
            Configure default sort order for various lists.
          </div>
        </div>

        <SettingItem
          type="select"
          title="Chat History Sort Strategy"
          description="Sort order for the chat history list"
          value={settings.chatHistorySortStrategy}
          onChange={(value) => {
            if (isSortStrategy(value)) {
              updateSetting("chatHistorySortStrategy", value);
            }
          }}
          options={[
            { label: "Recency", value: "recent" },
            { label: "Created", value: "created" },
            { label: "Alphabetical", value: "name" },
          ]}
        />

        <SettingItem
          type="select"
          title="Project List Sort Strategy"
          description="Sort order for the project list"
          value={settings.projectListSortStrategy}
          onChange={(value) => {
            if (isSortStrategy(value)) {
              updateSetting("projectListSortStrategy", value);
            }
          }}
          options={[
            { label: "Recency", value: "recent" },
            { label: "Created", value: "created" },
            { label: "Alphabetical", value: "name" },
          ]}
        />
      </section>

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
        </div>
      </section>
    </div>
  );
};
