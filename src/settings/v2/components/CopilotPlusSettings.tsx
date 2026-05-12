import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Badge } from "@/components/ui/badge";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SettingItem } from "@/components/ui/setting-item";
import { DEFAULT_SETTINGS } from "@/constants";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, getMiyoFolderName } from "@/miyo/miyoUtils";
import { useIsSelfHostEligible, validateSelfHostMode } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React, { useState } from "react";
import { ToolSettingsSection } from "./ToolSettingsSection";

export const CopilotPlusSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [isValidatingSelfHost, setIsValidatingSelfHost] = useState(false);
  const isSelfHostEligible = useIsSelfHostEligible();

  /**
   * Toggle self-host mode and handle validation requirements.
   *
   * @param enabled - Whether self-host mode should be enabled.
   */
  const handleSelfHostModeToggle = async (enabled: boolean) => {
    if (enabled) {
      setIsValidatingSelfHost(true);
      const isValid = await validateSelfHostMode();
      setIsValidatingSelfHost(false);
      if (!isValid) {
        // Validation failed - Notice already shown by validateSelfHostMode
        return;
      }
      updateSetting("enableSelfHostMode", true);
    } else {
      updateSetting("enableSelfHostMode", false);
      updateSetting("enableMiyo", false);
    }
  };

  /**
   * Toggle Miyo-backed semantic search and refresh the index when enabling.
   *
   * @param enabled - Whether Miyo search should be enabled.
   */
  const handleMiyoSearchToggle = async (enabled: boolean) => {
    if (enabled === settings.enableMiyo) {
      return;
    }

    if (!enabled) {
      updateSetting("enableMiyo", false);
      return;
    }

    setIsValidatingSelfHost(true);
    try {
      const miyoClient = new MiyoClient();
      const isMiyoAvailable = await miyoClient.isBackendAvailable(getMiyoCustomUrl(settings));
      if (!isMiyoAvailable) {
        new Notice("Miyo app is not available. Please start the Miyo app and try again.");
        return;
      }
    } finally {
      setIsValidatingSelfHost(false);
    }

    const confirmChange = async () => {
      if (enabled && settings.embeddingBatchSize !== DEFAULT_SETTINGS.embeddingBatchSize) {
        updateSetting("embeddingBatchSize", DEFAULT_SETTINGS.embeddingBatchSize);
      }

      updateSetting("enableMiyo", enabled);

      if (enabled && !settings.enableSemanticSearchV3) {
        updateSetting("enableSemanticSearchV3", true);
      }

      if (settings.enableSemanticSearchV3 || enabled) {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        await VectorStoreManager.getInstance().indexVaultToVectorStore(false, {
          userInitiated: true,
        });
      }
    };

    new ConfirmModal(
      app,
      confirmChange,
      `Enabling Miyo Search will use your current vault folder name as the Miyo folder identifier and request a scan from Miyo. Make sure this folder is already registered in Miyo. Embedding Batch Size will be reset to the default (${DEFAULT_SETTINGS.embeddingBatchSize}) for local stability. Continue?`,
      "Request Miyo Scan"
    ).open();
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <section className="tw-flex tw-flex-col tw-gap-4">
        <div className="tw-flex tw-items-center tw-py-4">
          <Badge variant="secondary" className="tw-text-accent">
            Plus Required
          </Badge>
        </div>
        <div className="tw-flex tw-flex-col tw-gap-4">
          <div className="tw-pt-4 tw-text-xl tw-font-semibold">Autonomous Agent</div>

          <SettingItem
            type="switch"
            title="Enable Autonomous Agent"
            description="Enable autonomous agent mode in Plus chat. The AI will reason step-by-step and decide which tools to use automatically, improving response quality for complex queries."
            checked={settings.enableAutonomousAgent}
            onCheckedChange={(checked) => {
              updateSetting("enableAutonomousAgent", checked);
            }}
          />

          {settings.enableAutonomousAgent && (
            <>
              <ToolSettingsSection />
            </>
          )}

          <div className="tw-pt-4 tw-text-xl tw-font-semibold">Document Processor</div>

          <SettingItem
            type="text"
            title="Store converted markdown at"
            description="When PDFs and other documents are processed, the converted markdown is saved to this folder. Leave empty to skip saving."
            value={settings.convertedDocOutputFolder}
            onChange={(value) => {
              updateSetting("convertedDocOutputFolder", value);
            }}
            placeholder="e.g. copilot/converteddocs"
          />

          <div className="tw-pt-4 tw-text-xl tw-font-semibold">Memory (experimental)</div>

          <SettingItem
            type="text"
            title="Memory Folder Name"
            description="Specify the folder where memory data is stored."
            value={settings.memoryFolderName}
            onChange={(value) => {
              updateSetting("memoryFolderName", value);
            }}
            placeholder="copilot/memory"
          />

          <SettingItem
            type="switch"
            title="Reference Recent Conversation"
            description="When enabled, Copilot references your recent conversation history to provide more contextually relevant responses. All history data is stored locally in your vault."
            checked={settings.enableRecentConversations}
            onCheckedChange={(checked) => {
              updateSetting("enableRecentConversations", checked);
            }}
          />

          {settings.enableRecentConversations && (
            <SettingItem
              type="slider"
              title="Max Recent Conversations"
              description="Number of recent conversations to remember for context. Higher values provide more context but may slow down responses."
              min={10}
              max={50}
              step={1}
              value={settings.maxRecentConversations}
              onChange={(value) => updateSetting("maxRecentConversations", value)}
            />
          )}

          <SettingItem
            type="switch"
            title="Reference Saved Memories"
            description="When enabled, Copilot can access memories that you explicitly asked it to remember. Use this to store important facts, preferences, or context for future conversations."
            checked={settings.enableSavedMemory}
            onCheckedChange={(checked) => {
              updateSetting("enableSavedMemory", checked);
            }}
          />

          {isSelfHostEligible && (
            <>
              <div className="tw-flex tw-items-center tw-gap-1.5 tw-pt-4 tw-text-xl tw-font-semibold">
                Self-Host Mode
                <HelpTooltip content="Lifetime license required" />
              </div>

              <SettingItem
                type="switch"
                title="Enable Self-Host Mode"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">
                      Use your own infrastructure for LLMs, embeddings and local document
                      understanding with our desktop app Miyo.
                    </span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                          <div className="tw-text-sm tw-font-medium tw-text-accent">
                            Self-Host Mode (Believer/Supporter only)
                          </div>
                          <div className="tw-text-xs tw-text-muted">
                            Connect to your own self-hosted backend (e.g., Miyo) for complete
                            control over your AI infrastructure. This allows offline usage and
                            custom model deployments.
                          </div>
                          <div className="tw-text-xs tw-text-muted">
                            Requires re-validation every 15 days when online.
                          </div>
                        </div>
                      }
                    />
                  </div>
                }
                checked={settings.enableSelfHostMode}
                onCheckedChange={(checked) => void handleSelfHostModeToggle(checked)}
                disabled={isValidatingSelfHost}
              />

              {settings.enableSelfHostMode && (
                <>
                  <SettingItem
                    type="text"
                    title="Remote Miyo Server URL (Optional)"
                    description="Leave blank when accessing Miyo locally. Set this only when Miyo is running on a remote machine — it will override the local service discovery."
                    value={settings.miyoServerUrl || ""}
                    onChange={(value) => updateSetting("miyoServerUrl", value)}
                  />

                  <SettingItem
                    type="switch"
                    title="Enable Miyo"
                    description="Use Miyo as your local search, PDF parsing, and context hub. Copilot will send the current vault folder name to Miyo and can request scans, but folder registration is managed in Miyo."
                    checked={settings.enableMiyo}
                    onCheckedChange={(checked) => void handleMiyoSearchToggle(checked)}
                    disabled={isValidatingSelfHost}
                  />

                  {settings.enableMiyo && (
                    <>
                      <SettingItem
                        type="switch"
                        title="Search everything in Miyo"
                        description="When enabled, Miyo searches all indexed content across all folders. When disabled, searches are limited to the current vault folder only."
                        checked={settings.miyoSearchAll}
                        onCheckedChange={(checked) => updateSetting("miyoSearchAll", checked)}
                      />

                      {!settings.miyoSearchAll && (
                        <div className="tw-text-xs tw-text-muted">
                          Folder identifier sent to Miyo:{" "}
                          <span className="tw-font-medium tw-text-normal">
                            {getMiyoFolderName(app)}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  <SettingItem
                    type="select"
                    title="Web Search Provider"
                    description="Choose which service to use for self-host web search."
                    value={settings.selfHostSearchProvider}
                    onChange={(value) =>
                      updateSetting("selfHostSearchProvider", value as "firecrawl" | "perplexity")
                    }
                    options={[
                      { label: "Firecrawl (default)", value: "firecrawl" },
                      { label: "Perplexity Sonar", value: "perplexity" },
                    ]}
                  />

                  {settings.selfHostSearchProvider === "firecrawl" && (
                    <SettingItem
                      type="password"
                      title="Firecrawl API Key"
                      description={
                        <span>
                          API key for web search via Firecrawl.{" "}
                          <a
                            href="https://firecrawl.link/logan-yang"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tw-text-accent"
                          >
                            Sign up &rarr;
                          </a>
                        </span>
                      }
                      value={settings.firecrawlApiKey}
                      onChange={(value) => updateSetting("firecrawlApiKey", value)}
                      placeholder="fc-..."
                    />
                  )}

                  {settings.selfHostSearchProvider === "perplexity" && (
                    <SettingItem
                      type="password"
                      title="Perplexity API Key"
                      description={
                        <span>
                          API key for web search via Perplexity Sonar.{" "}
                          <a
                            href="https://docs.perplexity.ai"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tw-text-accent"
                          >
                            Get API key &rarr;
                          </a>
                        </span>
                      }
                      value={settings.perplexityApiKey}
                      onChange={(value) => updateSetting("perplexityApiKey", value)}
                      placeholder="pplx-..."
                    />
                  )}

                  <SettingItem
                    type="password"
                    title="Supadata API Key"
                    description={
                      <span>
                        API key for YouTube transcripts via Supadata.{" "}
                        <a
                          href="https://supadata.ai/?ref=obcopilot"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tw-text-accent"
                        >
                          Sign up &rarr;
                        </a>
                      </span>
                    }
                    value={settings.supadataApiKey}
                    onChange={(value) => updateSetting("supadataApiKey", value)}
                    placeholder="sd-..."
                  />
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
};
