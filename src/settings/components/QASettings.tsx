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
      <DropdownComponent
        name="Embedding Models"
        description="The embedding API/model to use"
        value={embeddingModel}
        onChange={setEmbeddingModel}
        options={Object.values(EmbeddingModels)}
      />
      <h1>How Indexing Works</h1>
      <div className="warning-message">
        If you are using a paid embedding provider, beware of costs for large vaults!
      </div>
      <p>
        When you switch to Long Note QA mode, your active note is indexed.
        <br />
        When you switch to Vault QA mode, your vault is indexed based on the auto-index strategy you select below:
        <br /><br />
        <strong>NEVER</strong>: Notes are never indexed to the vector store unless users run the command <em>Index vault for QA</em> explicitly, or hit the <em>Refresh Index</em> button.
        <br /><br />
        <strong>ON STARTUP</strong>: Notes are indexed (refreshed) on plugin load/reload.
        <br /><br />
        When you get bad results, try running the command "Clear vector store" and "Force re-index for QA" to completely rebuild the index. But beware of the cost if you are not using local embedding models and have a large vault!
      </p>
      <DropdownComponent
        name="Auto-index vault strategy"
        description="Decide when you want the vault to be indexed. Beware that using On Save will call the embedding API every time you save a file."
        value={indexVaultToVectorStore}
        onChange={setIndexVaultToVectorStore}
        options={VAULT_VECTOR_STORE_STRATEGIES}
      />
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
      <Collapsible title="Huggingface Inference API Settings">
        <ApiSetting
          title="Huggingface Inference API Key"
          value={huggingfaceApiKey}
          setValue={setHuggingfaceApiKey}
          placeholder="Enter Huggingface Inference API key"
        />
        <p>
          Get your Huggingface Inference API key{' '}
          <a
            href="https://hf.co/settings/tokens"
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
