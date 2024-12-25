import {
  DEFAULT_SETTINGS,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import React, { useEffect, useState } from "react";
import ApiSetting from "./ApiSetting";
import Collapsible from "./Collapsible";
import {
  AzureOpenAIDeployment,
  updateModelConfig,
} from "@/aiParams";
import {
  ChatModelProviders,
} from "@/constants";

const ApiSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [azureDeployments, setAzureDeployments] = useState<
    AzureOpenAIDeployment[]
  >(settings.azureOpenAIApiDeployments || []);
  const deployment: AzureOpenAIDeployment = settings.azureOpenAIApiDeployments?.[0] || DEFAULT_SETTINGS.azureOpenAIApiDeployments?.[0] || {
    deploymentName: "",
    apiKey: "",
    instanceName: "",
    apiVersion: "",
  };
  const [defaultAzureDeployment, setDefaultAzureDeployment] = useState<
    AzureOpenAIDeployment
  >(deployment);
  const [maxCompletionTokens, setMaxCompletionTokens] = useState<
    number | undefined
  >(undefined);
  const [reasoningEffort, setReasoningEffort] = useState<number | undefined>(
    undefined
  );

  useEffect(() => {
    const currentModel = settings.activeModels.find(
      (model) =>
        `${model.name}|${model.provider}` ===
        `${selectedModel}|${modelProvider}`
    );

    if (currentModel) {
      const modelKey = `${currentModel.name}|${currentModel.provider}`;
      setMaxCompletionTokens(
        settings.modelConfigs[modelKey]?.maxCompletionTokens
      );
      setReasoningEffort(settings.modelConfigs[modelKey]?.reasoningEffort);
    }
  }, [selectedModel, settings.activeModels, settings.modelConfigs]);

  useEffect(() => {
    setAzureDeployments(settings.azureOpenAIApiDeployments || []);
  }, [settings.azureOpenAIApiDeployments]);

  const handleAddAzureDeployment = () => {
    const newDeployment = {
      deploymentName: defaultAzureDeployment.deploymentName,
      instanceName: defaultAzureDeployment.instanceName,
      apiKey: defaultAzureDeployment.apiKey,
      apiVersion: defaultAzureDeployment.apiVersion,
    };
    const updatedDeployments = [...azureDeployments, newDeployment];
    setAzureDeployments(updatedDeployments);
    updateSetting("azureOpenAIApiDeployments", updatedDeployments);

    // Reset the defaultAzureDeployment to empty strings
    setDefaultAzureDeployment({
      deploymentName: "",
      instanceName: "",
      apiKey: "",
      apiVersion: "",
    });
  };

  const handleUpdateAzureDeployment = (
    index: number,
    updatedDeployment: AzureOpenAIDeployment
  ) => {
    const updatedDeployments = [...azureDeployments];
    updatedDeployments[index] = updatedDeployment;
    setAzureDeployments(updatedDeployments);
    updateSetting("azureOpenAIApiDeployments", updatedDeployments);
  };

  const handleRemoveAzureDeployment = (index: number) => {
    const updatedDeployments = azureDeployments.filter((_, i) => i !== index);
    setAzureDeployments(updatedDeployments);
    updateSetting("azureOpenAIApiDeployments", updatedDeployments);
  };

  const handleMaxCompletionTokensChange = (value: number) => {
    setMaxCompletionTokens(value);
    let modelKey = `${selectedModel}|${modelProvider}`;
    if (selectedModel === "o1-preview") {
      modelKey = `o1-preview|${selectedDeployment}`;
    }
    updateModelConfig(modelKey, { maxCompletionTokens: value });
  };

  const handleReasoningEffortChange = (value: number) => {
    setReasoningEffort(value);
    let modelKey = `${selectedModel}|${modelProvider}`;
    if (selectedModel === "o1-preview") {
      modelKey = `o1-preview|${selectedDeployment}`;
    }
    updateModelConfig(modelKey, { reasoningEffort: value });
  };

  const handleModelChange = (modelName: string) => {
    setSelectedModel(modelName);
    const modelConfig = settings.modelConfigs[modelName];
    if (modelConfig) {
      setMaxCompletionTokens(modelConfig.maxCompletionTokens);
      setReasoningEffort(modelConfig.reasoningEffort);
    } else {
      setMaxCompletionTokens(undefined);
      setReasoningEffort(undefined);
    }
  };

  return (
    <div>
      <h1>API Settings</h1>
      <p>All your API keys are stored locally.</p>
      <div className="warning-message">
        Make sure you have access to the model and the correct API key.
        <br />
        If errors occur, please try resetting to default and re-enter the API
        key.
      </div>
      <div>
        <div>
          <ApiSetting
            title="OpenAI API Key"
            value={settings.openAIApiKey}
            setValue={(value) => updateSetting("openAIApiKey", value)}
            placeholder="Enter OpenAI API Key"
          />
          <p>
            You can find your API key at{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://platform.openai.com/api-keys
            </a>
          </p>
          <ApiSetting
            title="OpenAI Organization ID (optional)"
            value={settings.openAIOrgId}
            setValue={(value) => updateSetting("openAIOrgId", value)}
            placeholder="Enter OpenAI Organization ID if applicable"
          />
        </div>
        <div className="warning-message">
          <span>If you are a new user, try </span>
          <a
            href="https://platform.openai.com/playground?mode=chat"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAI playground
          </a>
          <span> to see if you have correct API access first.</span>
        </div>
      </div>
      <br />
      <Collapsible title="Google API Settings">
        <div>
          <ApiSetting
            title="Google API Key"
            value={settings.googleApiKey}
            setValue={(value) => updateSetting("googleApiKey", value)}
            placeholder="Enter Google API Key"
          />
          <p>
            If you have Google Cloud, you can get Gemini API key{" "}
            <a
              href="https://makersuite.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
            >
              here
            </a>
            .
            <br />
            Your API key is stored locally and is only used to make requests to
            Google's services.
          </p>
        </div>
      </Collapsible>
      <Collapsible title="Anthropic API Settings">
        <div>
          <ApiSetting
            title="Anthropic API Key"
            value={settings.anthropicApiKey}
            setValue={(value) => updateSetting("anthropicApiKey", value)}
            placeholder="Enter Anthropic API Key"
          />
          <p>
            If you have Anthropic API access, you can get the API key{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              here
            </a>
            .
            <br />
            Your API key is stored locally and is only used to make requests to
            Anthropic's services.
          </p>
        </div>
      </Collapsible>
      <Collapsible title="OpenRouter.ai API Settings">
        <div>
          <ApiSetting
            title="OpenRouter AI API Key"
            value={settings.openRouterAiApiKey}
            setValue={(value) => updateSetting("openRouterAiApiKey", value)}
            placeholder="Enter OpenRouter AI API Key"
          />
          <p>
            You can get your OpenRouterAI key{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              here
            </a>
            .
            <br />
            Find models{" "}
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noopener noreferrer"
            >
              here
            </a>
            .
          </p>
        </div>
      </Collapsible>
      <Collapsible title="Azure OpenAI API Settings">
        <div>
          {azureDeployments.map((deployment, index) => (
            <div key={index} className="api-setting">
              <ApiSetting
                title="Deployment Name"
                value={deployment.deploymentName}
                setValue={(value) =>
                  handleUpdateAzureDeployment(index, {
                    ...deployment,
                    deploymentName: value,
                  })
                }
                placeholder="Enter Deployment Name"
                type="text"
              />
              <ApiSetting
                title="Instance Name"
                value={deployment.instanceName}
                setValue={(value) =>
                  handleUpdateAzureDeployment(index, {
                    ...deployment,
                    instanceName: value,
                  })
                }
                placeholder="Enter Instance Name"
                type="text"
              />
              <ApiSetting
                title="API Key"
                value={deployment.apiKey}
                setValue={(value) =>
                  handleUpdateAzureDeployment(index, {
                    ...deployment,
                    apiKey: value,
                  })
                }
                placeholder="Enter API Key"
                type="password"
              />
              <ApiSetting
                title="API Version"
                value={deployment.apiVersion}
                setValue={(value) =>
                  handleUpdateAzureDeployment(index, {
                    ...deployment,
                    apiVersion: value,
                  })
                }
                placeholder="Enter API Version"
                type="text"
              />
              <button
                className="mod-cta"
                onClick={() => handleRemoveAzureDeployment(index)}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="api-setting">
            <input
              type="text"
              placeholder="Enter Deployment Name"
              value={defaultAzureDeployment.deploymentName}
              onChange={(e) =>
                setDefaultAzureDeployment({
                  ...defaultAzureDeployment,
                  deploymentName: e.target.value,
                })
              }
            />
            <input
              type="text"
              placeholder="Enter Instance Name"
              value={defaultAzureDeployment.instanceName}
              onChange={(e) =>
                setDefaultAzureDeployment({
                  ...defaultAzureDeployment,
                  instanceName: e.target.value,
                })
              }
            />
            <input
              type="password"
              placeholder="Enter API Key"
              value={defaultAzureDeployment.apiKey}
              onChange={(e) =>
                setDefaultAzureDeployment({
                  ...defaultAzureDeployment,
                  apiKey: e.target.value,
                })
              }
            />
            <input
              type="text"
              placeholder="Enter API Version"
              value={defaultAzureDeployment.apiVersion}
              onChange={(e) =>
                setDefaultAzureDeployment({
                  ...defaultAzureDeployment,
                  apiVersion: e.target.value,
                })
              }
            />
            <button className="mod-cta" onClick={handleAddAzureDeployment}>
              Add Deployment
            </button>
          </div>
        </div>
      </Collapsible>
      <Collapsible title="o1-preview Settings">
        <div>
          <select
            value={selectedDeployment}
            onChange={(e) => setSelectedDeployment(e.target.value)}
            disabled={azureDeployments.length === 0}
          >
            <option value="" disabled>
              Select Deployment
            </option>
            {azureDeployments.map((d, index) => (
              <option key={index} value={d.deploymentName}>
                {d.deploymentName}
              </option>
            ))}
          </select>
          <ApiSetting
            title="Max Completion Tokens"
            value={maxCompletionTokens?.toString() || ""}
            setValue={(value) => handleMaxCompletionTokensChange(Number(value))}
            placeholder="Enter Max Completion Tokens"
            type="number"
          />
          <ApiSetting
            title="Reasoning Effort"
            value={reasoningEffort?.toString() || ""}
            setValue={(value) => handleReasoningEffortChange(Number(value))}
            placeholder="Enter Reasoning Effort (0-100)"
            type="number"
          />
        </div>
      </Collapsible>
      <Collapsible title="Groq API Settings">
        <div>
          <ApiSetting
            title="Groq API Key"
            value={settings.groqApiKey}
            setValue={(value) => updateSetting("groqApiKey", value)}
            placeholder="Enter Groq API Key"
          />
          <p>
            If you have Groq API access, you can get the API key{" "}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              here
            </a>
            .
            <br />
            Your API key is stored locally and is only used to make requests to
            Groq's services.
          </p>
        </div>
      </Collapsible>
      <Collapsible title="Cohere API Settings">
        <ApiSetting
          title="Cohere API Key"
          value={settings.cohereApiKey}
          setValue={(value) => updateSetting("cohereApiKey", value)}
          placeholder="Enter Cohere API Key"
        />
        <p>
          Get your free Cohere API key{" "}
          <a
            href="https://dashboard.cohere.ai/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            here
          </a>
        </p>
      </Collapsible>
    </div>
  );
};

export default ApiSettings;

