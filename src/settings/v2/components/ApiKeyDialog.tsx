import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { FormField } from "@/components/ui/form-field";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { PasswordInput } from "@/components/ui/password-input";
import { ChatModelProviders, ProviderSettingsKeyMap, SettingKeyProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import ProjectManager from "@/LLMProviders/projectManager";
import { logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { parseModelsResponse, StandardModel } from "@/settings/providerModels";
import {
  err2String,
  getNeedSetKeyProvider,
  getProviderInfo,
  getProviderLabel,
  safeFetch,
} from "@/utils";
import { getApiKeyForProvider } from "@/utils/modelUtils";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { App, Modal, Notice } from "obsidian";
import React, { useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface ApiKeyModalContentProps {
  onClose: () => void;
}

interface ProviderKeyItem {
  provider: SettingKeyProviders;
  apiKey: string;
}

interface SelectedModelInfo {
  id: string;
  name: string;
  provider: SettingKeyProviders;
}

function ApiKeyModalContent({ onClose }: ApiKeyModalContentProps) {
  const settings = useSettingsValue();

  const [expandedProvider, setExpandedProvider] = useState<SettingKeyProviders | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<
    Record<SettingKeyProviders, StandardModel[] | null>
  >({} as Record<SettingKeyProviders, StandardModel[] | null>);
  const [loadingProvider, setLoadingProvider] = useState<SettingKeyProviders | null>(null);
  const [errorProvider, setErrorProvider] = useState<SettingKeyProviders | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModelInfo | null>(null);
  const [verifyingModel, setVerifyingModel] = useState(false);

  useEffect(() => {
    // Initialization on mount
    setExpandedProvider(null);
    setSelectedModel(null);
  }, []); // Empty dependency array ensures this runs on mount

  const providers: ProviderKeyItem[] = getNeedSetKeyProvider()
    .filter((provider) => provider !== ChatModelProviders.AMAZON_BEDROCK)
    .map((provider) => {
      const providerKey = provider as SettingKeyProviders;
      const apiKey = getApiKeyForProvider(providerKey);

      return {
        provider: providerKey,
        apiKey,
      };
    });

  const handleApiKeyChange = (provider: SettingKeyProviders, value: string) => {
    const currentKey = getApiKeyForProvider(provider);
    if (currentKey !== value) {
      updateSetting(ProviderSettingsKeyMap[provider], value);
      // Mark models as needing refresh for this provider
      setModelsByProvider((prev) => ({ ...prev, [provider]: undefined }));
      // Clear error for this provider as the key has changed
      setErrorProvider((prev) => (prev === provider ? null : prev));
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
      logError(`Error fetching models for ${provider}:`, error);
      setErrorProvider(provider);
      setLoadingProvider(null);
      new Notice(
        `Failed to load models for ${getProviderLabel(provider)}: ${err2String(error)}`,
        5000
      );
    }
  };

  const verifyAndAddModel = async () => {
    if (!selectedModel) {
      new Notice("Please select a model first");
      return;
    }

    setVerifyingModel(true);
    let verificationFailed = false;
    let verificationError = "";

    try {
      const apiKey = getApiKeyForProvider(selectedModel.provider);
      const customModel: CustomModel = {
        name: selectedModel.name,
        provider: selectedModel.provider,
        apiKey,
        enabled: true,
      };

      // Try to verify the model, but don't block on failure
      try {
        await ProjectManager.instance.getCurrentChainManager().chatModelManager.ping(customModel);
      } catch (error) {
        verificationFailed = true;
        verificationError = err2String(error);
        logError("Model verification failed:", error);
      }

      // Add the model regardless of verification result
      const existingModel = settings.activeModels.find(
        (model) => model.name === selectedModel.name && model.provider === selectedModel.provider
      );

      if (!existingModel) {
        const updatedModels = [...settings.activeModels, { ...customModel, apiKey: undefined }];
        updateSetting("activeModels", updatedModels);

        if (verificationFailed) {
          new Notice(
            `Model ${selectedModel.name} added to your models list (verification failed: ${verificationError})`,
            10000
          );
        } else {
          new Notice(
            `Model ${selectedModel.name} verified successfully and added to your models list!`
          );
        }
      } else {
        if (verificationFailed) {
          new Notice(
            `Model ${selectedModel.name} already exists in your models list (verification failed: ${verificationError})`,
            10000
          );
        } else {
          new Notice(
            `Model ${selectedModel.name} verified successfully! It already exists in your models list.`
          );
        }
      }
    } catch (error) {
      logError("Error adding model:", error);
      new Notice(`Failed to add model: ${err2String(error)}`, 10000);
    } finally {
      setVerifyingModel(false);
    }
  };

  return (
    <div className="tw-max-h-[600px] tw-overflow-y-auto tw-p-4 sm:tw-max-w-[500px]">
      <div className="tw-mb-4">
        <h2 className="tw-text-xl tw-font-bold">AI Provider Settings</h2>
        <p className="tw-text-sm tw-text-muted">
          Configure your AI providers by adding their API keys.
        </p>
      </div>

      <div className="tw-space-y-6 tw-py-4">
        <div className="tw-space-y-4">
          {providers.map((item: ProviderKeyItem) => (
            <React.Fragment key={item.provider}>
              <div className="tw-flex tw-flex-col tw-gap-2">
                <div className="tw-flex tw-items-end tw-gap-2 tw-font-medium">
                  <div className="tw-truncate">{getProviderLabel(item.provider)}</div>
                </div>
                <div className="tw-flex tw-flex-row tw-items-center tw-gap-2">
                  <div className="tw-flex-1">
                    <PasswordInput
                      className="tw-max-w-full"
                      value={item.apiKey}
                      onChange={(v) => handleApiKeyChange(item.provider, v)}
                    />
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
                      disabled={!item.apiKey}
                      variant="secondary"
                      className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-px-4 tw-py-2"
                    >
                      Add Model
                      {expandedProvider === item.provider ? (
                        <ChevronUp className="tw-ml-1 tw-size-4" />
                      ) : (
                        <ChevronDown className="tw-ml-1 tw-size-4" />
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
                      className="tw-text-[10px] tw-text-accent hover:tw-text-accent-hover sm:tw-text-xs"
                    >
                      Get {getProviderLabel(item.provider)} Key
                    </a>
                  )}
                </div>
              </div>
              <Collapsible open={expandedProvider === item.provider} className="tw-mt-2">
                <CollapsibleContent className="tw-rounded-md tw-p-3">
                  <div className="tw-flex tw-flex-col tw-gap-2">
                    <FormField
                      label="Model"
                      description="Add the currently selected model to model List. After adding, please check the Model Tab."
                    >
                      <div>
                        <div className="tw-flex tw-items-center tw-gap-2">
                          <div className="tw-flex-1">
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
                          <div className="tw-w-[72px]">
                            <Button
                              onClick={verifyAndAddModel}
                              disabled={
                                !selectedModel ||
                                selectedModel.provider !== item.provider ||
                                verifyingModel
                              }
                              variant="secondary"
                              size="sm"
                              className="tw-w-full tw-whitespace-nowrap"
                            >
                              {verifyingModel ? (
                                <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" />
                              ) : (
                                "Add"
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="tw-mt-1 tw-text-xs">
                          {loadingProvider === item.provider && (
                            <div className="tw-p-1 tw-text-muted">Loading models...</div>
                          )}
                          {errorProvider === item.provider && (
                            <div className="tw-p-1 tw-text-error">
                              Failed to load models.
                              {modelsByProvider[item.provider] === null &&
                                " Check API Key or network."}
                            </div>
                          )}
                          {modelsByProvider[item.provider] &&
                            modelsByProvider[item.provider]!.length === 0 && (
                              <div className="tw-p-1 tw-text-muted">
                                No models available for this provider.
                              </div>
                            )}
                          {modelsByProvider[item.provider] === undefined &&
                            errorProvider !== item.provider &&
                            loadingProvider !== item.provider && (
                              <div className="tw-p-1 tw-text-muted">
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

      <div className="tw-mt-4 tw-flex tw-justify-end">
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
