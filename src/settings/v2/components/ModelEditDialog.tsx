import { CustomModel } from "@/aiParams";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MODEL_CAPABILITIES,
  ModelCapability,
  Provider,
  ProviderMetadata,
  ProviderSettingsKeyMap,
  SettingKeyProviders,
} from "@/constants";
import { useTab } from "@/contexts/TabContext";
import { getSettings } from "@/settings/model";
import { debounce, getProviderInfo, getProviderLabel } from "@/utils";
import { HelpCircle } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

interface ModelEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: CustomModel | null;
  onUpdate: (originalModel: CustomModel, updatedModel: CustomModel) => void;
}

export const ModelEditDialog: React.FC<ModelEditDialogProps> = ({
  open,
  onOpenChange,
  model,
  onUpdate,
}) => {
  const { modalContainer } = useTab();
  const [localModel, setLocalModel] = useState<CustomModel | null>(model);
  const [originalModel, setOriginalModel] = useState<CustomModel | null>(model);
  const [providerInfo, setProviderInfo] = useState<ProviderMetadata>({} as ProviderMetadata);
  const settings = getSettings();

  const getDefaultApiKey = (provider: Provider): string => {
    return (settings[ProviderSettingsKeyMap[provider as SettingKeyProviders]] as string) || "";
  };

  useEffect(() => {
    setLocalModel(model);
    setOriginalModel(model);
    if (model?.provider) {
      setProviderInfo(getProviderInfo(model.provider));
    }
  }, [model]);

  // Debounce the onUpdate callback
  const debouncedOnUpdate = useMemo(
    () =>
      debounce((currentOriginalModel: CustomModel | null, updatedModel: CustomModel) => {
        if (currentOriginalModel) {
          onUpdate(currentOriginalModel, updatedModel);
        }
      }, 500),
    [onUpdate]
  );

  // Function to update local state immediately
  const handleLocalUpdate = useCallback(
    (field: keyof CustomModel, value: any) => {
      setLocalModel((prevModel) => {
        if (!prevModel) return null;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:tw-max-w-[425px]" container={modalContainer}>
        <DialogHeader>
          <DialogTitle>Model Settings - {localModel.name}</DialogTitle>
          <DialogDescription>Customize model parameters.</DialogDescription>
        </DialogHeader>

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
                        Only used to display model capabilities, does not affect model functionality
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

          {/*<FormField
              label={
                <div className="tw-flex tw-items-center tw-gap-2">
                  Temperature
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="tw-h-4 tw-w-4 tw-text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Controls randomness: 0 is focused and deterministic, 2 is more creative
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={localModel.temperature ?? 0.1}
                onChange={(value) => handleLocalUpdate("temperature", value)}
                max={2}
                min={0}
                step={0.1}
              />
            </FormField>

            <FormField
              label={
                <div className="tw-flex tw-items-center tw-gap-2">
                  Context
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="tw-h-4 tw-w-4 tw-text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Maximum number of tokens to use for context
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={localModel.context ?? 1000}
                onChange={(value) => handleLocalUpdate("context", value)}
                max={65000}
                min={0}
                step={100}
              />
            </FormField>

          <div className="tw-flex tw-items-center tw-justify-between tw-py-2">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-sm tw-font-medium">Stream output</span>
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="tw-h-4 tw-w-4 tw-text-muted" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Enable streaming responses from the model
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <SettingSwitch
              checked={localModel.stream ?? true}
              onCheckedChange={(checked) => handleLocalUpdate("stream", checked)}
            />
          </div>*/}
        </div>
      </DialogContent>
    </Dialog>
  );
};
