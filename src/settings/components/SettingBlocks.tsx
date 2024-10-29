import { CustomModel } from "@/models/aiParams";
import { Notice } from "obsidian";
import React, { useState } from "react";

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
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
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

interface ModelSettingsComponentProps {
  activeModels: Array<CustomModel>;
  onUpdateModels: (models: Array<CustomModel>) => void;
  providers: string[];
  onDeleteModel: (modelKey: string) => void;
  defaultModelKey: string;
  onSetDefaultModelKey: (modelKey: string) => void;
  isEmbeddingModel: boolean;
}

const ModelSettingsComponent: React.FC<ModelSettingsComponentProps> = ({
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

  const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

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
    onSetDefaultModelKey(getModelKey(model));
  };

  return (
    <div>
      <table className="model-settings-table">
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
                {!model.core && (
                  <button onClick={() => onDeleteModel(getModelKey(model))}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
            <button onClick={handleAddModel} className="add-model-button">
              Add Model
            </button>
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
