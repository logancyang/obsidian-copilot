import React, { useState } from "react";
import { CustomModel } from "@/aiParams";
import { validateModelConfig } from "@/settings/model";
import { Notice } from "obsidian";

interface ModelSettingsComponentProps {
  app: App;
  activeModels: Array<CustomModel>;
  onUpdateModels: (models: Array<CustomModel>) => void;
  providers: string[];
  onDeleteModel: (modelKey: string) => void;
  defaultModelKey: string;
  onSetDefaultModelKey: (modelKey: string) => void;
  isEmbeddingModel: boolean;
}

const ModelSettingsComponent: React.FC<ModelSettingsComponentProps> = ({
  app,
  activeModels,
  onUpdateModels,
  providers,
  onDeleteModel,
  defaultModelKey,
  onSetDefaultModelKey,
  isEmbeddingModel,
}) => {
  const emptyModel: CustomModel = {
    name: "",
    provider: providers.length > 0 ? providers[0] : "",
    baseUrl: "",
    apiKey: "",
    enabled: true,
    isBuiltIn: false,
    enableCors: false,
    isEmbeddingModel: isEmbeddingModel,
  };
  const [newModel, setNewModel] = useState(emptyModel);
  const [isAddModelOpen, setIsAddModelOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

  const handleAddModel = () => {
    try {
      validateModelConfig(newModel);
      const updatedModels = [...activeModels, { ...newModel, enabled: true }];
      onUpdateModels(updatedModels);
      setNewModel(emptyModel);
      setValidationErrors([]);
    } catch (error) {
      setValidationErrors((error as Error).message.split(","));
      new Notice(`Validation error: ${(error as Error).message}`);
    }
  };

  const handleSetDefaultModel = (model: CustomModel) => {
    const modelKey = getModelKey(model);
    onSetDefaultModelKey(modelKey);
  };

  const handleVerifyModel = async () => {
    if (!newModel.name || !newModel.provider) {
      new Notice("Please fill in necessary fields!");
      return;
    }

    setIsVerifying(true);
    try {
      if (isEmbeddingModel) {
        await EmbeddingManager.getInstance().ping(newModel);
      } else {
        await ChatModelManager.getInstance().ping(newModel);
      }
      new Notice("Model connection verified successfully!");
    } catch (error) {
      console.error("Model verification failed:", error);
      new Notice(`Model verification failed: ${error.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const getFieldClassName = (field: string) => {
    return validationErrors.includes(field) ? "invalid-field" : "";
  };

  return (
    <div>
      <div className="model-settings-container">
        {/* Desktop View */}
        <table className="model-settings-table desktop-only">
          <thead>
            <tr>
              <th>Default</th>
              <th>Model</th>
              <th>Provider</th>
              <th>Enabled</th>
              <th>CORS</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {activeModels.map((model, index) => (
              <tr key={getModelKey(model)}>
                <td>
                  <input
                    type="radio"
                    name={`selected-${isEmbeddingModel ? "embedding" : "chat"}-model`}
                    checked={getModelKey(model) === defaultModelKey}
                    onChange={() => handleSetDefaultModel(model)}
                  />
                </td>
                <td>{model.name}</td>
                <td>{model.provider}</td>
                <td>
                  <ToggleComponent
                    name={""}
                    value={model.enabled}
                    onChange={(value) => {
                      if (!model.isBuiltIn) {
                        const updatedModels = [...activeModels];
                        updatedModels[index].enabled = value;
                        onUpdateModels(updatedModels);
                      }
                    }}
                    disabled={model.isBuiltIn}
                  />
                </td>
                <td>
                  {!model.isBuiltIn && (
                    <ToggleComponent
                      name={""}
                      value={model.enableCors || false}
                      onChange={(value) => {
                        const updatedModels = [...activeModels];
                        updatedModels[index].enableCors = value;
                        onUpdateModels(updatedModels);
                      }}
                    />
                  )}
                </td>
                <td>
                  {getModelKey(model) !== defaultModelKey && (
                    <button onClick={() => onDeleteModel(getModelKey(model))}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile View */}
        <div className="model-cards-container mobile-only">
          {activeModels.map((model, index) => (
            <ModelCard
              key={getModelKey(model)}
              model={model}
              isDefault={getModelKey(model) === defaultModelKey}
              onSetDefault={() => handleSetDefaultModel(model)}
              onToggleEnabled={(value) => {
                if (!model.isBuiltIn) {
                  const updatedModels = [...activeModels];
                  updatedModels[index].enabled = value;
                  onUpdateModels(updatedModels);
                }
              }}
              onToggleCors={(value) => {
                const updatedModels = [...activeModels];
                updatedModels[index].enableCors = value;
                onUpdateModels(updatedModels);
              }}
              onDelete={() => onDeleteModel(getModelKey(model))}
              disabled={model.isBuiltIn}
            />
          ))}
        </div>
      </div>
      <div className="add-custom-model">
        <h2 onClick={() => setIsAddModelOpen(!isAddModelOpen)} style={{ cursor: "pointer" }}>
          Add Custom Model {isAddModelOpen ? "▼" : "▶"}
        </h2>
        {isAddModelOpen && (
          <div className="add-custom-model-form">
            <TextComponent
              name="Model Name"
              description={`The name of the model, i.e. ${isEmbeddingModel ? "text-embedding-3-small" : "gpt-4o-mini"}`}
              value={newModel.name}
              placeholder="Enter model name"
              onChange={(value) => {
                setNewModel({ ...newModel, name: value });
              }}
              className={getFieldClassName("name")}
            />
            <DropdownComponent
              name="Provider"
              options={providers}
              value={newModel.provider}
              onChange={(value) => {
                setNewModel({ ...newModel, provider: value });
              }}
              className={getFieldClassName("provider")}
            />
            <TextComponent
              name="Base URL (optional)"
              description="For 3rd party OpenAI Format endpoints only. Leave blank for other providers."
              value={newModel.baseUrl || ""}
              placeholder="https://api.example.com/v1"
              onChange={(value) => setNewModel({ ...newModel, baseUrl: value })}
              className={getFieldClassName("baseUrl")}
            />
            <TextComponent
              name="API Key (optional)"
              description="API key for the 3rd party provider"
              value={newModel.apiKey || ""}
              placeholder="Enter API key"
              type="password"
              onChange={(value) => setNewModel({ ...newModel, apiKey: value })}
              className={getFieldClassName("apiKey")}
            />
            <div style={{ marginTop: "20px" }}>
              <div
                style={{
                  marginBottom: "10px",
                  color: "var(--text-muted)",
                  fontSize: "0.9em",
                }}
              >
                Verify the connection before adding the model to ensure it's properly configured and
                accessible.
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={handleVerifyModel}
                  style={{
                    backgroundColor: "var(--interactive-accent)",
                    color: "var(--text-on-accent)",
                    padding: "8px 16px",
                    borderRadius: "4px",
                    cursor: isVerifying ? "not-allowed" : "pointer",
                    border: "none",
                    opacity: isVerifying ? 0.6 : 1,
                  }}
                  disabled={isVerifying}
                >
                  {isVerifying ? "Verifying..." : "Verify Connection"}
                </button>
                <button
                  onClick={handleAddModel}
                  style={{
                    backgroundColor: "var(--interactive-accent)",
                    color: "var(--text-on-accent)",
                    padding: "8px 16px",
                    borderRadius: "4px",
                    cursor: isVerifying ? "not-allowed" : "pointer",
                    opacity: isVerifying ? 0.6 : 1,
                  }}
                  disabled={isVerifying}
                >
                  Add Model
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelSettingsComponent;
