import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { err2String, getProviderInfo, getProviderLabel } from "@/utils";
import {
  ChatModelProviders,
  DisplayKeyProviders,
  EmbeddingModelProviders,
  Provider,
  ProviderInfo,
  ProviderSettingsKeyMap,
} from "@/constants";
import { Notice } from "obsidian";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { CustomModel } from "@/aiParams";
import { CopilotSettings } from "@/settings/model";

interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Readonly<CopilotSettings>;
  updateSetting: (key: string, value: any) => void;
  modalContainer: HTMLElement | null;
}

interface ProviderKeyItem {
  provider: DisplayKeyProviders;
  apiKey: string;
  isVerified: boolean;
}

const ApiKeyDialog: React.FC<ApiKeyDialogProps> = ({
  open,
  onOpenChange,
  settings,
  updateSetting,
  modalContainer,
}) => {
  const [verifyingProviders, setVerifyingProviders] = useState<Set<DisplayKeyProviders>>(new Set());
  const [unverifiedKeys, setUnverifiedKeys] = useState<Set<DisplayKeyProviders>>(new Set());

  // Get API key by provider
  const getApiKeyByProvider = (provider: DisplayKeyProviders): string => {
    const settingKey = ProviderSettingsKeyMap[provider];
    return (settings[settingKey] ?? "") as string;
  };

  // List of providers to exclude
  const excludeProviders: Provider[] = [
    ChatModelProviders.OPENAI_FORMAT,
    ChatModelProviders.OLLAMA,
    ChatModelProviders.LM_STUDIO,
    ChatModelProviders.AZURE_OPENAI,
    EmbeddingModelProviders.COPILOT_PLUS,
    EmbeddingModelProviders.COPILOT_PLUS_JINA,
  ];

  const providers: ProviderKeyItem[] = Object.entries(ProviderInfo)
    .filter(([key]) => !excludeProviders.includes(key as Provider))
    .map(([provider]) => {
      const providerKey = provider as DisplayKeyProviders;
      const apiKey = getApiKeyByProvider(providerKey);
      return {
        provider: providerKey,
        apiKey,
        isVerified: !!apiKey && !unverifiedKeys.has(providerKey),
      };
    });

  const handleApiKeyChange = (provider: DisplayKeyProviders, value: string) => {
    const currentKey = getApiKeyByProvider(provider);
    if (currentKey !== value) {
      updateSetting(ProviderSettingsKeyMap[provider], value);
      setUnverifiedKeys((prev) => new Set(prev).add(provider));
    }
  };

  const verifyApiKey = async (provider: DisplayKeyProviders, apiKey: string) => {
    setVerifyingProviders((prev) => new Set(prev).add(provider));
    try {
      if (settings.debug) console.log(`Verifying ${provider} API key:`, apiKey);
      const defaultTestModel = getProviderInfo(provider).testModel;

      if (!defaultTestModel) {
        new Notice(
          "API key verification failed: No default test model found for the selected provider."
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
      new Notice("API key verification failed: " + err2String(error));
    } finally {
      setVerifyingProviders((prev) => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent container={modalContainer} className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>AI Provider Settings</DialogTitle>
          <DialogDescription>
            Configure your AI providers by adding their API keys.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-4">
            {providers.map((item: ProviderKeyItem) => (
              <div key={item.provider} className="flex items-center gap-2">
                <div className="w-[120px] font-medium truncate">
                  {getProviderLabel(item.provider)}
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 pr-2">
                    <PasswordInput
                      className="w-full"
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
                        variant="outline"
                        size="sm"
                        className="w-full whitespace-nowrap"
                      >
                        {verifyingProviders.has(item.provider) ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Verify
                          </>
                        ) : (
                          "Verify"
                        )}
                      </Button>
                    ) : (
                      <span className="text-[#4CAF50] text-sm flex items-center justify-center h-9">
                        Verified
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ApiKeyDialog;
