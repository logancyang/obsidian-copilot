import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useTab } from "@/contexts/TabContext";
import { CustomModel } from "@/aiParams";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FormField } from "@/components/ui/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  MODEL_CAPABILITIES,
  ModelCapability,
  Provider,
  ProviderMetadata,
  ProviderSettingsKeyMap,
  SettingKeyProviders,
} from "@/constants";
import { getProviderInfo, getProviderLabel } from "@/utils";
import { PasswordInput } from "@/components/ui/password-input";
import { getSettings } from "@/settings/model";
import { debounce } from "@/utils";

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
      <DialogContent className="sm:max-w-[425px]" container={modalContainer}>
        <DialogHeader>
          <DialogTitle>Model Settings - {localModel.name}</DialogTitle>
          <DialogDescription>Customize model parameters.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Display Name</span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent align="start" className="max-w-96" side="bottom">
                      <div className="text-sm text-muted flex flex-col gap-0.5">
                        <div className="text-[12px] font-bold">Suggested format:</div>
                        <div className="text-accent">[Source]-[Payment]:[Pretty Model Name]</div>
                        <div className="text-[12px]">
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
            <Input
              type="text"
              value={getProviderLabel(localModel.provider)}
              disabled
              className="bg-muted"
            />
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
              <p className="text-xs text-muted">
                <a href={providerInfo.keyManagementURL} target="_blank" rel="noopener noreferrer">
                  Get {providerInfo.label} API Key
                </a>
              </p>
            )}
          </FormField>

          <FormField
            label={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Model Capabilities</span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent align="start" className="max-w-96" side="bottom">
                      <div className="text-sm text-muted">
                        Only used to display model capabilities, does not affect model functionality
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            }
          >
            <div className="flex gap-4 items-center">
              {capabilityOptions.map(({ id, label, description }) => (
                <div key={id} className="flex items-center gap-2">
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
                  <Label htmlFor={id} className="text-sm">
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
                <div className="flex items-center gap-2">
                  Temperature
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted" />
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
                <div className="flex items-center gap-2">
                  Context
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted" />
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
                max={16000}
                min={0}
                step={100}
              />
            </FormField>

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Stream output</span>
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted" />
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
