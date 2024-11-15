import CopilotPlugin from "@/main";
import React from "react";
import { useSettingsContext } from "../contexts/SettingsContext";
import AdvancedSettings from "./AdvancedSettings";
import ApiSettings from "./ApiSettings";
import CopilotPlusSettings from "./CopilotPlusSettings";
import GeneralSettings from "./GeneralSettings";
import QASettings from "./QASettings";
import { CustomModel } from "@/aiParams";

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

      <CopilotPlusSettings />
      <GeneralSettings
        getLangChainParams={plugin.getLangChainParams.bind(plugin)}
        encryptionService={plugin.getEncryptionService()}
        ping={(customModel: CustomModel) => plugin.chainManager.ping("chat", customModel)}
      />
      <ApiSettings
        {...settings}
        setOpenAIApiKey={(value) => updateSettings({ openAIApiKey: value })}
        setOpenAIOrgId={(value) => updateSettings({ openAIOrgId: value })}
        setGoogleApiKey={(value) => updateSettings({ googleApiKey: value })}
        setAnthropicApiKey={(value) => updateSettings({ anthropicApiKey: value })}
        setOpenRouterAiApiKey={(value) => updateSettings({ openRouterAiApiKey: value })}
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
        setCohereApiKey={(value) => updateSettings({ cohereApiKey: value })}
      />
      <QASettings
        {...settings}
        setHuggingfaceApiKey={(value) => updateSettings({ huggingfaceApiKey: value })}
        setIndexVaultToVectorStore={(value) => updateSettings({ indexVaultToVectorStore: value })}
        setMaxSourceChunks={(value) => updateSettings({ maxSourceChunks: value })}
        disableIndexOnMobile={settings.disableIndexOnMobile}
        setDisableIndexOnMobile={(value) => updateSettings({ disableIndexOnMobile: value })}
        ping={(customModel: CustomModel) => plugin.chainManager.ping("embedding", customModel)}
      />
      <AdvancedSettings
        {...settings}
        setUserSystemPrompt={(value) => updateSettings({ userSystemPrompt: value })}
      />
    </>
  );
};

export default React.memo(SettingsMain);
