import { Badge } from "@/components/ui/badge";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SettingItem } from "@/components/ui/setting-item";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { useIsSelfHostEligible, validateSelfHostMode } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
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
      if (settings.enableMiyoSearch) {
        updateSetting("enableMiyoSearch", false);
      }
    }
  };

  /**
   * Toggle Miyo-backed semantic search and trigger a full reindex when needed.
   *
   * @param enabled - Whether Miyo search should be enabled.
   */
  const handleMiyoSearchToggle = async (enabled: boolean) => {
    if (enabled === settings.enableMiyoSearch) {
      return;
    }

    const confirmChange = async () => {
      updateSetting("enableMiyoSearch", enabled);

      if (enabled && !settings.enableSemanticSearchV3) {
        updateSetting("enableSemanticSearchV3", true);
      }

      if (settings.enableSemanticSearchV3 || enabled) {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        await VectorStoreManager.getInstance().indexVaultToVectorStore(true);
      }
    };

    new RebuildIndexConfirmModal(app, confirmChange).open();
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
                  Use your own infrastructure for LLMs, embeddings (and local document understanding
                  soon with our upcoming desktop app).
                </span>
                <HelpTooltip
                  content={
                    <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                      <div className="tw-text-sm tw-font-medium tw-text-accent">
                        Self-Host Mode (Believer/Supporter only)
                      </div>
                      <div className="tw-text-xs tw-text-muted">
                        Connect to your own self-hosted backend (e.g., Miyo) for complete control
                        over your AI infrastructure. This allows offline usage and custom model
                        deployments.
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
            onCheckedChange={handleSelfHostModeToggle}
            disabled={!isSelfHostEligible || isValidatingSelfHost}
          />

          {settings.enableSelfHostMode && (
            <SettingItem
              type="switch"
              title="Enable Miyo Search"
              description="Use your Miyo backend for semantic indexing and retrieval while preserving Search v3 lexical merging. Enabling this will prompt you to force refresh the index so data is stored in Miyo."
              checked={settings.enableMiyoSearch}
              onCheckedChange={handleMiyoSearchToggle}
            />
          )}
        </div>
      </section>
    </div>
  );
};
