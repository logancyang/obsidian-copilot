import { CustomModel } from "@/aiParams";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { App, Notice } from "obsidian";
import React, { useEffect, useState } from "react";
import { getModelKeyFromModel } from "@/settings/model";

type DropdownComponentProps = {
  name: string;
  description?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
};

type TextComponentProps = {
  name: string;
  description?: string;
  placeholder: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
};

type TextAreaComponentProps = {
  name: string;
  description?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

type SliderComponentProps = {
  name: string;
  description?: React.ReactNode; // This allows for JSX elements, strings, etc.
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

type ToggleComponentProps = {
  name: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
};

const DropdownComponent: React.FC<DropdownComponentProps> = ({
  name,
  description,
  options,
  value,
  onChange,
}) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="copilot-setting-item-control"
      >
        {options.map((option, index) => (
          <option key={index} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};

const TextComponent: React.FC<TextComponentProps> = ({
  name,
  description,
  placeholder,
  value,
  type,
  onChange,
}) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <input
        type={type || "text"}
        className="copilot-setting-item-control"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

const TextAreaComponent: React.FC<TextAreaComponentProps> = ({
  name,
  description,
  placeholder,
  value,
  onChange,
  rows = 3,
}) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <textarea
        className="copilot-setting-item-control"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
      />
    </div>
  );
};

const SliderComponent: React.FC<SliderComponentProps> = ({
  name,
  description,
  min,
  max,
  step,
  value,
  onChange,
}) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <input
          type="range"
          className="copilot-setting-item-control"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span
          style={{ marginLeft: "20px", fontWeight: "bold", color: "var(--inline-title-color)" }}
        >
          {value}
        </span>
      </div>
    </div>
  );
};

const ToggleComponent: React.FC<ToggleComponentProps> = ({
  name,
  description,
  value,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="copilot-setting-item">
      {name && <div className="copilot-setting-item-name">{name}</div>}
      {description && <div className="copilot-setting-item-description">{description}</div>}
      <label className={`switch ${disabled ? "disabled" : ""}`}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="slider round"></span>
      </label>
    </div>
  );
};

const ModelCard: React.FC<{
  model: CustomModel;
  isDefault: boolean;
  onSetDefault: () => void;
  onToggleEnabled: (value: boolean) => void;
  onToggleCors: (value: boolean) => void;
  onDelete?: () => void;
  disabled?: boolean;
}> = ({ model, isDefault, onSetDefault, onToggleEnabled, onToggleCors, onDelete, disabled }) => {
  const [isExpanded, setIsExpanded] = useState(isDefault);

  useEffect(() => {
    setIsExpanded(isDefault);
  }, [isDefault]);

  return (
    <div className={`model-card ${isExpanded ? "expanded" : ""} ${isDefault ? "selected" : ""}`}>
      {!isDefault && onDelete && (
        <button
          className="model-delete-icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete model"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M10 11v6M14 11v6M5 6v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6H5z" />
          </svg>
        </button>
      )}

      <div
        className="model-card-header"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
          onSetDefault();
        }}
      >
        <div className="model-card-header-content">
          <div>
            <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
          </div>
          <div className="model-provider-wrapper">
            <h3 className="model-card-title">{model.name}</h3>
            <span className="model-provider">{model.provider}</span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="model-card-content">
          <div className="model-card-controls">
            <div className="model-card-item">
              <span>Enabled</span>
              <ToggleComponent
                name=""
                value={model.enabled}
                onChange={onToggleEnabled}
                disabled={disabled}
              />
            </div>

            {!model.isBuiltIn && (
              <div className="model-card-item">
                <span>CORS</span>
                <ToggleComponent
                  name=""
                  value={model.enableCors || false}
                  onChange={onToggleCors}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

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
    modelName: "",
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

  const getModelKey = getModelKeyFromModel;

  const handleAddModel = () => {
    if (newModel.name && newModel.provider) {
      const updatedModels = [...activeModels, { ...newModel, enabled: true }];
      onUpdateModels(updatedModels);
      setNewModel(emptyModel);
    } else {
      new Notice("Please fill in necessary fields!");
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
            />
            <DropdownComponent
              name="Provider"
              options={providers}
              value={newModel.provider}
              onChange={(value) => {
                setNewModel({ ...newModel, provider: value });
              }}
            />
            <TextComponent
              name="Base URL (optional)"
              description="For 3rd party OpenAI Format endpoints only. Leave blank for other providers."
              value={newModel.baseUrl || ""}
              placeholder="https://api.example.com/v1"
              onChange={(value) => setNewModel({ ...newModel, baseUrl: value })}
            />
            <TextComponent
              name="API Key (optional)"
              description="API key for the 3rd party provider"
              value={newModel.apiKey || ""}
              placeholder="Enter API key"
              type="password"
              onChange={(value) => setNewModel({ ...newModel, apiKey: value })}
            />
            <div style={{ marginTop: "20px" }}>
              <div
                style={{
                  marginBottom: "10px",
                  color: "var(--text-muted)",
                  fontSize: "0.9em",
                }}
              >
                Verify the connection before adding the model to ensure it&apos;s properly
                configured and accessible.
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

export {
  DropdownComponent,
  ModelSettingsComponent,
  SliderComponent,
  TextAreaComponent,
  TextComponent,
  ToggleComponent,
};
