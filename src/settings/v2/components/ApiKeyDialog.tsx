import ChatModelManager from "@/LLMProviders/chatModelManager";
import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PasswordInput } from "@/components/ui/password-input";
import { ChatModelProviders, ProviderSettingsKeyMap, SettingKeyProviders } from "@/constants";
import { CopilotSettings } from "@/settings/model";
import { parseModelsResponse, StandardModel } from "@/settings/providerModels";
import {
  err2String,
  getNeedSetKeyProvider,
  getProviderInfo,
  getProviderLabel,
  safeFetch,
} from "@/utils";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { logError } from "@/logger";

interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Readonly<CopilotSettings>;
  updateSetting: (key: string, value: any) => void;
  modalContainer: HTMLElement | null;
}

interface ProviderKeyItem {
  provider: SettingKeyProviders;
  apiKey: string;
  isVerified: boolean;
}

interface SelectedModelInfo {
  id: string;
  name: string;
  provider: SettingKeyProviders;
}

const ApiKeyDialog: React.FC<ApiKeyDialogProps> = ({
  open,
  onOpenChange,
  settings,
  updateSetting,
  modalContainer,
}) => {
  const [verifyingProviders, setVerifyingProviders] = useState<Set<SettingKeyProviders>>(new Set());
  const [unverifiedKeys, setUnverifiedKeys] = useState<Set<SettingKeyProviders>>(new Set());
  const [expandedProvider, setExpandedProvider] = useState<SettingKeyProviders | null>(null);
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<
    Record<SettingKeyProviders, StandardModel[] | null>
  >({} as Record<SettingKeyProviders, StandardModel[] | null>);
  const [loadingProvider, setLoadingProvider] = useState<SettingKeyProviders | null>(null);
  const [errorProvider, setErrorProvider] = useState<SettingKeyProviders | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModelInfo | null>(null);
  const [verifyingModel, setVerifyingModel] = useState(false);
  const [lastFailedApiKeys, setLastFailedApiKeys] = useState<
    Record<SettingKeyProviders, string | null>
  >({} as Record<SettingKeyProviders, string | null>);

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setUnverifiedKeys(new Set());
    } else {
      unverifiedKeys.forEach((provider) => {
        const settingKey = ProviderSettingsKeyMap[provider];
        updateSetting(settingKey, "");
      });
    }
    onOpenChange(isOpen);
    setExpandedProvider(null);
    setSelectedModel(null);
  };

  const getApiKeyByProvider = (provider: SettingKeyProviders): string => {
    const settingKey = ProviderSettingsKeyMap[provider];
    return (settings[settingKey] ?? "") as string;
  };

  const providers: ProviderKeyItem[] = getNeedSetKeyProvider().map((provider) => {
    const providerKey = provider as SettingKeyProviders;
    const apiKey = getApiKeyByProvider(providerKey);
    return {
      provider: providerKey,
      apiKey,
      isVerified: !!apiKey && !unverifiedKeys.has(providerKey),
    };
  });

  const handleApiKeyChange = (provider: SettingKeyProviders, value: string) => {
    const currentKey = getApiKeyByProvider(provider);
    if (currentKey !== value) {
      updateSetting(ProviderSettingsKeyMap[provider], value);
      setUnverifiedKeys((prev) => new Set(prev).add(provider));
    }
  };

  const verifyApiKey = async (provider: SettingKeyProviders, apiKey: string) => {
    setVerifyingProviders((prev) => new Set(prev).add(provider));
    try {
      if (settings.debug) console.log(`Verifying ${provider} API key:`, apiKey);
      const defaultTestModel = getProviderInfo(provider).testModel;

      if (!defaultTestModel) {
        new Notice(
          "API key verification failed: No default test model found for the selected provider.",
          10000
        );
        return;
      }

      const customModel: CustomModel = {
        name: defaultTestModel,
        provider: provider,
        apiKey,
        enabled: true,
      };
      await ChatModelManager.getInstance().ping(customModel);

      new Notice("API key verified successfully!");
      setUnverifiedKeys((prev) => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    } catch (error) {
      console.error("API key verification failed:", error);
      new Notice("API key verification failed: " + err2String(error), 10000);
    } finally {
      setVerifyingProviders((prev) => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    }
  };

  const fetchModelsForProvider = async (provider: SettingKeyProviders, apiKey: string) => {
    setLoadingProvider(provider);
    setErrorProvider(null);
    try {
      let url = getProviderInfo(provider).listModelURL;
      let headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
      };

      if (provider === ChatModelProviders.GOOGLE) {
        url += `?key=${apiKey}`;
        headers = {};
      } else if (provider === ChatModelProviders.ANTHROPIC) {
        headers = {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        };
      }

      const tryFetch = async (useSafeFetch: boolean) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout

        try {
          const response = await (useSafeFetch ? safeFetch : fetch)(url, {
            headers,
            signal: controller.signal,
          });

          if (!response.ok) {
            const msg = err2String(await response.json());
            logError(msg);
            throw new Error(`Failed to fetch models: ${response.statusText} \n detail: ` + msg);
          }
          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      let response;
      try {
        // First try with normal fetch
        response = await tryFetch(false);
      } catch (firstError) {
        console.log("First fetch attempt failed, trying with safeFetch...");
        try {
          // Second try with safeFetch
          response = await tryFetch(true);
          new Notice(
            "Successfully fetched models list with CORS enabled. This model may require CORS to be enabled when you add it."
          );
        } catch (error) {
          const msg =
            "\nwithout CORS Error: " +
            err2String(firstError) +
            "\nwith CORS Error: " +
            err2String(error);
          throw new Error(msg);
        }
      }

      const rawData = await response.json();

      // Use the new adapter function to parse data
      const standardModels = parseModelsResponse(provider, rawData);
      setModelsByProvider((prev) => ({ ...prev, [provider]: standardModels }));
      setLoadingProvider(null);
      setLastFailedApiKeys((prev) => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });
    } catch (error) {
      console.error(`Error fetching models for ${provider}:`, error);
      setErrorProvider(provider);
      setLastFailedApiKeys((prev) => ({ ...prev, [provider]: apiKey }));
      setLoadingProvider(null);
      new Notice(
        `Failed to load models for ${getProviderLabel(provider)}: ${err2String(error)}`,
        5000
      );
    }
  };

  const verifyModel = async () => {
    if (!selectedModel) {
      new Notice("Please select a model first");
      return;
    }

    setVerifyingModel(true);
    try {
      const apiKey = getApiKeyByProvider(selectedModel.provider);
      const customModel: CustomModel = {
        name: selectedModel.name,
        provider: selectedModel.provider,
        apiKey,
        enabled: true,
      };

      await ChatModelManager.getInstance().ping(customModel);

      // After successful verification, add the model to activeModels
      const existingModel = settings.activeModels.find(
        (model) => model.name === selectedModel.name && model.provider === selectedModel.provider
      );

      if (!existingModel) {
        const updatedModels = [...settings.activeModels, customModel];
        updateSetting("activeModels", updatedModels);
        new Notice(
          `Model ${selectedModel.name} verified successfully and added to your models list!`
        );
      } else {
        new Notice(
          `Model ${selectedModel.name} verified successfully! It already exists in your models list.`
        );
      }
    } catch (error) {
      console.error("Model verification failed:", error);
      new Notice("Model verification failed: " + err2String(error), 10000);
    } finally {
      setVerifyingModel(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        container={modalContainer}
        className="sm:max-w-[500px] max-h-[600px] overflow-y-auto"
        ref={(el) => setDialogElement(el)}
      >
        <DialogHeader>
          <DialogTitle>AI Provider Settings</DialogTitle>
          <DialogDescription>
            Configure your AI providers by adding their API keys.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-4">
            {providers.map((item: ProviderKeyItem) => (
              <React.Fragment key={item.provider}>
                <div className="flex items-center gap-2">
                  <div className="w-[120px] font-medium">
                    <div className="truncate">{getProviderLabel(item.provider)}</div>
                    {getProviderInfo(item.provider).keyManagementURL && (
                      <a
                        href={getProviderInfo(item.provider).keyManagementURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-accent hover:text-accent-hover"
                      >
                        Get {getProviderLabel(item.provider)} Key
                      </a>
                    )}
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 pr-2">
                      <PasswordInput
                        className="max-w-full"
                        value={item.apiKey}
                        onChange={(v) => handleApiKeyChange(item.provider, v)}
                        disabled={verifyingProviders.has(item.provider)}
                      />
                    </div>
                    <div className="w-[72px]">
                      {!item.isVerified ? (
                        <Button
                          onClick={() => verifyApiKey(item.provider, item.apiKey)}
                          disabled={!item.apiKey || verifyingProviders.size > 0}
                          variant="secondary"
                          size="sm"
                          className="w-full whitespace-nowrap"
                        >
                          {verifyingProviders.has(item.provider) ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            "Verify"
                          )}
                        </Button>
                      ) : (
                        <span className="text-success text-sm flex items-center justify-center h-9">
                          Verified
                        </span>
                      )}
                    </div>
                    <div className="">
                      <Button
                        onClick={() => {
                          const nextExpanded =
                            expandedProvider === item.provider ? null : item.provider;
                          setExpandedProvider(nextExpanded);
                          if (
                            nextExpanded &&
                            modelsByProvider[item.provider] === undefined &&
                            errorProvider !== item.provider
                          ) {
                            fetchModelsForProvider(item.provider, item.apiKey);
                          }
                        }}
                        disabled={!item.apiKey || verifyingProviders.size > 0}
                        variant="secondary"
                        size="sm"
                        className="w-full whitespace-nowrap px-0.5 py-0.5 flex items-center justify-center gap-1"
                      >
                        Add Model
                        {expandedProvider === item.provider ? (
                          <ChevronUp className="h-4 w-4 ml-1" />
                        ) : (
                          <ChevronDown className="h-4 w-4 ml-1" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
                <Collapsible open={expandedProvider === item.provider} className="mt-2">
                  <CollapsibleContent className="p-3 border rounded-md">
                    <div className="flex flex-col gap-2">
                      <FormField
                        label="Model"
                        description="Add the currently selected Mode. After adding, please check the Model Tab."
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <Select
                              onValueChange={(value) => {
                                const model = modelsByProvider[item.provider]?.find(
                                  (m) => m.id === value
                                );
                                if (model) {
                                  setSelectedModel({
                                    id: model.id,
                                    name: model.name,
                                    provider: item.provider,
                                  });
                                }
                              }}
                              onOpenChange={(open) => {
                                if (
                                  open &&
                                  item.apiKey &&
                                  lastFailedApiKeys[item.provider] !== undefined &&
                                  lastFailedApiKeys[item.provider] !== item.apiKey
                                ) {
                                  fetchModelsForProvider(item.provider, item.apiKey);
                                }
                              }}
                              value={
                                selectedModel?.provider === item.provider ? selectedModel.id : ""
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select Model" />
                              </SelectTrigger>
                              <SelectContent container={dialogElement}>
                                {loadingProvider === item.provider ? (
                                  <div className="p-2 text-sm text-muted">Loading models...</div>
                                ) : errorProvider === item.provider ? (
                                  <div className="p-2 text-sm text-error">
                                    Failed to load models.
                                  </div>
                                ) : modelsByProvider[item.provider] &&
                                  modelsByProvider[item.provider]!.length > 0 ? (
                                  modelsByProvider[item.provider]!.map((model) => (
                                    <SelectItem key={model.id} value={model.id}>
                                      {model.name}
                                    </SelectItem>
                                  ))
                                ) : modelsByProvider[item.provider] &&
                                  modelsByProvider[item.provider]!.length === 0 ? (
                                  <div className="p-2 text-sm text-muted">
                                    No models available for this provider.
                                  </div>
                                ) : (
                                  <div className="p-2 text-sm text-muted">
                                    Expand to load models.
                                  </div>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="w-[72px]">
                            <Button
                              onClick={verifyModel}
                              disabled={
                                !selectedModel ||
                                selectedModel.provider !== item.provider ||
                                verifyingModel
                              }
                              variant="secondary"
                              size="sm"
                              className="w-full whitespace-nowrap"
                            >
                              {verifyingModel ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                "Add"
                              )}
                            </Button>
                          </div>
                        </div>
                      </FormField>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </React.Fragment>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ApiKeyDialog;
