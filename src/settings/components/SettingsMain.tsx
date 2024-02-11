import CopilotPlugin from "@/main";
import { Notice } from 'obsidian';
import React, { Fragment, useState } from 'react';
import { ChatModelDisplayNames, DEFAULT_SETTINGS, DISPLAY_NAME_TO_MODEL } from '../../constants';
import AdvancedSettings from './AdvancedSettings';
import ApiSettings from './ApiSettings';
import LocalCopilotSettings from './LocalCopilotSettings';
import QASettings from './QASettings';
import { DropdownComponent, SliderComponent, TextComponent } from './SettingBlocks';

interface SettingsMainProps {
  plugin: CopilotPlugin;
  reloadPlugin: () => Promise<void>;
}

export default function SettingsMain({ plugin, reloadPlugin }: SettingsMainProps) {
  const [defaultModelDisplayName, setDefaultModelDisplayName] = useState(plugin.settings.defaultModelDisplayName);
  const [defaultSaveFolder, setDefaultSaveFolder] = useState(plugin.settings.defaultSaveFolder);
  const [temperature, setTemperature] = useState(plugin.settings.temperature);
  const [maxTokens, setMaxTokens] = useState(plugin.settings.maxTokens);
  const [contextTurns, setContextTurns] = useState(plugin.settings.contextTurns);

  // API settings
  const [openAIApiKey, setOpenAIApiKey] = useState(plugin.settings.openAIApiKey);
  const [googleApiKey, setGoogleApiKey] = useState(plugin.settings.googleApiKey);

  const [openRouterAiApiKey, setOpenRouterAiApiKey] = useState(plugin.settings.openRouterAiApiKey);
  const [openRouterModel, setOpenRouterModel] = useState(plugin.settings.openRouterModel);

  const [azureOpenAIApiKey, setAzureOpenAIApiKey] = useState(plugin.settings.azureOpenAIApiKey);
  const [azureOpenAIApiInstanceName, setAzureOpenAIApiInstanceName] = useState(plugin.settings.azureOpenAIApiInstanceName);
  const [azureOpenAIApiDeploymentName, setAzureOpenAIApiDeploymentName] = useState(plugin.settings.azureOpenAIApiDeploymentName);
  const [azureOpenAIApiVersion, setAzureOpenAIApiVersion] = useState(plugin.settings.azureOpenAIApiVersion);
  const [azureOpenAIApiEmbeddingDeploymentName, setAzureOpenAIApiEmbeddingDeploymentName] = useState(plugin.settings.azureOpenAIApiEmbeddingDeploymentName);

  // QA settings
  const [embeddingProvider, setEmbeddingProvider] = useState(plugin.settings.embeddingProvider);
  const [embeddingModel, setEmbeddingModel] = useState(plugin.settings.embeddingModel);
  const [ttlDays, setTtlDays] = useState(plugin.settings.ttlDays);
  const [cohereApiKey, setCohereApiKey] = useState(plugin.settings.cohereApiKey);
  const [huggingfaceApiKey, setHuggingfaceApiKey] = useState(plugin.settings.huggingfaceApiKey);

  // Advanced settings
  const [userSystemPrompt, setUserSystemPrompt] = useState(plugin.settings.userSystemPrompt);
  const [openAIProxyBaseUrl, setOpenAIProxyBaseUrl] = useState(plugin.settings.openAIProxyBaseUrl);

  // Local Copilot Settings
  const [lmStudioBaseUrl, setlmStudioBaseUrl] = useState(plugin.settings.lmStudioBaseUrl);
  const [ollamaModel, setOllamaModel] = useState(plugin.settings.ollamaModel);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(plugin.settings.ollamaBaseUrl);

	// Context note chat settings
	const [chatNoteContextTags, setChatNoteContextTags] = useState(plugin.settings.chatNoteContextTags);

  // NOTE: When new settings are added, make sure to add them to saveAllSettings
  const saveAllSettings = async () => {
    plugin.settings.defaultModelDisplayName = defaultModelDisplayName;
    plugin.settings.defaultModel = DISPLAY_NAME_TO_MODEL[defaultModelDisplayName];
    plugin.settings.defaultSaveFolder = defaultSaveFolder;
    plugin.settings.temperature = temperature;
    plugin.settings.maxTokens = maxTokens;
    plugin.settings.contextTurns = contextTurns;

    // API settings
    plugin.settings.openAIApiKey = openAIApiKey;
    plugin.settings.googleApiKey = googleApiKey;
    plugin.settings.openRouterAiApiKey = openRouterAiApiKey;
    plugin.settings.openRouterModel = openRouterModel;
    plugin.settings.azureOpenAIApiKey = azureOpenAIApiKey;
    plugin.settings.azureOpenAIApiInstanceName = azureOpenAIApiInstanceName;
    plugin.settings.azureOpenAIApiDeploymentName = azureOpenAIApiDeploymentName;
    plugin.settings.azureOpenAIApiVersion = azureOpenAIApiVersion;
    plugin.settings.azureOpenAIApiEmbeddingDeploymentName = azureOpenAIApiEmbeddingDeploymentName;

    // QA settings
    plugin.settings.embeddingProvider = embeddingProvider;
    plugin.settings.embeddingModel = embeddingModel;
    plugin.settings.ttlDays = ttlDays;
    plugin.settings.cohereApiKey = cohereApiKey;
    plugin.settings.huggingfaceApiKey = huggingfaceApiKey;

    // Advanced settings
    plugin.settings.userSystemPrompt = userSystemPrompt;
    plugin.settings.openAIProxyBaseUrl = openAIProxyBaseUrl;

    // Local Copilot Settings
    plugin.settings.lmStudioBaseUrl = lmStudioBaseUrl;
    plugin.settings.ollamaModel = ollamaModel;
    plugin.settings.ollamaBaseUrl = ollamaBaseUrl;

		// Context note chat settings
		plugin.settings.chatNoteContextTags = chatNoteContextTags;

    await plugin.saveSettings();
    await reloadPlugin();
    new Notice('Settings have been saved and the plugin has been reloaded.');
  };

  const resetToDefaultSettings = async () => {
    plugin.settings = DEFAULT_SETTINGS;
    await plugin.saveSettings();
    await reloadPlugin();
    new Notice('Settings have been reset to their default values.');
  };

  return (
    <>
      <div>
        <h2>Copilot Settings</h2>
        <div className="button-container">
          <button className="mod-cta" onClick={saveAllSettings}>
            Save and Reload
          </button>
          <button className="mod-cta" onClick={resetToDefaultSettings}>
            Reset to Default Settings
          </button>
        </div>
        <div className="warning-message">
          Please Save and Reload the plugin when you change any setting below!
        </div>

        <DropdownComponent
          name="Default Model"
          options={Object.values(ChatModelDisplayNames)}
          value={defaultModelDisplayName}
          onChange={setDefaultModelDisplayName}
        />
        <TextComponent
          name="Default Conversation Folder Name"
          description="The default folder name where chat conversations will be saved. Default is 'copilot-conversations'"
          placeholder="copilot-conversations"
          value={defaultSaveFolder}
          onChange={setDefaultSaveFolder}
        />
        <h6>
          Please be mindful of the number of tokens and context conversation turns you set here, as they will affect the cost of your API requests.
        </h6>
        <SliderComponent
          name="Temperature"
          description="Default is 0.1. Higher values will result in more creativeness, but also more mistakes. Set to 0 for no randomness."
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          onChange={async (value) => {
            setTemperature(value);
          }}
        />
        <SliderComponent
          name="Token limit"
          description={
            <Fragment>
              <p>The maximum number of <em>output tokens</em> to generate. Default is 1000.</p>
              <em>This number plus the length of your prompt (input tokens) must be smaller than the context window of the model.</em>
            </Fragment>
          }
          min={0}
          max={10000}
          step={100}
          value={maxTokens}
          onChange={async (value) => {
            setMaxTokens(value);
          }}
        />
        <SliderComponent
          name="Conversation turns in context"
          description="The number of previous conversation turns to include in the context. Default is 15 turns, i.e. 30 messages."
          min={1}
          max={30}
          step={1}
          value={contextTurns}
          onChange={async (value) => {
            setContextTurns(value);
          }}
        />
      </div>

      <ApiSettings
        openAIApiKey={openAIApiKey}
        setOpenAIApiKey={setOpenAIApiKey}
        googleApiKey={googleApiKey}
        setGoogleApiKey={setGoogleApiKey}
        openRouterAiApiKey={openRouterAiApiKey}
        setOpenRouterAiApiKey={setOpenRouterAiApiKey}
        openRouterModel={openRouterModel}
        setOpenRouterModel={setOpenRouterModel}
        azureOpenAIApiKey={azureOpenAIApiKey}
        setAzureOpenAIApiKey={setAzureOpenAIApiKey}
        azureOpenAIApiInstanceName={azureOpenAIApiInstanceName}
        setAzureOpenAIApiInstanceName={setAzureOpenAIApiInstanceName}
        azureOpenAIApiDeploymentName={azureOpenAIApiDeploymentName}
        setAzureOpenAIApiDeploymentName={setAzureOpenAIApiDeploymentName}
        azureOpenAIApiVersion={azureOpenAIApiVersion}
        setAzureOpenAIApiVersion={setAzureOpenAIApiVersion}
        azureOpenAIApiEmbeddingDeploymentName={azureOpenAIApiEmbeddingDeploymentName}
        setAzureOpenAIApiEmbeddingDeploymentName={setAzureOpenAIApiEmbeddingDeploymentName}
      />
      <QASettings
        embeddingProvider={embeddingProvider}
        setEmbeddingProvider={setEmbeddingProvider}
        embeddingModel={embeddingModel}
        setEmbeddingModel={setEmbeddingModel}
        ttlDays={ttlDays}
        setTtlDays={setTtlDays}
        cohereApiKey={cohereApiKey}
        setCohereApiKey={setCohereApiKey}
        huggingfaceApiKey={huggingfaceApiKey}
        setHuggingfaceApiKey={setHuggingfaceApiKey}
      />
      <AdvancedSettings
        openAIProxyBaseUrl={openAIProxyBaseUrl}
        setOpenAIProxyBaseUrl={setOpenAIProxyBaseUrl}
        userSystemPrompt={userSystemPrompt}
        setUserSystemPrompt={setUserSystemPrompt}
      />
      <LocalCopilotSettings
        lmStudioBaseUrl={lmStudioBaseUrl}
        setlmStudioBaseUrl={setlmStudioBaseUrl}
        ollamaModel={ollamaModel}
        setOllamaModel={setOllamaModel}
        ollamaBaseUrl={ollamaBaseUrl}
        setOllamaBaseUrl={setOllamaBaseUrl}
      />
			<TextComponent
				name="Chat note context tags"
				description="Comma-separated list of tags that will be fetched alongside active notes for context."
				placeholder="#copilot_notes,#copilot_other_notes"
				value={chatNoteContextTags}
				onChange={setChatNoteContextTags}
			/>
    </>
  );
}
