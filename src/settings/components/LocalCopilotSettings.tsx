import React from 'react';
import { TextComponent } from './SettingBlocks';

interface LocalCopilotSettingsProps {
  lmStudioPort: string;
  setLmStudioPort: (value: string) => void;
  ollamaModel: string;
  setOllamaModel: (value: string) => void;
}

const LocalCopilotSettings: React.FC<LocalCopilotSettingsProps> = ({
  lmStudioPort,
  setLmStudioPort,
  ollamaModel,
  setOllamaModel,
}) => {
  return (
    <div>
      <br/>
      <h1>Local Copilot (No Internet Required!)</h1>
      <div className="warning-message">
        Please check the doc to set up LM Studio or Ollama server on your device.
      </div>
      <p>
        Local models can be limited in capabilities and may not work for some use cases at this time. Keep in mind that it is still in early experimental phase. But some 13B even 7B models are already quite capable!
      </p>
      <h3>LM Studio</h3>
      <p>
        To use Local Copilot with LM Studio:<br />
        1. Start LM Studio server with CORS on. Default port is 1234 but if you change it, you can provide it below.<br />
        2. Pick LM Studio in the Copilot Chat model selection dropdown to chat with it!
      </p>
      <TextComponent
        name="LM Studio Server Port"
        description="Default is 1234."
        value={lmStudioPort}
        onChange={setLmStudioPort}
        placeholder="1234"
      />
      <h3>Ollama</h3>
      <p>To use Local Copilot with Ollama, pick Ollama in the Copilot Chat model selection dropdown.</p>
      <p>Run the local Ollama server by running this in your terminal:</p>
      <p><strong>OLLAMA_ORIGINS=app://obsidian.md* ollama serve</strong></p>
      <TextComponent
        name="Ollama model"
        description="Default is llama2 (7b)."
        value={ollamaModel}
        onChange={setOllamaModel}
        placeholder="llama2"
      />
    </div>
  );
};

export default LocalCopilotSettings;
