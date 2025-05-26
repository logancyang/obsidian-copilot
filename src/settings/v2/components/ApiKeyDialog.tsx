import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { FormField } from "@/components/ui/form-field";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { PasswordInput } from "@/components/ui/password-input";
import { ChatModelProviders, ProviderSettingsKeyMap, SettingKeyProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import ProjectManager from "@/LLMProviders/projectManager";
import { logError, logInfo } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { parseModelsResponse, StandardModel } from "@/settings/providerModels";
import {
  err2String,
  getNeedSetKeyProvider,
  getProviderInfo,
  getProviderLabel,
  safeFetch,
} from "@/utils";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { App, Modal, Notice } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface ApiKeyModalContentProps {
  onClose: () => void;
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

function ApiKeyModalContent({ onClose }: ApiKeyModalContentProps) {
  const settings = useSettingsValue();

  const [verifyingProviders, setVerifyingProviders] = useState<Set<SettingKeyProviders>>(new Set());
  const [unverifiedKeys, setUnverifiedKeys] = useState<Set<SettingKeyProviders>>(new Set());

  const [expandedProvider, setExpandedProvider] = useState<SettingKeyProviders | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<
    Record<SettingKeyProviders, StandardModel[] | null>
  >({} as Record<SettingKeyProviders, StandardModel[] | null>);
  const [loadingProvider, setLoadingProvider] = useState<SettingKeyProviders | null>(null);
  const [errorProvider, setErrorProvider] = useState<SettingKeyProviders | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModelInfo | null>(null);
  const [verifyingModel, setVerifyingModel] = useState(false);

  // Ref to store the latest unverifiedKeys
  const unverifiedKeysRef = useRef(unverifiedKeys);

  // Effect to keep the ref updated with the latest unverifiedKeys
  useEffect(() => {
    unverifiedKeysRef.current = unverifiedKeys;
  }, [unverifiedKeys]);

  useEffect(() => {
    // Initialization on mount
    setUnverifiedKeys(new Set());
    setExpandedProvider(null);
    setSelectedModel(null);

    // Cleanup on unmount
    return () => {
      unverifiedKeysRef.current.forEach((provider) => {
        const settingKey = ProviderSettingsKeyMap[provider];
        updateSetting(settingKey, "");
      });
    };
  }, []); // Empty dependency array ensures this runs on mount and cleans up on unmount

  // Get API key by provider
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
      // Mark models as needing refresh for this provider
      setModelsByProvider((prev) => ({ ...prev, [provider]: undefined }));
      // Clear error for this provider as the key has changed
      setErrorProvider((prev) => (prev === provider ? null : prev));
    }
  };

  const verifyApiKey = async (provider: SettingKeyProviders, apiKey: string) => {
    setVerifyingProviders((prev) => new Set(prev).add(provider));
    try {
      logInfo(`Verifying ${provider} API key`);
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
      await ProjectManager.instance.getCurrentChainManager().chatModelManager.ping(customModel);

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
      apiKey = await getDecryptedKey(apiKey);

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
            method: "GET",
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
    } catch (error) {
      console.error(`Error fetching models for ${provider}:`, error);
      setErrorProvider(provider);
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

      await ProjectManager.instance.getCurrentChainManager().chatModelManager.ping(customModel);

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
    <div className="sm:max-w-[500px] max-h-[600px] overflow-y-auto p-4">
      <div className="mb-4">
        <h2 className="text-xl font-bold">AI Provider Settings</h2>
        <p className="text-sm text-muted">Configure your AI providers by adding their API keys.</p>
      </div>

      <div className="space-y-6 py-4">
        <div className="space-y-4">
          {providers.map((item: ProviderKeyItem) => (
            <React.Fragment key={item.provider}>
              <div className="flex flex-col gap-2">
                <div className="flex items-end gap-2 font-medium">
                  <div className="truncate">{getProviderLabel(item.provider)}</div>
                </div>
                <div className="flex flex-row items-center gap-2">
                  <div className="flex-1">
                    <PasswordInput
                      className="max-w-full"
                      value={item.apiKey}
                      onChange={(v) => handleApiKeyChange(item.provider, v)}
                      disabled={verifyingProviders.has(item.provider)}
                    />
                  </div>
                  <div className="tw-w-[72px]">
                    {!item.isVerified ? (
                      <Button
                        onClick={() => verifyApiKey(item.provider, item.apiKey)}
                        disabled={!item.apiKey || verifyingProviders.size > 0}
                        variant="secondary"
                        size="sm"
                        className="tw-w-full tw-whitespace-nowrap"
                      >
                        {verifyingProviders.has(item.provider) ? (
                          <Loader2 className="tw-mr-2 tw-h-4 tw-w-4 tw-animate-spin" />
                        ) : (
                          "Verify"
                        )}
                      </Button>
                    ) : (
                      <span className="tw-text-success tw-text-sm tw-flex tw-items-center tw-justify-center tw-h-9">
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
                          item.apiKey &&
                          modelsByProvider[item.provider] === undefined &&
                          loadingProvider !== item.provider &&
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
                <div>
                  {getProviderInfo(item.provider).keyManagementURL && (
                    <a
                      href={getProviderInfo(item.provider).keyManagementURL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] sm:text-xs text-accent hover:text-accent-hover"
                    >
                      Get {getProviderLabel(item.provider)} Key
                    </a>
                  )}
                </div>
              </div>
              <Collapsible open={expandedProvider === item.provider} className="mt-2">
                <CollapsibleContent className="p-3 rounded-md">
                  <div className="flex flex-col gap-2">
                    <FormField
                      label="Model"
                      description="Add the currently selected model to model List. After adding, please check the Model Tab."
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ObsidianNativeSelect
                              options={
                                modelsByProvider[item.provider]
                                  ?.sort((a, b) => a.name.localeCompare(b.name))
                                  .map((model) => ({
                                    label: model.name,
                                    value: model.id,
                                  })) || []
                              }
                              onChange={(e) => {
                                const value = e.target.value;
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
                              onClick={() => {
                                if (
                                  item.apiKey &&
                                  modelsByProvider[item.provider] === undefined &&
                                  loadingProvider !== item.provider &&
                                  errorProvider !== item.provider
                                ) {
                                  fetchModelsForProvider(item.provider, item.apiKey);
                                }
                              }}
                              value={
                                selectedModel?.provider === item.provider ? selectedModel.id : ""
                              }
                              placeholder="Select Model"
                              disabled={
                                !item.apiKey ||
                                loadingProvider === item.provider ||
                                (errorProvider === item.provider &&
                                  modelsByProvider[item.provider] !== null)
                              }
                            />
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
                        <div className="mt-1 text-xs">
                          {loadingProvider === item.provider && (
                            <div className="text-muted p-1">Loading models...</div>
                          )}
                          {errorProvider === item.provider && (
                            <div className="text-error p-1">
                              Failed to load models.
                              {modelsByProvider[item.provider] === null &&
                                " Check API Key or network."}
                            </div>
                          )}
                          {modelsByProvider[item.provider] &&
                            modelsByProvider[item.provider]!.length === 0 && (
                              <div className="text-muted p-1">
                                No models available for this provider.
                              </div>
                            )}
                          {modelsByProvider[item.provider] === undefined &&
                            errorProvider !== item.provider &&
                            loadingProvider !== item.provider && (
                              <div className="text-muted p-1">
                                Click to load models or expand to try again if API key was changed.
                              </div>
                            )}
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

      <div className="flex justify-end mt-4">
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export class ApiKeyDialog extends Modal {
  private root: Root;

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    this.root.render(<ApiKeyModalContent onClose={() => this.close()} />);
  }

  onClose() {
    this.root.unmount();
  }
}
