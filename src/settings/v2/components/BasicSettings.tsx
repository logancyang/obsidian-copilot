import { ChainType } from "@/chainFactory";
import { isCommandEnabled } from "@/commands";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSwitch } from "@/components/ui/setting-switch";
import {
  COMMAND_NAMES,
  DEFAULT_OPEN_AREA,
  DISABLEABLE_COMMANDS,
  PLUS_UTM_MEDIUMS,
} from "@/constants";
import { useTab } from "@/contexts/TabContext";
import { getModelKeyFromModel, updateSetting, useSettingsValue } from "@/settings/model";
import { formatDateTime, getProviderLabel } from "@/utils";
import { HelpCircle, Key, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";
import ApiKeyDialog from "./ApiKeyDialog";
import { PlusSettings } from "@/settings/v2/components/PlusSettings";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createPlusPageUrl } from "@/plusUtils";
const ChainType2Label: Record<ChainType, string> = {
  [ChainType.LLM_CHAIN]: "Chat",
  [ChainType.VAULT_QA_CHAIN]: "Vault QA (Basic)",
  [ChainType.COPILOT_PLUS_CHAIN]: "Copilot Plus (beta)",
};

interface BasicSettingsProps {
  indexVaultToVectorStore(overwrite?: boolean): Promise<number>;
}

