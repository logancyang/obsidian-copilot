import React from "react";
import ApiSetting from "./ApiSetting";
import Collapsible from "./Collapsible";
import { updateSetting, useSettingsValue } from "@/settings/model";

const ApiSettings: React.FC = () => {
  const settings = useSettingsValue();
  return (
    <div>
      <h1>API Settings</h1>
      <p>All your API keys are stored locally.</p>
      <div className="warning-message">
        Make sure you have access to the model and the correct API key.
        <br />
        If errors occur, please re-enter the API key, save and reload the plugin to see if it
        resolves the issue.
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
            Your API key is stored locally and is only used to make requests to Google's services.
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
            Your API key is stored locally and is only used to make requests to Anthropic's
            services.
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
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
              here
            </a>
            .
            <br />
            Find models{" "}
            <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">
              here
            </a>
            .
          </p>
        </div>
      </Collapsible>

      <Collapsible title="Azure OpenAI API Settings">
        <div>
          <ApiSetting
            title="Azure OpenAI API Key"
            value={settings.azureOpenAIApiKey}
            setValue={(value) => updateSetting("azureOpenAIApiKey", value)}
            placeholder="Enter Azure OpenAI API Key"
          />
          <ApiSetting
            title="Azure OpenAI API Instance Name"
            value={settings.azureOpenAIApiInstanceName}
            setValue={(value) => updateSetting("azureOpenAIApiInstanceName", value)}
            placeholder="Enter Azure OpenAI API Instance Name"
            type="text"
          />
          <ApiSetting
            title="Azure OpenAI API Deployment Name"
            description="This is your actual model, no need to pass a model name separately."
            value={settings.azureOpenAIApiDeploymentName}
            setValue={(value) => updateSetting("azureOpenAIApiDeploymentName", value)}
            placeholder="Enter Azure OpenAI API Deployment Name"
            type="text"
          />
          <ApiSetting
            title="Azure OpenAI API Version"
            value={settings.azureOpenAIApiVersion}
            setValue={(value) => updateSetting("azureOpenAIApiVersion", value)}
            placeholder="Enter Azure OpenAI API Version"
            type="text"
          />
          <ApiSetting
            title="Azure OpenAI API Embedding Deployment Name"
            description="(Optional) For embedding provider Azure OpenAI"
            value={settings.azureOpenAIApiEmbeddingDeploymentName}
            setValue={(value) => updateSetting("azureOpenAIApiEmbeddingDeploymentName", value)}
            placeholder="Enter Azure OpenAI API Embedding Deployment Name"
            type="text"
          />
          <p>
            For `o1-preview` model, ensure that the `azureOpenAIApiDeploymentName` is correctly
            configured. The plugin uses `maxCompletionTokens` instead of `maxTokens` for `o1-preview`
            models.
          </p>
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
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
              here
            </a>
            .
            <br />
            Your API key is stored locally and is only used to make requests to Groq's services.
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
          <a href="https://dashboard.cohere.ai/api-keys" target="_blank" rel="noreferrer">
            here
          </a>
        </p>
      </Collapsible>
    </div>
  );
};

export default ApiSettings;
