import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

import { HelpTooltip } from "@/components/ui/help-tooltip";
import {
  ChatModelProviders,
  MODEL_CAPABILITIES,
  ModelCapability,
  Provider,
  ProviderMetadata,
  ProviderSettingsKeyMap,
  SettingKeyProviders,
} from "@/constants";
import { getSettings } from "@/settings/model";
import { debounce, getProviderInfo, getProviderLabel } from "@/utils";
import { App, Modal, Platform } from "obsidian";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { ModelParametersEditor } from "@/components/ui/ModelParametersEditor";

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
            description="Defaults to us-east-1 when left blank unless this model defines a custom base URL."
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

            {/* Model Parameters Editor */}
            <ModelParametersEditor
              model={localModel}
              settings={settings}
              onChange={handleLocalUpdate}
              onReset={handleLocalReset}
              showTokenLimit={true}
            />
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
