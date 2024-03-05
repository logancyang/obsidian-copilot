import { EmbeddingModels, VAULT_VECTOR_STORE_STRATEGIES } from '@/constants';
import React from 'react';
import ApiSetting from './ApiSetting';
import Collapsible from './Collapsible';
import { DropdownComponent, SliderComponent } from './SettingBlocks';

interface QASettingsProps {
  embeddingModel: string;
  setEmbeddingModel: (value: string) => void;
  cohereApiKey: string;
  setCohereApiKey: (value: string) => void;
  huggingfaceApiKey: string;
  setHuggingfaceApiKey: (value: string) => void;
  indexVaultToVectorStore: string;
  setIndexVaultToVectorStore: (value: string) => void;
  maxSourceChunks: number;
  setMaxSourceChunks: (value: number) => void;
}

const QASettings: React.FC<QASettingsProps> = ({
  embeddingModel,
  setEmbeddingModel,
  cohereApiKey,
  setCohereApiKey,
  huggingfaceApiKey,
  setHuggingfaceApiKey,
  indexVaultToVectorStore,
  setIndexVaultToVectorStore,
  maxSourceChunks,
  setMaxSourceChunks,
}) => {
  return (
    <div>
      <br />
      <br />
      <h1>QA Settings</h1>
      <div className="warning-message">
        Vault QA is in BETA and may not be stable. If you have issues please report in the github repo.
      </div>
      <p>QA mode relies a <em>local</em> vector index.</p>
      <h2>Long Note QA vs. Vault QA (BETA)</h2>
      <p>Long Note QA mode uses the Active Note as context. Vault QA (BETA) uses your entire vault as context. Please ask questions as specific as possible, avoid vague questions to get better results.</p>
      <h2>Local Embedding Model</h2>
      <p>Check the <a href='https://github.com/logancyang/obsidian-copilot/blob/master/local_copilot.md'>local copilot</a> setup guide to setup Ollama's local embedding model (requires Ollama v0.1.26 or above).</p>
      <DropdownComponent
        name="Embedding Models"
        description="The embedding API/model to use"
        value={embeddingModel}
        onChange={setEmbeddingModel}
        options={Object.values(EmbeddingModels)}
      />
      <h1>Auto-Index Strategy</h1>
      <div className="warning-message">
        If you are using a paid embedding provider, beware of costs for large vaults!
      </div>
      <p>
        When you switch to <strong>Long Note QA</strong> mode, your active note is indexed automatically upon mode switch.
        <br />
        When you switch to <strong>Vault QA</strong> mode, your vault is indexed <em>based on the auto-index strategy you select below</em>.
        <br />
      </p>
      <DropdownComponent
        name="Auto-index vault strategy"
        description="Decide when you want the vault to be indexed."
        value={indexVaultToVectorStore}
        onChange={setIndexVaultToVectorStore}
        options={VAULT_VECTOR_STORE_STRATEGIES}
      />
      <br />
      <p>
        <strong>NEVER</strong>: Notes are never indexed to the vector store unless users run the command <em>Index vault for QA</em> explicitly, or hit the <em>Refresh Index</em> button.
        <br /><br />
        <strong>ON STARTUP</strong>: Vault index is refreshed on plugin load/reload.
        <br /><br />
        <strong>ON MODE SWITCH (Recommended)</strong>: Vault index is refreshed when switching to Vault QA mode.
        <br /><br />
        By "refreshed", it means the vault index is not rebuilt from scratch but rather updated incrementally with new/modified notes since the last index. If you need a complete rebuild, run the commands "Clear vector store" and "Force re-index for QA" manually. This helps reduce costs when using paid embedding models.<br /><br />
        Beware of the cost if you are using a paid embedding model and have a large vault! You can run Copilot command <em>Count total tokens in your vault</em> and refer to your selected embedding model pricing to estimate indexing costs.
      </p>
      <br />
      <SliderComponent
        name="Max Sources"
        description="Default is 3 (Recommended). Increase if you want more sources from your notes. A higher number can lead to irrelevant sources and lower quality responses, it also fills up the context window faster."
        min={1}
        max={10}
        step={1}
        value={maxSourceChunks}
        onChange={async (value) => {
          setMaxSourceChunks(value);
        }}
      />
      <br />
      <Collapsible title="Cohere API Settings">
        <ApiSetting
          title="Cohere API Key"
          value={cohereApiKey}
          setValue={setCohereApiKey}
          placeholder="Enter Cohere API Key"
        />
        <p>
          Get your free Cohere API key{' '}
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

export default QASettings;
