import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { HelpTooltip } from "@/components/ui/help-tooltip";
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
  ChatModelProviders,
  EmbeddingModelProviders,
  MODEL_CAPABILITIES,
  ModelCapability,
  ProviderMetadata,
  SettingKeyProviders,
} from "@/constants";
import { useTab } from "@/contexts/TabContext";
import { logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { err2String, getProviderInfo, getProviderLabel, omit } from "@/utils";
import { getApiKeyForProvider } from "@/utils/modelUtils";
import { ChevronDown, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";

interface FormErrors {
  name: boolean;
  instanceName: boolean;
  deploymentName: boolean;
  embeddingDeploymentName: boolean;
  apiVersion: boolean;
  displayName: boolean;
  bedrockRegion: boolean;
}

interface ModelAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (model: CustomModel) => void;
  ping: (model: CustomModel) => Promise<boolean>;
  isEmbeddingModel?: boolean;
}

export const ModelAddDialog: React.FC<ModelAddDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
  ping,
  isEmbeddingModel = false,
}) => {
  const { modalContainer } = useTab();
  const settings = getSettings();
  const defaultProvider = isEmbeddingModel
    ? EmbeddingModelProviders.OPENAI
    : ChatModelProviders.OPENAI;

  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({
    name: false,
    instanceName: false,
    deploymentName: false,
    embeddingDeploymentName: false,
    apiVersion: false,
    displayName: false,
    bedrockRegion: false,
  });

  const setError = (field: keyof FormErrors, value: boolean) => {
    setErrors((prev) => ({ ...prev, [field]: value }));
  };

  const clearErrors = () => {
    setErrors({
      name: false,
      instanceName: false,
      deploymentName: false,
      embeddingDeploymentName: false,
      apiVersion: false,
      displayName: false,
      bedrockRegion: false,
    });
  };

  const validateFields = (): boolean => {
    let isValid = true;
    const newErrors = { ...errors };

    // Validate name
    newErrors.name = !model.name;
    if (!model.name) isValid = false;

    // Validate Azure OpenAI specific fields
    if (model.provider === ChatModelProviders.AZURE_OPENAI) {
      newErrors.instanceName = !model.azureOpenAIApiInstanceName;
      newErrors.apiVersion = !model.azureOpenAIApiVersion;

      if (isEmbeddingModel) {
        newErrors.embeddingDeploymentName = !model.azureOpenAIApiEmbeddingDeploymentName;
        if (!model.azureOpenAIApiEmbeddingDeploymentName) isValid = false;
      } else {
        newErrors.deploymentName = !model.azureOpenAIApiDeploymentName;
        if (!model.azureOpenAIApiDeploymentName) isValid = false;
      }

      if (!model.azureOpenAIApiInstanceName || !model.azureOpenAIApiVersion) {
        isValid = false;
      }
    }

    if (model.provider === ChatModelProviders.AMAZON_BEDROCK) {
      newErrors.bedrockRegion = false;
    } else {
      newErrors.bedrockRegion = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const getInitialModel = (provider = defaultProvider): CustomModel => {
    const baseModel = {
      name: "",
      provider,
      enabled: true,
      isBuiltIn: false,
      baseUrl: "",
      apiKey: getApiKeyForProvider(provider as SettingKeyProviders),
      isEmbeddingModel,
      capabilities: [],
    };

    if (!isEmbeddingModel) {
      const chatModel = {
        ...baseModel,
        stream: true,
      };

      if (provider === ChatModelProviders.AMAZON_BEDROCK) {
        return {
          ...chatModel,
          bedrockRegion: settings.amazonBedrockRegion,
        };
      }

      return chatModel;
    }

    return baseModel;
  };

  const [model, setModel] = useState<CustomModel>(getInitialModel());

  // Clean up model data by trimming whitespace
  const getCleanedModel = (modelData: CustomModel): CustomModel => {
    return {
      ...modelData,
      name: modelData.name?.trim(),
      baseUrl: modelData.baseUrl?.trim(),
      apiKey: modelData.apiKey?.trim(),
      openAIOrgId: modelData.openAIOrgId?.trim(),
      azureOpenAIApiInstanceName: modelData.azureOpenAIApiInstanceName?.trim(),
      azureOpenAIApiDeploymentName: modelData.azureOpenAIApiDeploymentName?.trim(),
      azureOpenAIApiEmbeddingDeploymentName:
        modelData.azureOpenAIApiEmbeddingDeploymentName?.trim(),
      azureOpenAIApiVersion: modelData.azureOpenAIApiVersion?.trim(),
      bedrockRegion: modelData.bedrockRegion?.trim(),
    };
  };

  const [providerInfo, setProviderInfo] = useState<ProviderMetadata>(
    getProviderInfo(defaultProvider)
  );

  // Check if the form has required fields filled
  const isFormValid = (): boolean => {
    return Boolean(model.name && model.provider);
  };

  // Check if buttons should be disabled
  const isButtonDisabled = (): boolean => {
    return isVerifying || !isFormValid();
  };

  const handleAdd = () => {
    if (!validateFields()) {
      new Notice("Please fill in all required fields");
      return;
    }

    const cleanedModel = getCleanedModel(model);
    onAdd(cleanedModel);
    onOpenChange(false);
    setModel(getInitialModel());
    clearErrors();
  };

  const handleProviderChange = (provider: ChatModelProviders) => {
    setProviderInfo(getProviderInfo(provider));
    setModel({
      ...model,
      provider,
      apiKey: getApiKeyForProvider(provider as SettingKeyProviders),
      ...(provider === ChatModelProviders.OPENAI ? { openAIOrgId: settings.openAIOrgId } : {}),
      ...(provider === ChatModelProviders.AZURE_OPENAI
        ? {
            azureOpenAIApiInstanceName: settings.azureOpenAIApiInstanceName,
            azureOpenAIApiDeploymentName: settings.azureOpenAIApiDeploymentName,
            azureOpenAIApiVersion: settings.azureOpenAIApiVersion,
            azureOpenAIApiEmbeddingDeploymentName: settings.azureOpenAIApiEmbeddingDeploymentName,
          }
        : {}),
      ...(provider === ChatModelProviders.AMAZON_BEDROCK
        ? {
            bedrockRegion: settings.amazonBedrockRegion,
          }
        : {
            bedrockRegion: undefined,
          }),
    });
  };
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setModel(getInitialModel());
      clearErrors();
      setIsOpen(false);
    }
    onOpenChange(open);
  };

  const handleVerify = async () => {
    if (!validateFields()) {
      new Notice("Please fill in all required fields");
      return;
    }

    setIsVerifying(true);
    try {
      const cleanedModel = getCleanedModel(model);
      await ping(cleanedModel);
      new Notice("Model verification successful!");
    } catch (err) {
      logError(err);
      const errStr = err2String(err);
      new Notice("Model verification failed: " + errStr);
    } finally {
      setIsVerifying(false);
    }
  };

  const renderProviderSpecificFields = () => {
    const fields = () => {
      switch (model.provider) {
        case ChatModelProviders.OPENAI:
          return (
            <FormField
              label="OpenAI Organization ID"
              description="Enter OpenAI Organization ID if applicable"
            >
              <Input
                type="text"
                placeholder="Enter OpenAI Organization ID if applicable"
                value={model.openAIOrgId || ""}
                onChange={(e) => setModel({ ...model, openAIOrgId: e.target.value })}
              />
            </FormField>
          );
        case ChatModelProviders.AZURE_OPENAI:
          return (
            <>
              <FormField
                label="Instance Name"
                required
                error={errors.instanceName}
                errorMessage="Instance name is required"
              >
                <Input
                  type="text"
                  placeholder="Enter Azure OpenAI API Instance Name"
                  value={model.azureOpenAIApiInstanceName || ""}
                  onChange={(e) => {
                    setModel({ ...model, azureOpenAIApiInstanceName: e.target.value });
                    setError("instanceName", false);
                  }}
                />
              </FormField>

              {!isEmbeddingModel ? (
                <FormField
                  label="Deployment Name"
                  required
                  error={errors.deploymentName}
                  errorMessage="Deployment name is required"
                  description="This is your actual model, no need to pass a model name separately."
                >
                  <Input
                    type="text"
                    placeholder="Enter Azure OpenAI API Deployment Name"
                    value={model.azureOpenAIApiDeploymentName || ""}
                    onChange={(e) => {
                      setModel({ ...model, azureOpenAIApiDeploymentName: e.target.value });
                      setError("deploymentName", false);
                    }}
                  />
                </FormField>
              ) : (
                <FormField
                  label="Embedding Deployment Name"
                  required
                  error={errors.embeddingDeploymentName}
                  errorMessage="Embedding deployment name is required"
                >
                  <Input
                    type="text"
                    placeholder="Enter Azure OpenAI API Embedding Deployment Name"
                    value={model.azureOpenAIApiEmbeddingDeploymentName || ""}
                    onChange={(e) => {
                      setModel({ ...model, azureOpenAIApiEmbeddingDeploymentName: e.target.value });
                      setError("embeddingDeploymentName", false);
                    }}
                  />
                </FormField>
              )}

              <FormField
                label="API Version"
                required
                error={errors.apiVersion}
                errorMessage="API version is required"
              >
                <Input
                  type="text"
                  placeholder="Enter Azure OpenAI API Version"
                  value={model.azureOpenAIApiVersion || ""}
                  onChange={(e) => {
                    setModel({ ...model, azureOpenAIApiVersion: e.target.value });
                    setError("apiVersion", false);
                  }}
                />
              </FormField>
            </>
          );
        case ChatModelProviders.AMAZON_BEDROCK:
          return (
            <FormField
              label="Region (optional)"
              description="Defaults to us-east-1 when left blank. With inference profiles (global., us., eu., apac.), region is auto-managed."
            >
              <Input
                type="text"
                placeholder="Enter AWS region (e.g. us-east-1)"
                value={model.bedrockRegion || ""}
                onChange={(e) => {
                  setModel({ ...model, bedrockRegion: e.target.value });
                  setError("bedrockRegion", false);
                }}
              />
            </FormField>
          );
        default:
          return null;
      }
    };

    const content = fields();
    if (!content) return null;

    return (
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="tw-space-y-2 tw-rounded-lg tw-border tw-pt-4"
      >
        <div className="tw-flex tw-items-center tw-justify-between">
          <Label>Additional {getProviderLabel(model.provider)} Settings</Label>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="tw-w-9 tw-p-0">
              <ChevronDown className="tw-size-4" />
              <span className="tw-sr-only">Toggle</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="tw-max-h-[200px] tw-space-y-4 tw-overflow-y-auto tw-pb-0.5 tw-pl-0.5 tw-pr-2">
          {content}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const getPlaceholderUrl = () => {
    if (model.provider !== ChatModelProviders.AZURE_OPENAI) {
      return providerInfo.host;
    }

    const instanceName = model.azureOpenAIApiInstanceName || "[instance]";
    const deploymentName = isEmbeddingModel
      ? model.azureOpenAIApiEmbeddingDeploymentName || "[deployment]"
      : model.azureOpenAIApiDeploymentName || "[deployment]";
    const apiVersion = model.azureOpenAIApiVersion || "[api-version]";
    const endpoint = isEmbeddingModel ? "embeddings" : "chat/completions";

    return `https://${instanceName}.openai.azure.com/openai/deployments/${deploymentName}/${endpoint}?api-version=${apiVersion}`;
  };

  const capabilityOptions = Object.entries(MODEL_CAPABILITIES).map(([id, description]) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    description,
  })) as Array<{ id: ModelCapability; label: string; description: string }>;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:tw-max-w-[425px]"
        container={modalContainer}
        ref={(el) => setDialogElement(el)}
      >
        <DialogHeader>
          <DialogTitle>Add Custom {isEmbeddingModel ? "Embedding" : "Chat"} Model</DialogTitle>
          <DialogDescription>Add a new model to your collection.</DialogDescription>
        </DialogHeader>

        <div className="tw-space-y-3">
          <FormField
            label="Model Name"
            required
            error={errors.name}
            errorMessage="Model name is required"
            description={
              model.provider === ChatModelProviders.AMAZON_BEDROCK && !isEmbeddingModel
                ? "For Bedrock, use cross-region inference profile IDs (global., us., eu., or apac. prefix) for better reliability. Regional IDs without prefixes may fail."
                : undefined
            }
          >
            <Input
              type="text"
              placeholder={`Enter model name (e.g. ${
                model.provider === ChatModelProviders.AMAZON_BEDROCK && !isEmbeddingModel
                  ? "global.anthropic.claude-sonnet-4-5-20250929-v1:0"
                  : isEmbeddingModel
                    ? "text-embedding-3-small"
                    : "gpt-4"
              })`}
              value={model.name}
              onChange={(e) => {
                setModel({ ...model, name: e.target.value });
                setError("name", false);
              }}
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
              value={model.displayName || ""}
              onChange={(e) => {
                setModel({ ...model, displayName: e.target.value });
              }}
            />
          </FormField>

          <FormField label="Provider">
            <Select value={model.provider} onValueChange={handleProviderChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent container={dialogElement}>
                {Object.values(
                  isEmbeddingModel
                    ? omit(EmbeddingModelProviders, ["COPILOT_PLUS", "COPILOT_PLUS_JINA"])
                    : omit(ChatModelProviders, ["COPILOT_PLUS"])
                ).map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {getProviderLabel(provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Base URL" description="Leave it blank, unless you are using a proxy.">
            <Input
              type="text"
              placeholder={getPlaceholderUrl() || "https://api.example.com/v1"}
              value={model.baseUrl || ""}
              onChange={(e) => setModel({ ...model, baseUrl: e.target.value })}
            />
          </FormField>

          <FormField label="API Key">
            <PasswordInput
              placeholder={`Enter ${providerInfo.label} API Key`}
              value={model.apiKey || ""}
              onChange={(value) => setModel({ ...model, apiKey: value })}
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
                    checked={model.capabilities?.includes(id)}
                    onCheckedChange={(checked) => {
                      const newCapabilities = model.capabilities || [];
                      setModel({
                        ...model,
                        capabilities: checked
                          ? [...newCapabilities, id]
                          : newCapabilities.filter((cap) => cap !== id),
                      });
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

          {renderProviderSpecificFields()}
        </div>

        <div className="tw-flex tw-items-center  tw-justify-between tw-gap-4">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Checkbox
              id="enable-cors"
              checked={model.enableCors || false}
              onCheckedChange={(checked: boolean) => setModel({ ...model, enableCors: checked })}
            />
            <Label htmlFor="enable-cors">
              <div className="tw-flex tw-items-center tw-gap-0.5">
                <span className="tw-text-xs md:tw-text-sm">CORS</span>
                <HelpTooltip
                  content={
                    <div className="tw-text-sm tw-text-muted">
                      Only check this option when prompted that CORS is needed
                    </div>
                  }
                  contentClassName="tw-max-w-96"
                />
              </div>
            </Label>
          </div>
          <TooltipProvider>
            <div className="tw-flex tw-gap-2 tw-text-xs md:tw-text-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" onClick={handleVerify} disabled={isButtonDisabled()}>
                    {isVerifying ? (
                      <>
                        <Loader2 className="tw-mr-2 tw-size-2 tw-animate-spin md:tw-size-4 " />
                        Test
                      </>
                    ) : (
                      "Test"
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Optional: test API call</p>
                </TooltipContent>
              </Tooltip>
              <Button variant="default" onClick={handleAdd} disabled={isButtonDisabled()}>
                Add Model
              </Button>
            </div>
          </TooltipProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
};
