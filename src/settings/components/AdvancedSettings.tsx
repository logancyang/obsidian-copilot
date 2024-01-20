import React from 'react';
import { TextAreaComponent, TextComponent } from './SettingBlocks';

interface AdvancedSettingsProps {
  openAIProxyBaseUrl: string;
  setOpenAIProxyBaseUrl: (value: string) => void;
  userSystemPrompt: string;
  setUserSystemPrompt: (value: string) => void;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  openAIProxyBaseUrl,
  setOpenAIProxyBaseUrl,
  userSystemPrompt,
  setUserSystemPrompt,
}) => {
  return (
    <div>
      <br/>
      <br/>
      <h1>Advanced Settings</h1>
      <div className="warning-message">
        OpenAI Proxy Base URL overrides the default OpenAI base URL, meaning now your OpenAI models are routed to this provider instead! Clear this field to use OpenAI again.
      </div>
      <TextComponent
        name="OpenAI Proxy Base URL"
        description="For providers that shares the same API as OpenAI."
        value={openAIProxyBaseUrl}
        onChange={setOpenAIProxyBaseUrl}
        placeholder="https://openai.example.com/v1"
      />
      <TextAreaComponent
        name="User System Prompt"
        description="Warning: It will override the default system prompt for all messages!"
        value={userSystemPrompt}
        onChange={setUserSystemPrompt}
        placeholder="Enter your custom system prompt here"
      />
    </div>
  );
};

export default AdvancedSettings;
