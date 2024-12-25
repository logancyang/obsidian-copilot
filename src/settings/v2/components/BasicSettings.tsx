import React, { useState } from "react";
import { getModelKeyFromModel, updateSetting, useSettingsValue } from "@/settings/model";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingItem } from "@/components/ui/setting-item";
import { Button } from "@/components/ui/button";
import { ArrowRight, HelpCircle, Loader2 } from "lucide-react";
import { useTab } from "@/contexts/TabContext";
import {
  ChatModelProviders,
  DisplayKeyProviders,
  EmbeddingModelProviders,
  ProviderInfo,
  ProviderMetadata,
  ProviderSettingsKeyMap,
  VAULT_VECTOR_STORE_STRATEGIES,
} from "@/constants";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { err2String, getProviderInfo, getProviderLabel, omit } from "@/utils";
import { CustomModel } from "@/aiParams";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { Notice } from "obsidian";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { PasswordInput } from "@/components/ui/password-input";

interface BasicSettingsProps {
  indexVaultToVectorStore(overwrite?: boolean): Promise<number>;
}

const BasicSettings: React.FC<BasicSettingsProps> = ({ indexVaultToVectorStore }) => {
  const { setSelectedTab, modalContainer } = useTab();
  const settings = useSettingsValue();
  const [selectedProvider, setSelectedProvider] = useState<DisplayKeyProviders | undefined>();
  const [apiKey, setApiKey] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState(false);

  const getApiKeyByProvider = (provider: DisplayKeyProviders): string => {
    const settingKey = ProviderSettingsKeyMap[provider];
    return (settings[settingKey] ?? "") as string;
  };

  const handleProviderChange = (value: DisplayKeyProviders) => {
    setSelectedProvider(value);
    setApiKey(getApiKeyByProvider(value));
  };

  const verifyApiKey = async () => {
    if (!selectedProvider || !apiKey) return;

    setIsVerifying(true);
    try {
      if (settings.debug) console.log(`Verifying ${selectedProvider} API key:`, apiKey);
      const defaultTestModel = getProviderInfo(selectedProvider).testModel;

      if (!defaultTestModel) {
        new Notice(
          "API key verification failed: No default test model found for the selected provider."
        );
        return;
      }

      const customModel: CustomModel = {
        name: defaultTestModel,
        provider: selectedProvider,
        apiKey,
        enabled: true,
      };
      await ChatModelManager.getInstance().ping(customModel);
      updateSetting(ProviderSettingsKeyMap[selectedProvider], apiKey);
    } catch (error) {
      console.error("API key verification failed:", error);
      new Notice("API key verification failed: " + err2String(error));
    } finally {
      setIsVerifying(false);
    }
  };

  const excludeProviders = [
    ChatModelProviders.OPENAI_FORMAT,
    ChatModelProviders.OLLAMA,
    ChatModelProviders.LM_STUDIO,
    ChatModelProviders.AZURE_OPENAI,
    EmbeddingModelProviders.COPILOT_PLUS,
  ];
  const selectProvider: [string, ProviderMetadata][] = Object.entries(
    omit(ProviderInfo, excludeProviders)
  );

  const handleSetDefaultEmbeddingModel = async (modelKey: string) => {
    if (modelKey !== settings.embeddingModelKey) {
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("embeddingModelKey", modelKey);
        await indexVaultToVectorStore(true);
      }).open();
    }
  };

  return (
    <div className="space-y-4">
      {/* General Section */}
      <section>
        <div className="text-2xl font-bold mb-3">General</div>
        <div className="space-y-4">
          {/* API Key Section */}
          <SettingItem
            type="custom"
            title="API Key"
            description="Enter API key for selected provider"
          >
            <div className="flex items-center gap-1.5 w-[320px]">
              <Select
                value={selectedProvider}
                onValueChange={handleProviderChange}
                disabled={isVerifying}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent container={modalContainer}>
                  <SelectGroup>
                    {selectProvider.map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <PasswordInput
                className={`transition-all duration-200 flex-grow min-w-[80px] ${isVerifying ? "w-[80px]" : "w-[120px]"}`}
                placeholder="API key"
                value={apiKey}
                onChange={(v) => setApiKey(v)}
                disabled={isVerifying}
              />

              <Button
                onClick={verifyApiKey}
                disabled={!selectedProvider || !apiKey || isVerifying}
                variant="outline"
                size="sm"
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
          </SettingItem>
          {/* copilot-plus */}
          <SettingItem
            type="password"
            title="Copilot Plus License Key"
            description={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Enter your Copilot Plus license key</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <HelpCircle className="h-5 w-5 sm:h-4 sm:w-4 cursor-pointer text-muted hover:text-accent translate-y-[1px]" />
                  </PopoverTrigger>
                  <PopoverContent
                    container={modalContainer}
                    className="w-[90vw] max-w-[400px] p-2 sm:p-3"
                    side="bottom"
                    align="center"
                    sideOffset={0}
                  >
                    <div className="space-y-2 sm:space-y-2.5">
                      <p className="text-[11px] sm:text-xs">
                        Copilot Plus brings powerful AI agent capabilities to Obsidian. Alpha access
                        is limited to sponsors and early supporters. Learn more at{" "}
                        <a
                          href="https://obsidiancopilot.com"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          https://obsidiancopilot.com
                        </a>
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            }
            value={settings.plusLicenseKey}
            onChange={(value) => {
              updateSetting("plusLicenseKey", value);
            }}
          />
        </div>
      </section>

      {/* Chat Section */}
      <section>
        <div className="text-2xl font-bold mb-4">Chat</div>
        <div className="space-y-4">
          <SettingItem
            type="select"
            title="Chat Model"
            description="Select the Chat model to use"
            value={settings.defaultModelKey}
            onChange={(value) => {
              updateSetting("defaultModelKey", value);
            }}
            options={settings.activeModels
              .filter((m) => m.enabled)
              .map((model) => ({
                label: `${model.name} (${getProviderLabel(model.provider)})`,
                value: getModelKeyFromModel(model),
              }))}
            placeholder="Model"
          />

          <div className="flex justify-end -mt-2">
            <Button onClick={() => setSelectedTab("model")} variant="outline">
              More Model Settings
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* QA Settings Section */}
      <section>
        <div className="text-2xl font-bold mb-4">QA Settings/Embeddings</div>
        <div className="space-y-4">
          <SettingItem
            type="select"
            title="Embedding Model"
            description="Select the Embedding model to use"
            value={settings.embeddingModelKey}
            onChange={handleSetDefaultEmbeddingModel}
            options={settings.activeEmbeddingModels
              .filter((m) => m.enabled)
              .map((model) => ({
                label: `${model.name} (${getProviderLabel(model.provider)})`,
                value: getModelKeyFromModel(model),
              }))}
            placeholder="Model"
          />

          <SettingItem
            type="select"
            title="Auto-Index Strategy"
            description={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Decide when you want the vault to be indexed.</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <HelpCircle className="h-5 w-5 sm:h-4 sm:w-4 cursor-pointer text-muted hover:text-accent translate-y-[1px]" />
                  </PopoverTrigger>
                  <PopoverContent
                    container={modalContainer}
                    className="w-[90vw] max-w-[400px] p-2 sm:p-3"
                    side="bottom"
                    align="center"
                    sideOffset={0}
                  >
                    <div className="space-y-2 sm:space-y-2.5">
                      {/* Warning Alert */}
                      <div className="rounded bg-callout-warning/10  p-1.5 sm:p-2 ring-ring">
                        <p className="text-callout-warning text-xs sm:text-sm">
                          Warning: Cost implications for large vaults with paid models
                        </p>
                      </div>

                      {/* Main Description */}
                      <div className="space-y-1 sm:space-y-1.5">
                        <p className="text-muted text-[11px] sm:text-xs">
                          Choose when to index your vault:
                        </p>

                        <ul className="space-y-1 pl-2 sm:pl-3 list-disc text-[11px] sm:text-xs">
                          <li>
                            <strong className="inline-block whitespace-nowrap">NEVER：</strong>
                            <span>Manual indexing via command or refresh only</span>
                          </li>

                          <li>
                            <strong className="inline-block whitespace-nowrap">ON STARTUP：</strong>
                            <span>Index updates when plugin loads or reloads</span>
                          </li>

                          <li>
                            <strong className="inline-block whitespace-nowrap">
                              ON MODE SWITCH：
                            </strong>
                            <span>Updates when entering QA mode (Recommended)</span>
                          </li>
                        </ul>
                      </div>

                      {/* Additional Notes */}
                      <div className="text-[10px] sm:text-[11px] text-muted space-y-0.5 sm:space-y-1 border-t pt-1.5 sm:pt-2">
                        <p>
                          "Refreshed" updates the vault index incrementally. Use the commands
                          "Clear" + "Force re-index" for full rebuild
                        </p>
                        <p>Use "Count tokens" to check potential costs</p>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            }
            value={settings.indexVaultToVectorStore}
            onChange={(value) => {
              updateSetting("indexVaultToVectorStore", value);
            }}
            options={VAULT_VECTOR_STORE_STRATEGIES.map((strategy) => ({
              label: strategy,
              value: strategy,
            }))}
            placeholder="Strategy"
          />
        </div>
      </section>
    </div>
  );
};

export default BasicSettings;