const BasicSettings: React.FC<BasicSettingsProps> = ({ indexVaultToVectorStore }) => {
  const { modalContainer } = useTab();
  const settings = useSettingsValue();
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [conversationNoteName, setConversationNoteName] = useState(
    settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}"
  );

  const handleSetDefaultEmbeddingModel = async (modelKey: string) => {
    if (modelKey !== settings.embeddingModelKey) {
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("embeddingModelKey", modelKey);
        await indexVaultToVectorStore(true);
      }).open();
    }
  };

  const applyCustomNoteFormat = () => {
    setIsChecking(true);

    try {
      // Check required variables
      const format = conversationNoteName || "{$date}_{$time}__{$topic}";
      const requiredVars = ["{$date}", "{$time}", "{$topic}"];
      const missingVars = requiredVars.filter((v) => !format.includes(v));

      if (missingVars.length > 0) {
        new Notice(`Error: Missing required variables: ${missingVars.join(", ")}`, 4000);
        return;
      }

      // Check illegal characters (excluding variable placeholders)
      const illegalChars = /[\\/:*?"<>|]/;
      const formatWithoutVars = format
        .replace(/\{\$date}/g, "")
        .replace(/\{\$time}/g, "")
        .replace(/\{\$topic}/g, "");

      if (illegalChars.test(formatWithoutVars)) {
        new Notice(`Error: Format contains illegal characters (\\/:*?"<>|)`, 4000);
        return;
      }

      // Generate example filename
      const { fileName: timestampFileName } = formatDateTime(new Date());
      const firstTenWords = "test topic name";

      // Create example filename
      const customFileName = format
        .replace("{$topic}", firstTenWords.slice(0, 100).replace(/\s+/g, "_"))
        .replace("{$date}", timestampFileName.split("_")[0])
        .replace("{$time}", timestampFileName.split("_")[1]);

      // Save settings
      updateSetting("defaultConversationNoteName", format);
      setConversationNoteName(format);
      new Notice(`Format applied successfully! Example: ${customFileName}`, 4000);
    } catch (error) {
      new Notice(`Error applying format: ${error.message}`, 4000);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <PlusSettings />

      {/* General Section */}
      <section>
        <div className="text-xl font-bold mb-3">General</div>
        <div className="space-y-4">
          <div className="space-y-4">
            {/* API Key Section */}
            <SettingItem
              type="custom"
              title="API Keys"
              description={
                <div className="flex items-center gap-1.5">
                  <span className="leading-none">
                    Configure API keys for different AI providers
                  </span>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-96 flex flex-col gap-2 py-4">
                        <div className="text-sm font-medium text-accent">
                          API key required for chat and QA features
                        </div>
                        <div className="text-xs text-muted">
                          To enable chat and QA functionality, please provide an API key from your
                          selected provider.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <Button
                onClick={() => setIsApiKeyDialogOpen(true)}
                variant="outline"
                className="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start"
              >
                Set Keys
                <Key className="h-4 w-4" />
              </Button>
            </SettingItem>

            {/* API Key Dialog */}
            <ApiKeyDialog
              open={isApiKeyDialogOpen}
              onOpenChange={setIsApiKeyDialogOpen}
              settings={settings}
              updateSetting={updateSetting}
              modalContainer={modalContainer}
            />
          </div>
          <SettingItem
            type="select"
            title="Default Chat Model"
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

          <SettingItem
            type="select"
            title="Embedding Model"
            description={
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="leading-none font-medium text-accent">
                    Core Feature: Powers Semantic Search & QA
                  </span>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-96 flex flex-col gap-2">
                        <div className="text-sm text-muted pt-2">
                          This model converts text into vector representations, essential for
                          semantic search and QA functionality. Changing the embedding model will:
                        </div>
                        <ul className="text-sm text-muted pl-4">
                          <li>Require rebuilding your vault&#39;s vector index</li>
                          <li>Affect semantic search quality</li>
                          <li>Impact QA feature performance</li>
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            }
            value={settings.embeddingModelKey}
            onChange={handleSetDefaultEmbeddingModel}
            options={settings.activeEmbeddingModels.map((model) => ({
              label: `${model.name} (${getProviderLabel(model.provider)})`,
              value: getModelKeyFromModel(model),
            }))}
            placeholder="Model"
          />

          {/* Basic Configuration Group */}
          <SettingItem
            type="select"
            title="Default Mode"
            description={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Select the default chat mode</span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-96 flex flex-col gap-2">
                      <ul className="text-sm text-muted pl-4">
                        <li>
                          <strong>Chat:</strong> Regular chat mode for general conversations and
                          tasks. <i>Free to use with your own API key.</i>
                        </li>
                        <li>
                          <strong>Vault QA (Basic):</strong> Ask questions about your vault content
                          with semantic search. <i>Free to use with your own API key.</i>
                        </li>
                        <li>
                          <strong>Copilot Plus:</strong> Covers all features of the 2 free modes,
                          plus advanced paid features including chat context menu, advanced search,
                          AI agents, and more. Check out{" "}
                          <a
                            href={createPlusPageUrl(PLUS_UTM_MEDIUMS.MODE_SELECT_TOOLTIP)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:text-accent-hover"
                          >
                            obsidiancopilot.com
                          </a>{" "}
                          for more details.
                        </li>
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            }
            value={settings.defaultChainType}
            onChange={(value) => updateSetting("defaultChainType", value as ChainType)}
            options={Object.entries(ChainType2Label).map(([key, value]) => ({
              label: value,
              value: key,
            }))}
          />

          <SettingItem
            type="select"
            title="Open Plugin In"
            description="Choose where to open the plugin"
            value={settings.defaultOpenArea}
            onChange={(value) => updateSetting("defaultOpenArea", value as DEFAULT_OPEN_AREA)}
            options={[
              { label: "Sidebar View", value: DEFAULT_OPEN_AREA.VIEW },
              { label: "Editor", value: DEFAULT_OPEN_AREA.EDITOR },
            ]}
          />

          <SettingItem
            type="text"
            title="Default Conversation Folder Name"
            description="The default folder name where chat conversations will be saved. Default is 'copilot-conversations'"
            value={settings.defaultSaveFolder}
            onChange={(value) => updateSetting("defaultSaveFolder", value)}
            placeholder="copilot-conversations"
          />

          <SettingItem
            type="text"
            title="Custom Prompts Folder Name"
            description="The default folder name where custom prompts will be saved. Default is 'copilot-custom-prompts'"
            value={settings.customPromptsFolder}
            onChange={(value) => updateSetting("customPromptsFolder", value)}
            placeholder="copilot-custom-prompts"
          />

          <SettingItem
            type="text"
            title="Default Conversation Tag"
            description="The default tag to be used when saving a conversation. Default is 'ai-conversations'"
            value={settings.defaultConversationTag}
            onChange={(value) => updateSetting("defaultConversationTag", value)}
            placeholder="ai-conversations"
          />

          <SettingItem
            type="custom"
            title="Conversation Filename Template"
            description={
              <div className="flex items-start gap-1.5 ">
                <span className="leading-none">
                  Customize the format of saved conversation note names.
                </span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-96 flex flex-col gap-2 py-4">
                      <div className="text-sm font-medium text-accent">
                        Note: All the following variables must be included in the template.
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted">Available variables:</div>
                        <ul className="text-sm text-muted pl-4">
                          <li>
                            <strong>{"{$date}"}</strong>: Date in YYYYMMDD format
                          </li>
                          <li>
                            <strong>{"{$time}"}</strong>: Time in HHMMSS format
                          </li>
                          <li>
                            <strong>{"{$topic}"}</strong>: Chat conversation topic
                          </li>
                        </ul>
                        <i className="text-sm text-muted mt-2">
                          Example: {"{$date}_{$time}__{$topic}"} →
                          20250114_153232__polish_this_article_[[Readme]]
                        </i>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            }
          >
            <div className="flex items-center gap-1.5 w-[320px]">
              <Input
                type="text"
                className={`transition-all duration-200 flex-grow min-w-[80px] ${isChecking ? "w-[80px]" : "w-[120px]"}`}
                placeholder="{$date}_{$time}__{$topic}"
                value={conversationNoteName}
                onChange={(e) => setConversationNoteName(e.target.value)}
                disabled={isChecking}
              />

              <Button
                onClick={() => applyCustomNoteFormat()}
                disabled={isChecking}
                variant="outline"
                size="sm"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Apply
                  </>
                ) : (
                  "Apply"
                )}
              </Button>
            </div>
          </SettingItem>

          {/* Feature Toggle Group */}
          <SettingItem
            type="switch"
            title="Autosave Chat"
            description="Automatically save the chat when starting a new one or when the plugin reloads"
            checked={settings.autosaveChat}
            onCheckedChange={(checked) => updateSetting("autosaveChat", checked)}
          />

          <SettingItem
            type="switch"
            title="Suggested Prompts"
            description="Show suggested prompts in the chat view"
            checked={settings.showSuggestedPrompts}
            onCheckedChange={(checked) => updateSetting("showSuggestedPrompts", checked)}
          />

          <SettingItem
            type="switch"
            title="Relevant Notes"
            description="Show relevant notes in the chat view"
            checked={settings.showRelevantNotes}
            onCheckedChange={(checked) => updateSetting("showRelevantNotes", checked)}
          />

          {/* Advanced Configuration Group */}
          <SettingItem
            type="dialog"
            title="Command Settings"
            description="Enable or disable builtin Copilot commands"
            dialogTitle="Command Settings"
            dialogDescription="Enable or disable chat commands"
            trigger={<Button variant="outline">Manage Commands</Button>}
          >
            <div className="h-[50vh] sm:h-[400px] overflow-y-auto px-1 py-2">
              <div className="space-y-4">
                {DISABLEABLE_COMMANDS.map((command) => (
                  <div
                    key={command}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2 sm:py-0.5"
                  >
                    <div className="space-y-0.5 flex-1">
                      <div className="text-sm font-medium">{COMMAND_NAMES[command]}</div>
                    </div>
                    <SettingSwitch
                      checked={isCommandEnabled(command)}
                      onCheckedChange={(checked) => {
                        const newEnabledCommands = {
                          ...settings.enabledCommands,
                          [command]: {
                            enabled: checked,
                          },
                        };
                        updateSetting("enabledCommands", newEnabledCommands);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </SettingItem>
        </div>
      </section>
    </div>
  );
};

export default BasicSettings;
