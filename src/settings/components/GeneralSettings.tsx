import { CustomModel, LangChainParams } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import EncryptionService from "@/encryptionService";
import React from "react";
import { useSettingsContext } from "../contexts/SettingsContext";
import CommandToggleSettings from "./CommandToggleSettings";
import {
  ModelSettingsComponent,
  SliderComponent,
  TextComponent,
  ToggleComponent,
} from "./SettingBlocks";

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

  // modelKey is name | provider, e.g. "gpt-4o|openai"
  const onSetDefaultModelKey = (modelKey: string) => {
    updateSettings({ defaultModelKey: modelKey });
  };

  const onDeleteModel = (modelKey: string) => {
    const [modelName, provider] = modelKey.split("|");
    const updatedActiveModels = settings.activeModels.filter(
      (model) => !(model.name === modelName && model.provider === provider)
    );

    // Check if the deleted model was the default model
    let newDefaultModelKey = settings.defaultModelKey;
    if (modelKey === settings.defaultModelKey) {
      const newDefaultModel = updatedActiveModels.find((model) => model.enabled);
      if (newDefaultModel) {
        newDefaultModelKey = `${newDefaultModel.name}|${newDefaultModel.provider}`;
      } else {
        newDefaultModelKey = "";
      }
    }

    // Update both activeModels and defaultModelKey in a single operation
    updateSettings({
      activeModels: updatedActiveModels,
      defaultModelKey: newDefaultModelKey,
    });
  };

  return (
    <div>
      <h2>General Settings</h2>
      <ModelSettingsComponent
        activeModels={settings.activeModels}
        onUpdateModels={handleUpdateModels}
        providers={Object.values(ChatModelProviders)}
        onDeleteModel={onDeleteModel}
        defaultModelKey={settings.defaultModelKey}
        onSetDefaultModelKey={onSetDefaultModelKey}
        isEmbeddingModel={false}
      />
      <TextComponent
        name="Default Conversation Folder Name"
        description="The default folder name where chat conversations will be saved. Default is 'copilot-conversations'"
        placeholder="copilot-conversations"
        value={settings.defaultSaveFolder}
        onChange={(value) => updateSettings({ defaultSaveFolder: value })}
      />
      <TextComponent
        name="Default Conversation Tag"
        description="The default tag to be used when saving a conversation. Default is 'ai-conversations'"
        placeholder="ai-conversation"
        value={settings.defaultConversationTag}
        onChange={(value) => updateSettings({ defaultConversationTag: value })}
      />
      <ToggleComponent
        name="Autosave Chat"
        description="Automatically save the chat when starting a new one or when the plugin reloads"
        value={settings.autosaveChat}
        onChange={(value) => updateSettings({ autosaveChat: value })}
      />
      <TextComponent
        name="Custom Prompts Folder Name"
        description="The default folder name where custom prompts will be saved. Default is 'copilot-custom-prompts'"
        placeholder="copilot-custom-prompts"
        value={settings.customPromptsFolder}
        onChange={(value) => updateSettings({ customPromptsFolder: value })}
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
