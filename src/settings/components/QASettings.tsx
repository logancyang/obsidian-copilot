import { EMBEDDING_PROVIDERS, OPENAI_EMBEDDING_MODELS } from '@/constants';
import React from 'react';
import ApiSetting from './ApiSetting';
import Collapsible from './Collapsible';
import { DropdownComponent, SliderComponent } from './SettingBlocks';

interface QASettingsProps {
  embeddingProvider: string;
  setEmbeddingProvider: (value: string) => void;
  embeddingModel: string;
  setEmbeddingModel: (value: string) => void;
  ttlDays: number;
  setTtlDays: (value: number) => void;
  cohereApiKey: string;
  setCohereApiKey: (value: string) => void;
  huggingfaceApiKey: string;
  setHuggingfaceApiKey: (value: string) => void;
}

const QASettings: React.FC<QASettingsProps> = ({
  embeddingProvider,
  setEmbeddingProvider,
  embeddingModel,
  setEmbeddingModel,
  ttlDays,
  setTtlDays,
  cohereApiKey,
  setCohereApiKey,
  huggingfaceApiKey,
  setHuggingfaceApiKey,
}) => {
  return (
    <div>
      <br/>
      <br/>
      <h1>QA Settings</h1>
      <div className="warning-message">
        YOU MUST REBUILD YOUR INDEX AFTER SWITCHING EMBEDDING PROVIDERS!
      </div>
      <p>QA mode relies a <em>local</em> vector index (experimental)
        <br />
        OpenAI embeddings currently has the best retrieval quality. CohereAI embeddings are free during trial and are decent. With Huggingface Inference API, your mileage may vary.
      </p>
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
      <SliderComponent
        name="TTL Days"
        description="The number of days to keep embeddings in the index"
        value={ttlDays}
        onChange={setTtlDays}
        min={1}
        max={365}
        step={1}
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