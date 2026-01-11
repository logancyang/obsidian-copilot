import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { PasswordInput } from "@/components/ui/password-input";
import { ProviderSettingsKeyMap, SettingKeyProviders } from "@/constants";
import { updateSetting } from "@/settings/model";
import { GitHubCopilotAuth } from "@/settings/v2/components/GitHubCopilotAuth";
import { LocalServicesSection } from "@/settings/v2/components/LocalServicesSection";
import { ModelImporter } from "@/settings/v2/components/ModelImporter";
import { getNeedSetKeyProvider, getProviderInfo, getProviderLabel } from "@/utils";
import { ChevronDown, ChevronRight, ChevronUp, Info } from "lucide-react";
import { getApiKeyForProvider } from "@/utils/modelUtils";
import { App, Modal } from "obsidian";
import React, { useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface ApiKeyModalContentProps {
  onClose: () => void;
  onGoToModelTab?: () => void;
}

interface ProviderKeyItem {
  provider: SettingKeyProviders;
  apiKey: string;
}

function ApiKeyModalContent({ onClose, onGoToModelTab }: ApiKeyModalContentProps) {
  const [expandedProvider, setExpandedProvider] = useState<SettingKeyProviders | null>(null);

  useEffect(() => {
    setExpandedProvider(null);
  }, []);

  const providers: ProviderKeyItem[] = getNeedSetKeyProvider().map((provider) => {
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
    }
  };

  return (
    <div className="tw-p-4 sm:tw-max-w-[500px]">
      <div className="tw-mb-4">
        <h2 className="tw-text-xl tw-font-bold">AI Provider Settings</h2>
        <p className="tw-text-sm tw-text-muted">
          Configure your AI providers by adding their API keys.
        </p>
      </div>

      <div className="tw-space-y-6 tw-py-4">
        <div className="tw-space-y-4">
          {providers.map((item: ProviderKeyItem) => {
            const providerInfo = getProviderInfo(item.provider);
            const supportsModelImport = Boolean(providerInfo.listModelURL);
            const isExpanded = expandedProvider === item.provider;

            return (
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
                    {supportsModelImport && (
                      <div>
                        <Button
                          onClick={() => {
                            setExpandedProvider(isExpanded ? null : item.provider);
                          }}
                          disabled={!item.apiKey}
                          variant="secondary"
                          className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-px-4 tw-py-2"
                        >
                          Add Model
                          {isExpanded ? (
                            <ChevronUp className="tw-ml-1 tw-size-4" />
                          ) : (
                            <ChevronDown className="tw-ml-1 tw-size-4" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                  <div>
                    {providerInfo.keyManagementURL && (
                      <a
                        href={providerInfo.keyManagementURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tw-text-[10px] tw-text-accent hover:tw-text-accent-hover sm:tw-text-xs"
                      >
                        Get {getProviderLabel(item.provider)} Key
                      </a>
                    )}
                  </div>
                </div>
                {supportsModelImport && (
                  <Collapsible open={isExpanded} className="tw-mt-2">
                    <CollapsibleContent className="tw-rounded-md tw-p-3">
                      <ModelImporter
                        provider={item.provider}
                        isReady={Boolean(item.apiKey)}
                        expanded={isExpanded}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* GitHub Copilot Section */}
        <GitHubCopilotAuth />

        {/* Local Services Section */}
        <LocalServicesSection />

        {/* Advanced configuration guide */}
        {onGoToModelTab && (
          <div className="tw-mt-4 tw-border-t tw-border-border tw-pt-4">
            <div className="tw-rounded-lg tw-border tw-p-4 tw-bg-secondary/30 tw-border-border/60">
              <div className="tw-flex tw-gap-3">
                <div className="tw-mt-0.5 tw-shrink-0">
                  <Info className="tw-size-5 tw-text-accent" />
                </div>
                <div className="tw-flex-1">
                  <h4 className="tw-mb-1 tw-text-sm tw-font-semibold">
                    Looking for Azure OpenAI or Custom Providers?
                  </h4>
                  <p className="tw-mb-3 tw-text-xs tw-leading-relaxed tw-text-muted">
                    Providers like Azure OpenAI, OpenAI Format, or Local LLMs require additional
                    configuration (Base URL, Deployment Name, etc.).
                  </p>
                  <button
                    onClick={() => {
                      onGoToModelTab();
                      onClose();
                    }}
                    className="tw-group tw-flex tw-items-center tw-gap-1 tw-text-sm tw-font-medium tw-text-accent hover:tw-text-accent-hover"
                  >
                    Go to Model Settings
                    <ChevronRight className="tw-size-4 tw-transition-transform group-hover:tw-translate-x-0.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="tw-mt-4 tw-flex tw-justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export class ApiKeyDialog extends Modal {
  private root: Root;
  private onGoToModelTab?: () => void;

  constructor(app: App, onGoToModelTab?: () => void) {
    super(app);
    this.onGoToModelTab = onGoToModelTab;
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    this.root.render(
      <ApiKeyModalContent onClose={() => this.close()} onGoToModelTab={this.onGoToModelTab} />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
