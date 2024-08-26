import { DEFAULT_SYSTEM_PROMPT } from "@/constants";
import React from "react";
import { TextAreaComponent, TextComponent, ToggleComponent } from "./SettingBlocks";

interface AdvancedSettingsProps {
  openAIProxyBaseUrl: string;
  setOpenAIProxyBaseUrl: (value: string) => void;
  useOpenAILocalProxy: boolean;
  setUseOpenAILocalProxy: (value: boolean) => void;
  openAIProxyModelName: string;
  setOpenAIProxyModelName: (value: string) => void;
  openAIEmbeddingProxyBaseUrl: string;
  setOpenAIEmbeddingProxyBaseUrl: (value: string) => void;
  openAIEmbeddingProxyModelName: string;
  setOpenAIEmbeddingProxyModelName: (value: string) => void;
  userSystemPrompt: string;
  setUserSystemPrompt: (value: string) => void;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  openAIProxyBaseUrl,
  setOpenAIProxyBaseUrl,
  useOpenAILocalProxy,
  setUseOpenAILocalProxy,
  openAIProxyModelName,
  setOpenAIProxyModelName,
  openAIEmbeddingProxyBaseUrl,
  setOpenAIEmbeddingProxyBaseUrl,
  openAIEmbeddingProxyModelName,
  setOpenAIEmbeddingProxyModelName,
  userSystemPrompt,
  setUserSystemPrompt,
}) => {
  return (
    <div>
      <br />
      <br />
      <h1>Advanced Settings</h1>
      <div className="warning-message">
        OpenAI Proxy settings override the default OpenAI parameters, meaning now your OpenAI models
        are routed to this provider instead! Clear these fields to use OpenAI again.
        <br />
        This is in effect only when you pick any OpenAI model in the model dropdown.
        <br />
        If your provider needs an API key, use the OpenAI API key field above.
      </div>
      <TextComponent
        name="OpenAI Proxy Base URL"
        description="For providers that share the same API as OpenAI."
        value={openAIProxyBaseUrl}
        onChange={setOpenAIProxyBaseUrl}
        placeholder="https://openai.example.com/v1"
      />
      <ToggleComponent
        name="Use local proxy server for OpenAI"
        description="Enable if your proxy base URL results in CORS errors."
        value={useOpenAILocalProxy}
        onChange={setUseOpenAILocalProxy}
      />
      <TextComponent
        name="OpenAI Proxy Model Name"
        description="The actual model name you want to use with your provider. Overrides the OpenAI model name you pick in the Copilot Chat model selection. Note: non-OpenAI models picked will not be overridden!"
        value={openAIProxyModelName}
        onChange={setOpenAIProxyModelName}
        placeholder="gpt-4o-mini"
      />
      <TextComponent
        name="OpenAI Embedding Proxy Base URL"
        description="For embedding providers that share the same API as OpenAI."
        value={openAIEmbeddingProxyBaseUrl}
        onChange={setOpenAIEmbeddingProxyBaseUrl}
        placeholder="https://openai.example.com/v1"
      />
      <TextComponent
        name="OpenAI Embedding Proxy Model Name"
        description="The actual embedding model name you want to use with your provider. Overrides the OpenAI embedding model name you pick above. Note: non-OpenAI models picked will not be overridden!"
        value={openAIEmbeddingProxyModelName}
        onChange={setOpenAIEmbeddingProxyModelName}
        placeholder="text-embedding-ada-002"
      />
      <TextAreaComponent
        name="User System Prompt"
        description="Warning: It will override the default system prompt for all messages!"
        value={userSystemPrompt}
        onChange={setUserSystemPrompt}
        placeholder={userSystemPrompt || "Default: " + DEFAULT_SYSTEM_PROMPT}
      />
    </div>
  );
};

export default AdvancedSettings;
