import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

import { HelpTooltip } from "@/components/ui/help-tooltip";
import {
  DEFAULT_MODEL_SETTING,
  ChatModelProviders,
  MODEL_CAPABILITIES,
  ModelCapability,
  ProviderMetadata,
  SettingKeyProviders,
} from "@/constants";
import { getSettings } from "@/settings/model";
import { debounce, getProviderInfo, getProviderLabel } from "@/utils";
import { getApiKeyForProvider } from "@/utils/modelUtils";
import { App, Modal, Platform } from "obsidian";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { ParameterControl } from "@/components/ui/parameter-controls";

interface ModelEditModalContentProps {
  model: CustomModel;
  isEmbeddingModel: boolean;
  onUpdate: (
    isEmbeddingModel: boolean,
    originalModel: CustomModel,
    updatedModel: CustomModel
  ) => void;
  onCancel: () => void;
}

export const ModelEditModalContent: React.FC<ModelEditModalContentProps> = ({
  model,
  onUpdate,
  isEmbeddingModel,
  onCancel,
}) => {
  const [localModel, setLocalModel] = useState<CustomModel>(model);
  const [originalModel, setOriginalModel] = useState<CustomModel>(model);
  const [providerInfo, setProviderInfo] = useState<ProviderMetadata>({} as ProviderMetadata);
  const settings = getSettings();
  const isBedrockProvider = localModel.provider === ChatModelProviders.AMAZON_BEDROCK;

  useEffect(() => {
    setLocalModel(model);
    setOriginalModel(model);
    if (model.provider) {
      setProviderInfo(getProviderInfo(model.provider));
    }
  }, [model]);

  // Debounce the onUpdate callback
  const debouncedOnUpdate = useMemo(
    () =>
      debounce((currentOriginalModel: CustomModel, updatedModel: CustomModel) => {
        onUpdate(isEmbeddingModel, currentOriginalModel, updatedModel);
      }, 500),
    [isEmbeddingModel, onUpdate]
  );

  // Function to update local state immediately
  const handleLocalUpdate = useCallback(
    (field: keyof CustomModel, value: any) => {
      setLocalModel((prevModel) => {
        const updatedModel = {
          ...prevModel,
          [field]: value,
        };
        // Call the debounced update function, passing the stable originalModel and the new updatedModel
        debouncedOnUpdate(originalModel, updatedModel);
        return updatedModel; // Return the updated model for immediate state update
      });
    },
    [originalModel, debouncedOnUpdate]
  );

  const handleLocalReset = useCallback(
    (field: keyof CustomModel) => {
      setLocalModel((prevModel) => {
        const updatedModel = { ...prevModel };
        delete updatedModel[field];
        // Call the debounced update function, passing the stable originalModel and the new updatedModel
        debouncedOnUpdate(originalModel, updatedModel);
        return updatedModel; // Return the updated model for immediate state update
      });
    },
    [debouncedOnUpdate, originalModel]
  );

  if (!localModel) return null;

  const getPlaceholderUrl = () => {
    if (!localModel || !localModel.provider || localModel.provider !== "azure-openai") {
      return providerInfo.host || "https://api.example.com/v1";
    }

    const instanceName = localModel.azureOpenAIApiInstanceName || "[instance]";
    const deploymentName = localModel.isEmbeddingModel
      ? localModel.azureOpenAIApiEmbeddingDeploymentName || "[deployment]"
      : localModel.azureOpenAIApiDeploymentName || "[deployment]";
    const apiVersion = localModel.azureOpenAIApiVersion || "[api-version]";
    const endpoint = localModel.isEmbeddingModel ? "embeddings" : "chat/completions";

    return `https://${instanceName}.openai.azure.com/openai/deployments/${deploymentName}/${endpoint}?api-version=${apiVersion}`;
  };

  const capabilityOptions = Object.entries(MODEL_CAPABILITIES).map(([id, description]) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    description,
  })) as Array<{ id: ModelCapability; label: string; description: string }>;

  const displayApiKey = getApiKeyForProvider(
    localModel.provider as SettingKeyProviders,
    localModel
  );
  const showOtherParameters = !isEmbeddingModel && localModel.provider !== "copilot-plus-jina";

  return (
    <div className="tw-space-y-3 tw-p-4">
      <div className="tw-space-y-3">
        <FormField label="Model Name" required>
          <Input
            type="text"
            disabled={localModel.core}
            value={localModel.name}
            onChange={(e) => handleLocalUpdate("name", e.target.value)}
            placeholder="Enter model name"
          />
        </FormField>

        <FormField
          label={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">Display Name</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-flex-col tw-gap-0.5 tw-text-sm tw-text-muted">
                    <div className="tw-text-[12px] tw-font-bold">Suggested format:</div>
                    <div className="tw-text-accent">[Source]-[Payment]:[Pretty Model Name]</div>
                    <div className="tw-text-[12px]">
                      Example:
                      <li>Direct-Paid:Ds-r1</li>
                      <li>OpenRouter-Paid:Ds-r1</li>
                      <li>Perplexity-Paid:lg</li>
                    </div>
                  </div>
                }
                contentClassName="tw-max-w-96"
              />
            </div>
          }
        >
          <Input
            type="text"
            placeholder="Custom display name (optional)"
            value={localModel.displayName || ""}
            onChange={(e) => handleLocalUpdate("displayName", e.target.value)}
          />
        </FormField>

        <FormField label="Provider">
          <Input type="text" value={getProviderLabel(localModel.provider)} disabled />
        </FormField>

        <FormField label="Base URL" description="Leave it blank, unless you are using a proxy.">
          <Input
            type="text"
            placeholder={getPlaceholderUrl()}
            value={localModel.baseUrl || ""}
            onChange={(e) => handleLocalUpdate("baseUrl", e.target.value)}
          />
        </FormField>

        {isBedrockProvider && (
          <FormField
            label="Region (optional)"
            description="Defaults to us-east-1 when left blank. With inference profiles (global., us., eu., apac.), region is auto-managed."
          >
            <Input
              type="text"
              placeholder="Enter AWS region (e.g. us-east-1)"
              value={localModel.bedrockRegion || ""}
              onChange={(e) => handleLocalUpdate("bedrockRegion", e.target.value)}
            />
          </FormField>
        )}

        <FormField label="API Key">
          <PasswordInput
            placeholder={`Enter ${providerInfo.label || "Provider"} API Key`}
            value={displayApiKey}
            onChange={(value) => handleLocalUpdate("apiKey", value)}
          />
          {providerInfo.keyManagementURL && (
            <p className="tw-text-xs tw-text-muted">
              <a href={providerInfo.keyManagementURL} target="_blank" rel="noopener noreferrer">
                Get {providerInfo.label} API Key
              </a>
            </p>
          )}
        </FormField>

        {showOtherParameters && (
          <>
            <FormField
              label={
                <div className="tw-flex tw-items-center tw-gap-1.5">
                  <span className="tw-leading-none">Model Capabilities</span>
                  <HelpTooltip
                    content={
                      <div className="tw-text-sm tw-text-muted">
                        Only used to display model capabilities, does not affect model functionality
                      </div>
                    }
                    contentClassName="tw-max-w-96"
                  />
                </div>
              }
            >
              <div className="tw-flex tw-items-center tw-gap-4">
                {capabilityOptions.map(({ id, label, description }) => (
                  <div key={id} className="tw-flex tw-items-center tw-gap-2">
                    <Checkbox
                      id={id}
                      checked={localModel.capabilities?.includes(id)}
                      onCheckedChange={(checked) => {
                        const newCapabilities = localModel.capabilities || [];
                        const value = checked
                          ? [...newCapabilities, id]
                          : newCapabilities.filter((cap) => cap !== id);
                        handleLocalUpdate("capabilities", value);
                      }}
                    />
                    <HelpTooltip content={description}>
                      <Label htmlFor={id} className="tw-text-sm">
                        {label}
                      </Label>
                    </HelpTooltip>
                  </div>
                ))}
              </div>
            </FormField>

            <FormField>
              <ParameterControl
                type={"slider"}
                optional={false}
                label="Token limit"
                value={localModel.maxTokens ?? settings.maxTokens}
                onChange={(value) => handleLocalUpdate("maxTokens", value)}
                max={65000}
                min={100}
                step={100}
                defaultValue={DEFAULT_MODEL_SETTING.MAX_TOKENS}
                helpText={
                  <>
                    <p>
                      The maximum number of <em>output tokens</em> to generate. Default is{" "}
                      {DEFAULT_MODEL_SETTING.MAX_TOKENS}.
                    </p>
                    <em>
                      This number plus the length of your prompt (input tokens) must be smaller than
                      the context window of the model.
                    </em>
                  </>
                }
              />
            </FormField>

            <FormField>
              <ParameterControl
                type={"slider"}
                optional={false}
                label="Temperature"
                value={localModel.temperature ?? settings.temperature}
                onChange={(value) => handleLocalUpdate("temperature", value)}
                max={2}
                min={0}
                step={0.05}
                defaultValue={DEFAULT_MODEL_SETTING.TEMPERATURE}
                helpText={`Default is ${DEFAULT_MODEL_SETTING.TEMPERATURE}. Higher values will result in more creativeness, but also more mistakes. Set to 0 for no randomness.`}
              />
            </FormField>

            <FormField>
              <ParameterControl
                type={"slider"}
                label="Top-P"
                value={localModel.topP}
                onChange={(value) => handleLocalUpdate("topP", value)}
                disableFn={() => handleLocalReset("topP")}
                max={1}
                min={0}
                step={0.05}
                defaultValue={0.9}
                helpText="Default value is 0.9, the smaller the value, the less variety in the answers, the easier to understand, the larger the value, the larger the range of the AI's vocabulary, the more diverse"
              />
            </FormField>

            <FormField>
              <ParameterControl
                type={"slider"}
                label="Frequency Penalty"
                value={localModel.frequencyPenalty}
                onChange={(value) => handleLocalUpdate("frequencyPenalty", value)}
                disableFn={() => handleLocalReset("frequencyPenalty")}
                max={2}
                min={0}
                step={0.05}
                defaultValue={0}
                helpText={
                  <>
                    <p>
                      The frequency penalty parameter tells the model not to repeat a word that has
                      already been used multiple times in the conversation.
                    </p>
                    <em>
                      The higher the value, the more the model is penalized for repeating words.
                    </em>
                  </>
                }
              />
            </FormField>

            {/* Reasoning Effort and Verbosity for GPT-5 and O-series models */}
            {localModel.provider === "openai" &&
              (localModel.name.startsWith("gpt-5") ||
                localModel.name.startsWith("o1") ||
                localModel.name.startsWith("o3") ||
                localModel.name.startsWith("o4")) && (
                <>
                  <FormField>
                    <ParameterControl
                      type="select"
                      label="Reasoning Effort"
                      value={localModel.reasoningEffort}
                      onChange={(value) => handleLocalUpdate("reasoningEffort", value)}
                      disableFn={() => handleLocalReset("reasoningEffort")}
                      defaultValue={
                        settings.reasoningEffort ?? DEFAULT_MODEL_SETTING.REASONING_EFFORT
                      }
                      options={[
                        ...(localModel.name.startsWith("gpt-5")
                          ? [{ value: "minimal", label: "Minimal" }]
                          : []),
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" },
                      ]}
                      helpText={
                        <>
                          <p>
                            Controls the amount of reasoning effort the model uses. Higher effort
                            provides more thorough reasoning but takes longer. Note: thinking tokens
                            are not available yet!
                          </p>
                          <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                            <li>Minimal: Fastest responses, minimal reasoning (GPT-5 only)</li>
                            <li>Low: Faster responses, basic reasoning (default)</li>
                            <li>Medium: Balanced performance</li>
                            <li>High: Thorough reasoning, slower responses</li>
                          </ul>
                        </>
                      }
                    />
                  </FormField>

                  {/* Verbosity only for GPT-5 models */}
                  {localModel.name.startsWith("gpt-5") && (
                    <FormField>
                      <ParameterControl
                        type="select"
                        label="Verbosity"
                        value={localModel.verbosity}
                        onChange={(value) => handleLocalUpdate("verbosity", value)}
                        disableFn={() => handleLocalReset("verbosity")}
                        defaultValue={settings.verbosity ?? DEFAULT_MODEL_SETTING.VERBOSITY}
                        options={[
                          { value: "low", label: "Low" },
                          { value: "medium", label: "Medium" },
                          { value: "high", label: "High" },
                        ]}
                        helpText={
                          <>
                            <p>Controls the length and detail of the model responses.</p>
                            <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                              <li>Low: Concise, brief responses</li>
                              <li>Medium: Balanced detail</li>
                              <li>High: Detailed, comprehensive responses</li>
                            </ul>
                          </>
                        }
                      />
                    </FormField>
                  )}
                </>
              )}

            {/* Reasoning Effort for OpenRouter models */}
            {localModel.provider === "openrouterai" && (
              <FormField>
                <ParameterControl
                  type="select"
                  label="Reasoning Effort"
                  value={localModel.reasoningEffort}
                  onChange={(value) => handleLocalUpdate("reasoningEffort", value)}
                  disableFn={() => handleLocalReset("reasoningEffort")}
                  defaultValue="low"
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                  helpText={
                    <>
                      <p>
                        Controls the amount of reasoning effort the model uses. Higher effort
                        provides more thorough reasoning but takes longer.
                      </p>
                      <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                        <li>Low: Faster responses, basic reasoning (default)</li>
                        <li>Medium: Balanced performance</li>
                        <li>High: Thorough reasoning, slower responses</li>
                      </ul>
                      {!localModel.capabilities?.includes(ModelCapability.REASONING) && (
                        <p className="tw-mt-2 tw-text-warning">
                          Enable the &quot;Reasoning&quot; capability above to use this feature.
                        </p>
                      )}
                    </>
                  }
                />
              </FormField>
            )}
          </>
        )}
      </div>

      <div className="tw-mt-6 tw-flex tw-justify-end tw-gap-2 tw-border-t tw-border-border tw-pt-4">
        <Button variant="secondary" onClick={onCancel}>
          Close
        </Button>
      </div>
    </div>
  );
};

export class ModelEditModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private model: CustomModel,
    private isEmbeddingModel: boolean,
    private onUpdate: (
      isEmbeddingModel: boolean,
      originalModel: CustomModel,
      updatedModel: CustomModel
    ) => void
  ) {
    super(app);
    // @ts-ignore
    this.setTitle(`Model Settings - ${this.model.name}`);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    // It occupies only 80% of the height, leaving a clickable blank area to prevent the close icon from malfunctioning.
    if (Platform.isMobile) {
      modalEl.style.height = "80%";
    }
    this.root = createRoot(contentEl);

    const handleUpdate = (
      isEmbeddingModel: boolean,
      originalModel: CustomModel,
      updatedModel: CustomModel
    ) => {
      this.onUpdate(isEmbeddingModel, originalModel, updatedModel);
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <ModelEditModalContent
        model={this.model}
        isEmbeddingModel={this.isEmbeddingModel}
        onUpdate={handleUpdate}
        onCancel={handleCancel}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
