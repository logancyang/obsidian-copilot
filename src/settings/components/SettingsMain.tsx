import CopilotPlugin from "@/main";
import React from "react";
import { useSettingsContext } from "../contexts/SettingsContext";
import AdvancedSettings from "./AdvancedSettings";
import ApiSettings from "./ApiSettings";
import GeneralSettings from "./GeneralSettings";
import LocalCopilotSettings from "./LocalCopilotSettings";
import QASettings from "./QASettings";

const SettingsMain: React.FC<{ plugin: CopilotPlugin; reloadPlugin: () => Promise<void> }> = ({
  plugin,
  reloadPlugin,
}) => {
  const { settings, updateSettings, saveSettings, resetSettings } = useSettingsContext();

  return (
    <>
      <h2>Copilot Settings</h2>
      <div className="button-container">
        <button className="mod-cta" onClick={saveSettings}>
          Save and Reload
        </button>
        <button className="mod-cta" onClick={resetSettings}>
          Reset to Default Settings
        </button>
      </div>
      <div className="warning-message">
        Please Save and Reload the plugin when you change any setting below!
      </div>

      <GeneralSettings />
      <ApiSettings
        {...settings}
        setOpenAIApiKey={(value) => updateSettings({ openAIApiKey: value })}
        setOpenAIOrgId={(value) => updateSettings({ openAIOrgId: value })}
        setOpenAICustomModel={(value) => updateSettings({ openAICustomModel: value })}
        setGoogleApiKey={(value) => updateSettings({ googleApiKey: value })}
        setGoogleCustomModel={(value) => updateSettings({ googleCustomModel: value })}
        setAnthropicApiKey={(value) => updateSettings({ anthropicApiKey: value })}
        setAnthropicModel={(value) => updateSettings({ anthropicModel: value })}
        setOpenRouterAiApiKey={(value) => updateSettings({ openRouterAiApiKey: value })}
        setOpenRouterModel={(value) => updateSettings({ openRouterModel: value })}
        setAzureOpenAIApiKey={(value) => updateSettings({ azureOpenAIApiKey: value })}
        setAzureOpenAIApiInstanceName={(value) =>
          updateSettings({ azureOpenAIApiInstanceName: value })
        }
        setAzureOpenAIApiDeploymentName={(value) =>
          updateSettings({ azureOpenAIApiDeploymentName: value })
        }
        setAzureOpenAIApiVersion={(value) => updateSettings({ azureOpenAIApiVersion: value })}
        setAzureOpenAIApiEmbeddingDeploymentName={(value) =>
          updateSettings({ azureOpenAIApiEmbeddingDeploymentName: value })
        }
        setGroqApiKey={(value) => updateSettings({ groqApiKey: value })}
        setGroqModel={(value) => updateSettings({ groqModel: value })}
      />
      <QASettings
        {...settings}
        setEmbeddingModel={(value) => updateSettings({ embeddingModel: value })}
        setCohereApiKey={(value) => updateSettings({ cohereApiKey: value })}
        setHuggingfaceApiKey={(value) => updateSettings({ huggingfaceApiKey: value })}
        setIndexVaultToVectorStore={(value) => updateSettings({ indexVaultToVectorStore: value })}
        setMaxSourceChunks={(value) => updateSettings({ maxSourceChunks: value })}
      />
      <AdvancedSettings
        {...settings}
        setOpenAIProxyBaseUrl={(value) => updateSettings({ openAIProxyBaseUrl: value })}
        setEnableCors={(value) => updateSettings({ enableCors: value })}
        setOpenAIProxyModelName={(value) => updateSettings({ openAIProxyModelName: value })}
        setOpenAIEmbeddingProxyBaseUrl={(value) =>
          updateSettings({ openAIEmbeddingProxyBaseUrl: value })
        }
        setOpenAIEmbeddingProxyModelName={(value) =>
          updateSettings({ openAIEmbeddingProxyModelName: value })
        }
        setUserSystemPrompt={(value) => updateSettings({ userSystemPrompt: value })}
      />
      <LocalCopilotSettings
        {...settings}
        setlmStudioBaseUrl={(value) => updateSettings({ lmStudioBaseUrl: value })}
        setOllamaModel={(value) => updateSettings({ ollamaModel: value })}
        setOllamaBaseUrl={(value) => updateSettings({ ollamaBaseUrl: value })}
      />
    </>
  );
};

export default React.memo(SettingsMain);
