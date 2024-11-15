import { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders, VAULT_VECTOR_STORE_STRATEGIES } from "@/constants";
import { useSettingsContext } from "@/settings/contexts/SettingsContext";
import React from "react";
import {
  DropdownComponent,
  ModelSettingsComponent,
  SliderComponent,
  TextAreaComponent,
  ToggleComponent,
} from "./SettingBlocks";

interface QASettingsProps {
  huggingfaceApiKey: string;
  setHuggingfaceApiKey: (value: string) => void;
  indexVaultToVectorStore: string;
  setIndexVaultToVectorStore: (value: string) => void;
  maxSourceChunks: number;
  setMaxSourceChunks: (value: number) => void;
  disableIndexOnMobile: boolean;
  setDisableIndexOnMobile: (value: boolean) => void;
  ping: (customModel: CustomModel) => Promise<"PONG">;
}

const QASettings: React.FC<QASettingsProps> = ({
  indexVaultToVectorStore,
  setIndexVaultToVectorStore,
  maxSourceChunks,
  setMaxSourceChunks,
  disableIndexOnMobile,
  setDisableIndexOnMobile,
  ping,
}) => {
  const { settings, updateSettings } = useSettingsContext();

  const handleUpdateEmbeddingModels = (models: Array<CustomModel>) => {
    const updatedActiveEmbeddingModels = models.map((model) => ({
      ...model,
      baseUrl: model.baseUrl || "",
      apiKey: model.apiKey || "",
    }));
    updateSettings({ activeEmbeddingModels: updatedActiveEmbeddingModels });
  };

  const handleSetEmbeddingModelKey = (modelKey: string) => {
    updateSettings({ embeddingModelKey: modelKey });
  };

  return (
    <div>
      <br />
      <br />
      <h1>QA Settings</h1>
      <p>
        QA mode relies on a <em>local</em> vector index.
      </p>
      <h2>Local Embedding Model</h2>
      <p>
        Check the{" "}
        <a href="https://github.com/logancyang/obsidian-copilot/blob/master/local_copilot.md">
          local copilot
        </a>{" "}
        setup guide to setup Ollama's local embedding model (requires Ollama v0.1.26 or above).
      </p>
      <h2>Embedding Models</h2>
      <ModelSettingsComponent
        activeModels={settings.activeEmbeddingModels}
        onUpdateModels={handleUpdateEmbeddingModels}
        providers={Object.values(EmbeddingModelProviders)}
        onDeleteModel={(modelKey) => {
          const updatedActiveEmbeddingModels = settings.activeEmbeddingModels.filter(
            (model) => `${model.name}|${model.provider}` !== modelKey
          );
          updateSettings({ activeEmbeddingModels: updatedActiveEmbeddingModels });
        }}
        defaultModelKey={settings.embeddingModelKey}
        onSetDefaultModelKey={handleSetEmbeddingModelKey}
        isEmbeddingModel={true}
        ping={ping}
      />
      <h1>Auto-Index Strategy</h1>
      <div className="warning-message">
        If you are using a paid embedding provider, beware of costs for large vaults!
      </div>
      <p>
        When you switch to <strong>Vault QA</strong> mode, your vault is indexed{" "}
        <em>based on the auto-index strategy you select below</em>.
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
        <strong>NEVER</strong>: Notes are never indexed to the vector store unless users run the
        command <em>Index vault for QA</em> explicitly, or hit the <em>Refresh Index</em> button.
        <br />
        <br />
        <strong>ON STARTUP</strong>: Vault index is refreshed on plugin load/reload.
        <br />
        <br />
        <strong>ON MODE SWITCH (Recommended)</strong>: Vault index is refreshed when switching to
        Vault QA mode.
        <br />
        <br />
        By "refreshed", it means the vault index is not rebuilt from scratch but rather updated
        incrementally with new/modified notes since the last index. If you need a complete rebuild,
        run the commands "Clear vector store" and "Force re-index for QA" manually. This helps
        reduce costs when using paid embedding models.
        <br />
        <br />
        Beware of the cost if you are using a paid embedding model and have a large vault! You can
        run Copilot command <em>Count total tokens in your vault</em> and refer to your selected
        embedding model pricing to estimate indexing costs.
      </p>
      <br />
      <SliderComponent
        name="Max Sources"
        description="Copilot goes through your vault to find relevant blocks and passes the top N blocks to the LLM. Default for N is 3. Increase if you want more sources included in the answer generation step."
        min={1}
        max={10}
        step={1}
        value={maxSourceChunks}
        onChange={async (value) => {
          setMaxSourceChunks(value);
        }}
      />
      <SliderComponent
        name="Requests per second"
        description="Default is 10. Decrease if you are rate limited by your embedding provider."
        min={1}
        max={30}
        step={1}
        value={settings.embeddingRequestsPerSecond}
        onChange={(value) => updateSettings({ embeddingRequestsPerSecond: value })}
      />
      <TextAreaComponent
        name="Exclusions"
        description="Comma separated list of paths, tags, note titles or file extension, e.g. folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]], *.jpg, *.excallidraw.md etc, to be excluded from the indexing process. NOTE: Tags must be in the note properties, not the note content. Files which were previously indexed will remain in the index unless you force re-index."
        placeholder="folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]], *.jpg, *.excallidraw.md"
        value={settings.qaExclusions}
        onChange={(value) => updateSettings({ qaExclusions: value })}
      />
      <TextAreaComponent
        name="Inclusions"
        description="When specified, ONLY these paths, tags, or note titles will be indexed (comma separated). Takes precedence over exclusions. Files which were previously indexed will remain in the index unless you force re-index. Format: folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]]"
        placeholder="folder1, #tag1, [[note1]]"
        value={settings.qaInclusions}
        onChange={(value) => updateSettings({ qaInclusions: value })}
      />
      <ToggleComponent
        name="Disable index loading on mobile"
        description="When enabled, vector store index won't be loaded on mobile devices to save resources. Only chat mode will be available. Any existing index from desktop sync will be preserved. Uncheck to enable QA modes on mobile."
        value={disableIndexOnMobile}
        onChange={setDisableIndexOnMobile}
      />
    </div>
  );
};

export default QASettings;
