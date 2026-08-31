import { SettingItem } from "@/components/ui/setting-item";
import type { SelfHostSearchProvider } from "@/settings/model";
import { ArrowUpRight } from "lucide-react";
import React from "react";
import { t } from "@/i18n";

interface SearchProviderConfig {
  apiKeyTitle: string;
  description: string;
  label: string;
  placeholder: string;
  signupUrl: string;
}

const SEARCH_PROVIDER_CONFIGS: Record<SelfHostSearchProvider, SearchProviderConfig> = {
  firecrawl: {
    apiKeyTitle: "Firecrawl API Key",
    description: "settings.selfHost.webSearch.firecrawl",
    label: "Firecrawl",
    placeholder: "fc-…",
    signupUrl: "https://firecrawl.link/logan-yang",
  },
  perplexity: {
    apiKeyTitle: "Perplexity API Key",
    description: "settings.selfHost.webSearch.perplexity",
    label: "Perplexity Sonar",
    placeholder: "pplx-…",
    signupUrl: "https://docs.perplexity.ai",
  },
  // Each provider owns a separate credential so switching providers cannot
  // expose one service's key to another. https://github.com/Brevilabs/obsidian-copilot-private/issues/285
  parallel: {
    apiKeyTitle: "Parallel API Key",
    description: "settings.selfHost.webSearch.parallel",
    label: "Parallel",
    placeholder: "parallel-…",
    signupUrl: "https://platform.parallel.ai/",
  },
  exa: {
    apiKeyTitle: "Exa API Key",
    description: "settings.selfHost.webSearch.exa",
    label: "Exa",
    placeholder: "exa-…",
    signupUrl: "https://dashboard.exa.ai/api-keys",
  },
};

const SEARCH_PROVIDER_OPTIONS = Object.entries(SEARCH_PROVIDER_CONFIGS).map(([value, config]) => ({
  label: config.label,
  value,
}));

export interface SelfHostWebSearchSettingsProps {
  apiKeys: Readonly<Record<SelfHostSearchProvider, string>>;
  disabled: boolean;
  onApiKeyChange: (provider: SelfHostSearchProvider, value: string) => void;
  onProviderChange: (provider: SelfHostSearchProvider) => void;
  provider: SelfHostSearchProvider;
}

/**
 * Presents provider selection and the selected provider's credential without
 * reading or writing plugin state.
 */
export const SelfHostWebSearchSettings: React.FC<SelfHostWebSearchSettingsProps> = ({
  apiKeys,
  disabled,
  onApiKeyChange,
  onProviderChange,
  provider,
}) => {
  const config = SEARCH_PROVIDER_CONFIGS[provider];

  return (
    <>
      <SettingItem
        type="select"
        title={t("settings.selfHost.webSearch.provider")}
        description={t("settings.selfHost.webSearch.providerDescription")}
        value={provider}
        onChange={(value) => onProviderChange(value as SelfHostSearchProvider)}
        options={SEARCH_PROVIDER_OPTIONS}
        disabled={disabled}
      />

      <SettingItem
        type="password"
        title={config.apiKeyTitle}
        description={
          <span>
            {t(config.description)}{" "}
            <a
              href={config.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tw-text-accent"
            >
              {t("settings.actions.signUp")}{" "}
              <ArrowUpRight className="tw-inline tw-size-3 tw-align-text-bottom" />
            </a>
          </span>
        }
        value={apiKeys[provider]}
        onChange={(value) => onApiKeyChange(provider, value)}
        placeholder={config.placeholder}
        disabled={disabled}
      />
    </>
  );
};
