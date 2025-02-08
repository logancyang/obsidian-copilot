import React, { useState } from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { CustomModel } from "@/aiParams";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { ModelAddDialog } from "@/settings/v2/components/ModelAddDialog";
import { ModelTable } from "@/settings/v2/components/ModelTable";
import { ModelEditDialog } from "@/settings/v2/components/ModelEditDialog";

const ModelSettings: React.FC = () => {
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

  const handleModelReorder = (newModels: CustomModel[]) => {
    updateSetting("activeModels", newModels);
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

  const handleEmbeddingModelReorder = (newModels: CustomModel[]) => {
    updateSetting("activeEmbeddingModels", newModels);
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="text-xl font-bold mb-3">Chat Models</div>
        <ModelTable
          models={settings.activeModels}
          onEdit={setEditingModel}
          onDelete={onDeleteModel}
          onAdd={() => setShowAddDialog(true)}
          onUpdateModel={handleModelUpdate}
          onReorderModels={handleModelReorder}
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
        <div className="text-xl font-bold mb-3">Embedding Models</div>
        <ModelTable
          models={settings.activeEmbeddingModels}
          onDelete={onDeleteEmbeddingModel}
          onAdd={() => setShowAddEmbeddingDialog(true)}
          onUpdateModel={handleEmbeddingModelUpdate}
          onReorderModels={handleEmbeddingModelReorder}
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
      </section>
    </div>
  );
};

export default ModelSettings;
