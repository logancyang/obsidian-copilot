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
import {
  ChatModelProviders,
  DisplayKeyProviders,
  EmbeddingModelProviders,
  Provider,
  ProviderMetadata,
  ProviderSettingsKeyMap,
} from "@/constants";
import { useTab } from "@/contexts/TabContext";
import { getSettings } from "@/settings/model";
import { err2String, getProviderInfo, getProviderLabel, omit } from "@/utils";
import { ChevronDown, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: boolean;
  description?: string;
  errorMessage?: string;
  children: React.ReactNode;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  required = false,
  error = false,
  description,
  errorMessage = "This field is required",
  children,
}) => {
  return (
    <div className="space-y-2">
      <Label className={error ? "text-error" : ""}>
        {label} {required && <span className="text-error">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-error">{errorMessage}</p>}
      {description && <p className="text-sm text-muted">{description}</p>}
    </div>
  );
};

interface FormErrors {
  name: boolean;
  instanceName: boolean;
  deploymentName: boolean;
  embeddingDeploymentName: boolean;
  apiVersion: boolean;
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

    setErrors(newErrors);
    return isValid;
  };

  const getDefaultApiKey = (provider: Provider): string => {
    return (settings[ProviderSettingsKeyMap[provider as DisplayKeyProviders]] as string) || "";
  };

  const getInitialModel = (provider = defaultProvider): CustomModel => {
    const baseModel = {
      name: "",
      provider,
      enabled: true,
      isBuiltIn: false,
      baseUrl: "",
      apiKey: getDefaultApiKey(provider),
      isEmbeddingModel,
    };

    if (!isEmbeddingModel) {
      return {
        ...baseModel,
        temperature: 0.1,
        context: 1000,
        stream: true,
      };
    }

    return baseModel;
  };

  const [model, setModel] = useState<CustomModel>(getInitialModel());
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

    onAdd(model);
    onOpenChange(false);
    setModel(getInitialModel());
    clearErrors();
  };

  const handleProviderChange = (provider: ChatModelProviders) => {
    setProviderInfo(getProviderInfo(provider));
    setModel({
      ...model,
      provider,
      apiKey: getDefaultApiKey(provider),
      ...(provider === ChatModelProviders.AZURE_OPENAI
        ? { openAIOrgId: settings.openAIOrgId }
        : {}),
      ...(provider === ChatModelProviders.AZURE_OPENAI
        ? {
            azureInstanceName: settings.azureOpenAIApiInstanceName,
            azureDeploymentName: settings.azureOpenAIApiDeploymentName,
            azureApiVersion: settings.azureOpenAIApiVersion,
            azureOpenAIApiEmbeddingDeploymentName: settings.azureOpenAIApiEmbeddingDeploymentName,
          }
        : {}),
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
      await ping(model);
      new Notice("Model verification successful!");
    } catch (err) {
      console.error(err);
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
        className="space-y-2 border rounded-lg pt-4"
      >
        <div className="flex items-center justify-between">
          <Label>Additional {getProviderLabel(model.provider)} Settings</Label>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-9 p-0">
              <ChevronDown className="h-4 w-4" />
              <span className="sr-only">Toggle</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="space-y-4 max-h-[200px] overflow-y-auto pl-0.5 pr-2 pb-0.5">
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        container={modalContainer}
        ref={(el) => setDialogElement(el)}
      >
        <DialogHeader>
          <DialogTitle>Add Custom {isEmbeddingModel ? "Embedding" : "Chat"} Model</DialogTitle>
          <DialogDescription>Add a new model to your collection.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <FormField
            label="Model Name"
            required
            error={errors.name}
            errorMessage="Model name is required"
          >
            <Input
              type="text"
              placeholder={`Enter model name (e.g. ${
                isEmbeddingModel ? "text-embedding-3-small" : "gpt-4"
              })`}
              value={model.name}
              onChange={(e) => {
                setModel({ ...model, name: e.target.value });
                setError("name", false);
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
              <p className="text-xs text-muted">
                <a href={providerInfo.keyManagementURL} target="_blank" rel="noopener noreferrer">
                  Get {providerInfo.label} API Key
                </a>
              </p>
            )}
          </FormField>

          {renderProviderSpecificFields()}
        </div>

        <div className="flex justify-end gap-4 items-center">
          <div className="flex items-center gap-2">
            <Checkbox
              id="enable-cors"
              checked={model.enableCors || false}
              onCheckedChange={(checked: boolean) => setModel({ ...model, enableCors: checked })}
            />
            <Label htmlFor="enable-cors" className="text-sm">
              Enable CORS
            </Label>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleAdd} disabled={isButtonDisabled()}>
              Add Model
            </Button>
            <Button variant="outline" onClick={handleVerify} disabled={isButtonDisabled()}>
              {isVerifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verify
                </>
              ) : (
                "Verify"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
