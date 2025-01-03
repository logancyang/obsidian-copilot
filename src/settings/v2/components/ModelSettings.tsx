import React, { useState } from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { CustomModel } from "@/aiParams";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { ModelAddDialog } from "@/settings/v2/components/ModelAddDialog";
import { ModelTable } from "@/settings/v2/components/ModelTable";
import { ModelEditDialog } from "@/settings/v2/components/ModelEditDialog";

interface ModelSettingsProps {
  indexVaultToVectorStore(overwrite?: boolean): Promise<number>;
}

const ModelSettings: React.FC<ModelSettingsProps> = ({ indexVaultToVectorStore }) => {
  const settings = useSettingsValue();
  const [editingModel, setEditingModel] = useState<CustomModel | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAddEmbeddingDialog, setShowAddEmbeddingDialog] = useState(false);

  const onDeleteModel = (modelKey: string) => {
    const [modelName, provider] = modelKey.split("|");
    const updatedActiveModels = settings.activeModels.filter(
      (model) => !(model.name === modelName && model.provider === provider)
    );

    let newDefaultModelKey = settings.defaultModelKey;
    if (modelKey === settings.defaultModelKey) {
      const newDefaultModel = updatedActiveModels.find((model) => model.enabled);
      newDefaultModelKey = newDefaultModel
        ? `${newDefaultModel.name}|${newDefaultModel.provider}`
        : "";
    }

    setSettings({
      activeModels: updatedActiveModels,
      defaultModelKey: newDefaultModelKey,
    });
  };

  const handleModelUpdate = (updatedModel: CustomModel) => {
    const updatedModels = settings.activeModels.map((m) =>
      m.name === updatedModel.name && m.provider === updatedModel.provider ? updatedModel : m
    );
    updateSetting("activeModels", updatedModels);
  };

  const onDeleteEmbeddingModel = (modelKey: string) => {
    const [modelName, provider] = modelKey.split("|");
    const updatedModels = settings.activeEmbeddingModels.filter(
      (model) => !(model.name === modelName && model.provider === provider)
    );
    updateSetting("activeEmbeddingModels", updatedModels);
  };

  const handleEmbeddingModelUpdate = (updatedModel: CustomModel) => {
    const updatedModels = settings.activeEmbeddingModels.map((m) =>
      m.name === updatedModel.name && m.provider === updatedModel.provider ? updatedModel : m
    );
    updateSetting("activeEmbeddingModels", updatedModels);
  };

  const handlePartitionsChange = (value: string) => {
    const numValue = parseInt(value);
    if (numValue !== settings.numPartitions) {
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("numPartitions", numValue);
        await indexVaultToVectorStore(true);
      }).open();
    }
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="text-2xl font-bold mb-3">Chat Models</div>
        <ModelTable
          models={settings.activeModels}
          onEdit={setEditingModel}
          onDelete={onDeleteModel}
          onAdd={() => setShowAddDialog(true)}
          onUpdateModel={handleModelUpdate}
          title="Chat Model"
        />

        {/* model edit dialog*/}
        <ModelEditDialog
          open={!!editingModel}
          onOpenChange={(open) => !open && setEditingModel(null)}
          model={editingModel}
          onUpdate={handleModelUpdate}
        />

        {/* model add dialog */}
        <ModelAddDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onAdd={(model) => {
            const updatedModels = [...settings.activeModels, model];
            updateSetting("activeModels", updatedModels);
          }}
          ping={(model) => ChatModelManager.getInstance().ping(model)}
        />

        <div className="space-y-4">
          <SettingItem
            type="textarea"
            title="User System Prompt"
            description="Set your default system prompt"
            value={settings.userSystemPrompt}
            onChange={(value) => updateSetting("userSystemPrompt", value)}
            placeholder="Enter your system prompt here..."
          />

          <SettingItem
            type="slider"
            title="Temperature"
            description="Default is 0.1. Higher values will result in more creativeness, but also more mistakes. Set to 0 for no randomness."
            value={settings.temperature}
            onChange={(value) => updateSetting("temperature", value)}
            min={0}
            max={2}
            step={0.05}
          />

          <SettingItem
            type="slider"
            title="Token limit"
            description={
              <>
                <p>
                  The maximum number of <em>output tokens</em> to generate. Default is 1000.
                </p>
                <em>
                  This number plus the length of your prompt (input tokens) must be smaller than the
                  context window of the model.
                </em>
              </>
            }
            value={settings.maxTokens}
            onChange={(value) => updateSetting("maxTokens", value)}
            min={0}
            max={16000}
            step={100}
          />

          <SettingItem
            type="slider"
            title="Conversation turns in context"
            description="The number of previous conversation turns to include in the context. Default is 15 turns, i.e. 30 messages."
            value={settings.contextTurns}
            onChange={(value) => updateSetting("contextTurns", value)}
            min={1}
            max={50}
            step={1}
          />
        </div>
      </section>

      <section>
        <div className="text-2xl font-bold mb-3">Embedding Models</div>
        <ModelTable
          models={settings.activeEmbeddingModels}
          onDelete={onDeleteEmbeddingModel}
          onAdd={() => setShowAddEmbeddingDialog(true)}
          onUpdateModel={handleEmbeddingModelUpdate}
          title="Embedding Model"
        />

        {/* Embedding model add dialog */}
        <ModelAddDialog
          open={showAddEmbeddingDialog}
          onOpenChange={setShowAddEmbeddingDialog}
          onAdd={(model) => {
            const updatedModels = [...settings.activeEmbeddingModels, model];
            updateSetting("activeEmbeddingModels", updatedModels);
          }}
          isEmbeddingModel={true}
          ping={(model) => EmbeddingManager.getInstance().ping(model)}
        />

        <div className="space-y-4">
          <SettingItem
            type="slider"
            title="Max Sources"
            description="Copilot goes through your vault to find relevant blocks and passes the top N blocks to the LLM. Default for N is 3. Increase if you want more sources included in the answer generation step."
            min={1}
            max={10}
            step={1}
            value={settings.maxSourceChunks}
            onChange={(value) => updateSetting("maxSourceChunks", value)}
          />

          <SettingItem
            type="slider"
            title="Requests per second"
            description="Default is 10. Decrease if you are rate limited by your embedding provider."
            min={1}
            max={30}
            step={1}
            value={settings.embeddingRequestsPerSecond}
            onChange={(value) => updateSetting("embeddingRequestsPerSecond", value)}
          />

          <SettingItem
            type="select"
            title="Number of Partitions"
            description="Number of partitions for Copilot index. Default is 1. Increase if you have issues indexing large vaults. Warning: Changes require clearing and rebuilding the index!"
            value={settings.numPartitions.toString()}
            options={["1", "2", "3", "4", "5", "6", "7", "8"].map((it) => ({
              label: it,
              value: it,
            }))}
            onChange={handlePartitionsChange}
          />

          <SettingItem
            type="textarea"
            title="Exclusions"
            description="Comma separated list of paths, tags, note titles or file extension, e.g. folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]], *.jpg, *.excallidraw.md etc, to be excluded from the indexing process. NOTE: Tags must be in the note properties, not the note content. Files which were previously indexed will remain in the index unless you force re-index."
            value={settings.qaExclusions}
            onChange={(value) => updateSetting("qaExclusions", value)}
            placeholder="folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]], *.jpg, *.excallidraw.md"
          />

          <SettingItem
            type="textarea"
            title="Inclusions"
            description="When specified, ONLY these paths, tags, or note titles will be indexed (comma separated). Takes precedence over exclusions. Files which were previously indexed will remain in the index unless you force re-index. Format: folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]]"
            value={settings.qaInclusions}
            onChange={(value) => updateSetting("qaInclusions", value)}
            placeholder="folder1, #tag1, [[note1]]"
          />

          <SettingItem
            type="switch"
            title="Enable Obsidian Sync for Copilot index"
            description="If enabled, the index will be stored in the .obsidian folder and synced with Obsidian Sync by default. If disabled, it will be stored in .copilot-index folder at vault root."
            checked={settings.enableIndexSync}
            onCheckedChange={(checked) => updateSetting("enableIndexSync", checked)}
          />

          <SettingItem
            type="switch"
            title="Disable index loading on mobile"
            description="When enabled, Copilot index won't be loaded on mobile devices to save resources. Only chat mode will be available. Any existing index from desktop sync will be preserved. Uncheck to enable QA modes on mobile."
            checked={settings.disableIndexOnMobile}
            onCheckedChange={(checked) => updateSetting("disableIndexOnMobile", checked)}
          />
        </div>
      </section>
    </div>
  );
};

export default ModelSettings;
