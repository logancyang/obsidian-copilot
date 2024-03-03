import { EMBEDDING_PROVIDERS, OPENAI_EMBEDDING_MODELS, VAULT_VECTOR_STORE_STRATEGIES } from '@/constants';
import React from 'react';
import ApiSetting from './ApiSetting';
import Collapsible from './Collapsible';
import { DropdownComponent } from './SettingBlocks';

interface QASettingsProps {
  embeddingProvider: string;
  setEmbeddingProvider: (value: string) => void;
  embeddingModel: string;
  setEmbeddingModel: (value: string) => void;
  cohereApiKey: string;
  setCohereApiKey: (value: string) => void;
  huggingfaceApiKey: string;
  setHuggingfaceApiKey: (value: string) => void;
  indexVaultToVectorStore: string;
  setIndexVaultToVectorStore: (value: string) => void;
}

const QASettings: React.FC<QASettingsProps> = ({
  embeddingProvider,
  setEmbeddingProvider,
  embeddingModel,
  setEmbeddingModel,
  cohereApiKey,
  setCohereApiKey,
  huggingfaceApiKey,
  setHuggingfaceApiKey,
  indexVaultToVectorStore,
  setIndexVaultToVectorStore,
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
        name="Embedding Provider"
        description="The embedding API to call"
        value={embeddingProvider}
        onChange={setEmbeddingProvider}
        options={EMBEDDING_PROVIDERS}
      />
      <DropdownComponent
        name="OpenAI Embedding Model"
        description="(for when embedding provider is OpenAI)"
        value={embeddingModel}
        onChange={setEmbeddingModel}
        options={OPENAI_EMBEDDING_MODELS}
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
        <strong>ON STARTUP</strong>: Notes are indexed (refreshed) to the vector store on app load.
        <br /><br />
        <strong>ON STARTUP AND SAVE</strong>: Same as above but it also triggers indexing whenever the user saves a note.
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
