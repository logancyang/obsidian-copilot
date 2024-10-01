import { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders, VAULT_VECTOR_STORE_STRATEGIES } from "@/constants";
import { useSettingsContext } from "@/settings/contexts/SettingsContext";
import React from "react";
import {
  DropdownComponent,
  ModelSettingsComponent,
  SliderComponent,
  TextComponent,
} from "./SettingBlocks";

interface QASettingsProps {
  huggingfaceApiKey: string;
  setHuggingfaceApiKey: (value: string) => void;
  indexVaultToVectorStore: string;
  setIndexVaultToVectorStore: (value: string) => void;
  maxSourceChunks: number;
  setMaxSourceChunks: (value: number) => void;
}

const QASettings: React.FC<QASettingsProps> = ({
  indexVaultToVectorStore,
  setIndexVaultToVectorStore,
  maxSourceChunks,
  setMaxSourceChunks,
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
      <div className="warning-message">
        Vault QA is in BETA and may not be stable. If you have issues please report in the github
        repo.
      </div>
      <p>
        QA mode relies on a <em>local</em> vector index.
      </p>
      <h2>Long Note QA vs. Vault QA (BETA)</h2>
      <p>
        Long Note QA mode uses the Active Note as context. Vault QA (BETA) uses your entire vault as
        context. Please ask questions as specific as possible, avoid vague questions to get better
        results.
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
      />
      <h1>Auto-Index Strategy</h1>
      <div className="warning-message">
        If you are using a paid embedding provider, beware of costs for large vaults!
      </div>
      <p>
        When you switch to <strong>Long Note QA</strong> mode, your active note is indexed
        automatically upon mode switch.
        <br />
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
        description="Default is 3 (Recommended). Increase if you want more sources from your notes. A higher number can lead to irrelevant sources and lower quality responses, it also fills up the context window faster."
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
      <TextComponent
        name="Exclude Folders from Indexing"
        description="Comma separated list like folder1, folder1/folder2, etc, to be excluded from indexing process. NOTE: files which were previously indexed will remain in the index."
        placeholder="folder1, folder1/folder2"
        value={settings.qaExclusionPaths}
        onChange={(value) => updateSettings({ qaExclusionPaths: value })}
      />
    </div>
  );
};

export default QASettings;
