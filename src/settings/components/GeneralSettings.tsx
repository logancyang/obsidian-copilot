import { ChatModelDisplayNames } from "@/constants";
import React from "react";
import { useSettingsContext } from "../contexts/SettingsContext";
import CommandToggleSettings from "./CommandToggleSettings";
import { DropdownComponent, SliderComponent, TextComponent } from "./SettingBlocks";

const GeneralSettings: React.FC = () => {
  const { settings, updateSettings } = useSettingsContext();

  return (
    <div>
      <h2>General Settings</h2>
      <DropdownComponent
        name="Default Model"
        options={Object.values(ChatModelDisplayNames)}
        value={settings.defaultModelDisplayName}
        onChange={(value) => updateSettings({ defaultModelDisplayName: value })}
      />
      <TextComponent
        name="Default Conversation Folder Name"
        description="The default folder name where chat conversations will be saved. Default is 'copilot-conversations'"
        placeholder="copilot-conversations"
        value={settings.defaultSaveFolder}
        onChange={(value) => updateSettings({ defaultSaveFolder: value })}
      />
      <TextComponent
        name="Exclude Folders from Indexing"
        description="Comma separated list like folder1, folder1/folder2, etc, to be excluded from indexing process. NOTE: files which were previously indexed will remain in the index."
        placeholder="folder1, folder1/folder2"
        value={settings.excludedFolders.join(", ")}
        onChange={(value) => updateSettings({ excludedFolders: value.split(", ") })}
      />
      <h6>
        Please be mindful of the number of tokens and context conversation turns you set here, as
        they will affect the cost of your API requests.
      </h6>
      <SliderComponent
        name="Temperature"
        description="Default is 0.1. Higher values will result in more creativeness, but also more mistakes. Set to 0 for no randomness."
        min={0}
        max={2}
        step={0.05}
        value={settings.temperature}
        onChange={(value) => updateSettings({ temperature: value })}
      />
      <SliderComponent
        name="Token limit"
        description={
          <>
            <p>
              The maximum number of <em>output tokens</em> to generate. Default is 1000.
            </p>
            <em>
              This number plus the length of your prompt (input tokens) must be smaller than the
              context window of the model.
            </em>
          </>
        }
        min={0}
        max={16000}
        step={100}
        value={settings.maxTokens}
        onChange={(value) => updateSettings({ maxTokens: value })}
      />
      <SliderComponent
        name="Conversation turns in context"
        description="The number of previous conversation turns to include in the context. Default is 15 turns, i.e. 30 messages."
        min={1}
        max={50}
        step={1}
        value={settings.contextTurns}
        onChange={(value) => updateSettings({ contextTurns: value })}
      />
      <CommandToggleSettings
        enabledCommands={settings.enabledCommands}
        setEnabledCommands={(value) => updateSettings({ enabledCommands: value })}
      />
    </div>
  );
};

export default GeneralSettings;
