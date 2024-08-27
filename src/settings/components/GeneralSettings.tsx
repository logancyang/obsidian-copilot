import { CustomModel, LangChainParams } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import EncryptionService from "@/encryptionService";
import React from "react";
import { useSettingsContext } from "../contexts/SettingsContext";
import CommandToggleSettings from "./CommandToggleSettings";
import { ModelSettingsComponent, SliderComponent, TextComponent } from "./SettingBlocks";

interface GeneralSettingsProps {
  getLangChainParams: () => LangChainParams;
  encryptionService: EncryptionService;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  getLangChainParams,
  encryptionService,
}) => {
  const { settings, updateSettings } = useSettingsContext();

  const handleUpdateModels = (models: Array<CustomModel>) => {
    const updatedActiveModels = models.map((model) => ({
      ...model,
      baseUrl: model.baseUrl || "",
      apiKey: model.apiKey || "",
    }));
    updateSettings({ activeModels: updatedActiveModels });
  };

  const handleSetDefaultModel = (modelName: string) => {
    updateSettings({ defaultModel: modelName });
  };

  return (
    <div>
      <h2>General Settings</h2>
      <ModelSettingsComponent
        activeModels={settings.activeModels}
        onUpdateModels={handleUpdateModels}
        providers={Object.values(ChatModelProviders)}
        onDeleteModel={(modelName) => {
          const updatedActiveModels = settings.activeModels.filter(
            (model) => model.name !== modelName
          );
          updateSettings({ activeModels: updatedActiveModels });
        }}
        defaultModel={settings.defaultModel}
        onSetDefaultModel={handleSetDefaultModel}
      />
      <TextComponent
        name="Default Conversation Folder Name"
        description="The default folder name where chat conversations will be saved. Default is 'copilot-conversations'"
        placeholder="copilot-conversations"
        value={settings.defaultSaveFolder}
        onChange={(value) => updateSettings({ defaultSaveFolder: value })}
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
