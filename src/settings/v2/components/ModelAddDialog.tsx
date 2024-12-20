import React, { useState } from "react";
import { useTab } from "@/contexts/TabContext";
import { getSettings } from "@/settings/model";
import {
  ChatModelProviders,
  DisplayKeyProviders,
  EmbeddingModelProviders,
  Provider,
  ProviderMetadata,
  ProviderSettingsKeyMap,
} from "@/constants";
import { CustomModel } from "@/aiParams";
import { err2String, getProviderInfo, getProviderLabel } from "@/utils";
import { Notice } from "obsidian";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [nameError, setNameError] = useState(false);
  const [instanceNameError, setInstanceNameError] = useState(false);
  const [deploymentNameError, setDeploymentNameError] = useState(false);
  const [apiVersionError, setApiVersionError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [embeddingDeploymentNameError, setEmbeddingDeploymentNameError] = useState(false);

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

  const handleAdd = () => {
    setNameError(!model.name);

    if (model.provider === ChatModelProviders.AZURE_OPENAI) {
      setInstanceNameError(!model.azureOpenAIApiInstanceName);
      setApiVersionError(!model.azureOpenAIApiVersion);

      if (isEmbeddingModel) {
        setEmbeddingDeploymentNameError(!model.azureOpenAIApiEmbeddingDeploymentName);
      } else {
        setDeploymentNameError(!model.azureOpenAIApiDeploymentName);
      }

      if (
        !model.azureOpenAIApiInstanceName ||
        !model.azureOpenAIApiVersion ||
        (isEmbeddingModel
          ? !model.azureOpenAIApiEmbeddingDeploymentName
          : !model.azureOpenAIApiDeploymentName)
      ) {
        new Notice("Please fill in all required fields for Azure OpenAI");
        return;
      }
    }

    if (!model.name) {
      new Notice("Please enter a model name");
      return;
    }

    if (!model.provider) {
      new Notice("Please select a provider");
      return;
    }

    onAdd(model);
    onOpenChange(false);
    setModel(getInitialModel());
    setNameError(false);
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
      setNameError(false);
      setIsOpen(false);
    }
    onOpenChange(open);
  };

  const handleVerify = async () => {
    setNameError(!model.name);

    if (model.provider === ChatModelProviders.AZURE_OPENAI) {
      setInstanceNameError(!model.azureOpenAIApiInstanceName);
      setApiVersionError(!model.azureOpenAIApiVersion);

      if (isEmbeddingModel) {
        setEmbeddingDeploymentNameError(!model.azureOpenAIApiEmbeddingDeploymentName);
      } else {
        setDeploymentNameError(!model.azureOpenAIApiDeploymentName);
      }

      if (
        !model.azureOpenAIApiInstanceName ||
        !model.azureOpenAIApiVersion ||
        (isEmbeddingModel
          ? !model.azureOpenAIApiEmbeddingDeploymentName
          : !model.azureOpenAIApiDeploymentName)
      ) {
        new Notice("Please fill in all required fields for Azure OpenAI");
        return;
      }
    }

    if (!model.name) {
      new Notice("Please enter a model name");
      return;
    }

    if (!model.provider) {
      new Notice("Please select a provider");
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
            <div className="space-y-2">
              <Label>OpenAI Organization ID (Optional)</Label>
              <Input
                type="text"
                placeholder="Enter OpenAI Organization ID if applicable"
                value={model.openAIOrgId || ""}
                onChange={(e) => setModel({ ...model, openAIOrgId: e.target.value })}
              />
            </div>
          );
        case ChatModelProviders.AZURE_OPENAI:
          return (
            <>
              <div className="space-y-2">
                <Label className={instanceNameError ? "text-red-500" : ""}>
                  Instance Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="Enter Azure OpenAI API Instance Name"
                  value={model.azureOpenAIApiInstanceName || ""}
                  onChange={(e) => {
                    setModel({ ...model, azureOpenAIApiInstanceName: e.target.value });
                    setInstanceNameError(false);
                  }}
                  className={instanceNameError ? "border-red-500" : ""}
                />
                {instanceNameError && (
                  <p className="text-xs text-red-500">Instance name is required</p>
                )}
              </div>

              {!isEmbeddingModel ? (
                <div className="space-y-2">
                  <Label className={deploymentNameError ? "text-red-500" : ""}>
                    Deployment Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    placeholder="Enter Azure OpenAI API Deployment Name"
                    value={model.azureOpenAIApiDeploymentName || ""}
                    onChange={(e) => {
                      setModel({ ...model, azureOpenAIApiDeploymentName: e.target.value });
                      setDeploymentNameError(false);
                    }}
                    className={deploymentNameError ? "border-red-500" : ""}
                  />
                  {deploymentNameError && (
                    <p className="text-xs text-red-500">Deployment name is required</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    This is your actual model, no need to pass a model name separately.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className={embeddingDeploymentNameError ? "text-red-500" : ""}>
                    Embedding Deployment Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    placeholder="Enter Azure OpenAI API Embedding Deployment Name"
                    value={model.azureOpenAIApiEmbeddingDeploymentName || ""}
                    onChange={(e) => {
                      setModel({ ...model, azureOpenAIApiEmbeddingDeploymentName: e.target.value });
                      setEmbeddingDeploymentNameError(false);
                    }}
                    className={embeddingDeploymentNameError ? "border-red-500" : ""}
                  />
                  {embeddingDeploymentNameError && (
                    <p className="text-xs text-red-500">Embedding deployment name is required</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label className={apiVersionError ? "text-red-500" : ""}>
                  API Version <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="Enter Azure OpenAI API Version"
                  value={model.azureOpenAIApiVersion || ""}
                  onChange={(e) => {
                    setModel({ ...model, azureOpenAIApiVersion: e.target.value });
                    setApiVersionError(false);
                  }}
                  className={apiVersionError ? "border-red-500" : ""}
                />
                {apiVersionError && <p className="text-xs text-red-500">API version is required</p>}
              </div>
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
          <div className="space-y-2">
            <Label className={nameError ? "text-red-500" : ""}>
              Model Name <span className="text-red-500">*</span>
            </Label>
            <Input
              type="text"
              placeholder={`Enter model name (e.g. ${
                isEmbeddingModel ? "text-embedding-3-small" : "gpt-4"
              })`}
              value={model.name}
              onChange={(e) => {
                setModel({ ...model, name: e.target.value });
                setNameError(false);
              }}
              className={nameError ? "border-red-500" : ""}
            />
            {nameError && <p className="text-xs text-red-500">Model name is required</p>}
          </div>

          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={model.provider} onValueChange={handleProviderChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent container={dialogElement}>
                {Object.values(isEmbeddingModel ? EmbeddingModelProviders : ChatModelProviders).map(
                  (provider) => (
                    <SelectItem key={provider} value={provider}>
                      {getProviderLabel(provider)}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Base URL (Optional)</Label>
            <Input
              type="text"
              placeholder={getPlaceholderUrl() || "https://api.example.com/v1"}
              value={model.baseUrl || ""}
              onChange={(e) => setModel({ ...model, baseUrl: e.target.value })}
            />
            <p className="text-sm text-muted-foreground">
              Leave it blank, unless you are using a proxy.
            </p>
          </div>
          <div className="space-y-2">
            <Label>API Key (Optional)</Label>
            <PasswordInput
              placeholder={`Enter ${providerInfo.label} API Key`}
              value={model.apiKey || ""}
              onChange={(value) => setModel({ ...model, apiKey: value })}
            />
            <p className="text-xs text-muted-foreground">
              {providerInfo.keyManagementURL && (
                <a href={providerInfo.keyManagementURL} target="_blank" rel="noopener noreferrer">
                  Get {providerInfo.label} API Key
                </a>
              )}
            </p>
          </div>

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
            <Button
              variant="outline"
              onClick={handleAdd}
              disabled={isVerifying || !model.name || !model.provider}
            >
              Add Model
            </Button>
            <Button
              variant="outline"
              onClick={handleVerify}
              disabled={isVerifying || !model.name || !model.provider}
            >
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
