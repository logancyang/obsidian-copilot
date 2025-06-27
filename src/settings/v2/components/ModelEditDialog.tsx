import { CustomModel } from "@/aiParams";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SettingSlider } from "@/components/ui/setting-slider";
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

            <FormField
              label={
                <div className="tw-flex tw-items-center tw-gap-2">
                  Token limit
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="tw-size-4 tw-text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <div className="tw-w-[300px]">
                          <p>
                            The maximum number of <em>output tokens</em> to generate. Default is{" "}
                            {DEFAULT_MODEL_SETTING.MAX_TOKENS}.
                          </p>
                          <em>
                            This number plus the length of your prompt (input tokens) must be
                            smaller than the context window of the model.
                          </em>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={
                  localModel.maxTokens ?? settings.maxTokens ?? DEFAULT_MODEL_SETTING.MAX_TOKENS
                }
                onChange={(value) => handleLocalUpdate("maxTokens", value)}
                min={0}
                max={65000}
                step={100}
              />
            </FormField>

            <FormField
              label={
                <div className="tw-flex tw-items-center tw-gap-2">
                  Temperature
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="tw-size-4 tw-text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <div className="tw-max-w-[300px]">
                          Default is {DEFAULT_MODEL_SETTING.TEMPERATURE}. Higher values will result
                          in more creativeness, but also more mistakes. Set to 0 for no randomness.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={
                  localModel.temperature ??
                  settings.temperature ??
                  DEFAULT_MODEL_SETTING.TEMPERATURE
                }
                onChange={(value) => handleLocalUpdate("temperature", value)}
                max={2}
                min={0}
                step={0.05}
              />
            </FormField>

            <FormField
              label={
                <div className="tw-flex tw-items-center tw-gap-2">
                  Top-P
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="tw-size-4 tw-text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <div className="tw-w-[300px]">
                          Default value is 0.9, the smaller the value, the less variety in the
                          answers, the easier to understand, the larger the value, the larger the
                          range of the Al&#39;s vocabulary, the more diverse
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={localModel.topP ?? 0.9}
                onChange={(value) => handleLocalUpdate("topP", value)}
                max={1}
                min={0}
                step={0.05}
              />
            </FormField>

            <FormField
              label={
                <div className="tw-flex tw-items-center tw-gap-2">
                  Frequency Penalty
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="tw-size-4 tw-text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <div className="tw-w-[300px]">
                          <p>
                            The frequency penalty parameter tells the model not to repeat a word
                            that has already been used multiple times in the conversation.
                          </p>
                          <em>
                            The higher the value, the more the model is penalized for repeating
                            words.
                          </em>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={localModel.frequencyPenalty ?? 0}
                onChange={(value) => handleLocalUpdate("frequencyPenalty", value)}
                max={2}
                min={0}
                step={0.05}
              />
            </FormField>
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
