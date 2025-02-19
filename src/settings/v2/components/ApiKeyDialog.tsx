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
import { SettingKeyProviders, ProviderSettingsKeyMap } from "@/constants";
import { CopilotSettings } from "@/settings/model";
import { err2String, getNeedSetKeyProvider, getProviderInfo, getProviderLabel } from "@/utils";
import { Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";
import ProjectManager from "@/LLMProviders/projectManager";

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

const ApiKeyDialog: React.FC<ApiKeyDialogProps> = ({
  open,
  onOpenChange,
  settings,
  updateSetting,
  modalContainer,
}) => {
  const [verifyingProviders, setVerifyingProviders] = useState<Set<SettingKeyProviders>>(new Set());
  const [unverifiedKeys, setUnverifiedKeys] = useState<Set<SettingKeyProviders>>(new Set());

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
  };

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
