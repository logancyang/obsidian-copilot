import { CustomModel } from "@/aiParams";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DEFAULT_MODEL_SETTING,
  MODEL_CAPABILITIES,
  ModelCapability,
  Provider,
  ProviderMetadata,
  ProviderSettingsKeyMap,
  SettingKeyProviders,
} from "@/constants";
import { getSettings } from "@/settings/model";
import { debounce, getProviderInfo, getProviderLabel } from "@/utils";
import { HelpCircle } from "lucide-react";
import { App, Modal } from "obsidian";
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
  onCancel,
  isEmbeddingModel,
}) => {
  const [localModel, setLocalModel] = useState<CustomModel>(model);
  const [originalModel, setOriginalModel] = useState<CustomModel>(model);
  const [providerInfo, setProviderInfo] = useState<ProviderMetadata>({} as ProviderMetadata);
  const settings = getSettings();

  const getDefaultApiKey = (provider: Provider): string => {
    return (settings[ProviderSettingsKeyMap[provider as SettingKeyProviders]] as string) || "";
  };

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

  const displayApiKey = localModel.apiKey || getDefaultApiKey(localModel.provider as Provider);
  const showOtherParameters = !isEmbeddingModel && localModel.provider !== "copilot-plus-jina";

  return (
    <div className="tw-space-y-3 tw-p-4">
      <div className="tw-mb-4">
        <h2 className="tw-text-xl tw-font-bold">Model Settings - {localModel.name}</h2>
        <p className="tw-text-sm tw-text-muted">Customize model parameters</p>
      </div>

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
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="tw-size-4" />
                  </TooltipTrigger>
                  <TooltipContent align="start" className="tw-max-w-96" side="bottom">
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
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="tw-size-4" />
                      </TooltipTrigger>
                      <TooltipContent align="start" className="tw-max-w-96" side="bottom">
                        <div className="tw-text-sm tw-text-muted">
                          Only used to display model capabilities, does not affect model
                          functionality
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                    <Label htmlFor={id} className="tw-text-sm">
                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{label}</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{description}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                  </div>
                ))}
              </div>
            </FormField>

            <FormField>
              <ParameterControl
                optional={false}
                label="Token limit"
                value={localModel.maxTokens ?? settings.maxTokens}
                onChange={(value) => handleLocalUpdate("maxTokens", value)}
                max={65000}
                min={0}
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
                  <FormField
                    label={
                      <div className="tw-flex tw-items-center tw-gap-2">
                        Reasoning Effort
                        <TooltipProvider delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="tw-size-4 tw-text-muted" />
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <div className="tw-w-[300px]">
                                <p>
                                  Controls the amount of reasoning effort the model uses. Higher
                                  effort provides more thorough reasoning but takes longer. Note:
                                  thinking tokens are not available yet!
                                </p>
                                <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                                  <li>
                                    Minimal: Fastest responses, minimal reasoning (GPT-5 only)
                                  </li>
                                  <li>Low: Faster responses, basic reasoning (default)</li>
                                  <li>Medium: Balanced performance</li>
                                  <li>High: Thorough reasoning, slower responses</li>
                                </ul>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    }
                  >
                    <Select
                      value={localModel.reasoningEffort || settings.reasoningEffort || "low"}
                      onValueChange={(value) => handleLocalUpdate("reasoningEffort", value)}
                    >
                      <SelectTrigger className="tw-w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {localModel.name.startsWith("gpt-5") && (
                          <SelectItem value="minimal">Minimal</SelectItem>
                        )}
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>

                  {/* Verbosity only for GPT-5 models */}
                  {localModel.name.startsWith("gpt-5") && (
                    <FormField
                      label={
                        <div className="tw-flex tw-items-center tw-gap-2">
                          Verbosity
                          <TooltipProvider delayDuration={0}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="tw-size-4 tw-text-muted" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                <div className="tw-w-[300px]">
                                  <p>Controls the length and detail of the model responses.</p>
                                  <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                                    <li>Low: Concise, brief responses</li>
                                    <li>Medium: Balanced detail</li>
                                    <li>High: Detailed, comprehensive responses</li>
                                  </ul>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      }
                    >
                      <Select
                        value={localModel.verbosity || settings.verbosity || "medium"}
                        onValueChange={(value) => handleLocalUpdate("verbosity", value)}
                      >
                        <SelectTrigger className="tw-w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                </>
              )}
          </>
        )}
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
  }

  onOpen() {
    const { contentEl } = this;
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
