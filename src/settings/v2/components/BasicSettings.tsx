import { ChainType } from "@/chainFactory";
import { isCommandEnabled } from "@/commands";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { COMMAND_NAMES, DEFAULT_OPEN_AREA, DISABLEABLE_COMMANDS } from "@/constants";
import { useTab } from "@/contexts/TabContext";
import { getModelKeyFromModel, updateSetting, useSettingsValue } from "@/settings/model";
import { getProviderLabel } from "@/utils";
import { ArrowRight, ExternalLink, HelpCircle, Key } from "lucide-react";
import React, { useState } from "react";
import ApiKeyDialog from "./ApiKeyDialog";

const ChainType2Label: Record<ChainType, string> = {
  [ChainType.LLM_CHAIN]: "Chat",
  [ChainType.VAULT_QA_CHAIN]: "Vault QA (Basic)",
  [ChainType.COPILOT_PLUS_CHAIN]: "Copilot Plus",
};

interface BasicSettingsProps {
  indexVaultToVectorStore(overwrite?: boolean): Promise<number>;
}

const BasicSettings: React.FC<BasicSettingsProps> = ({ indexVaultToVectorStore }) => {
  const { setSelectedTab, modalContainer } = useTab();
  const settings = useSettingsValue();
  const [openPopoverIds, setOpenPopoverIds] = useState<Set<string>>(new Set());
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);

  const handleSetDefaultEmbeddingModel = async (modelKey: string) => {
    if (modelKey !== settings.embeddingModelKey) {
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("embeddingModelKey", modelKey);
        await indexVaultToVectorStore(true);
      }).open();
    }
  };

  const handlePopoverOpen = (id: string) => {
    setOpenPopoverIds((prev) => new Set([...prev, id]));
  };

  const handlePopoverClose = (id: string) => {
    setOpenPopoverIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="text-2xl font-bold mb-3">Copilot Plus</div>
        <div className="space-y-4">
          {/* copilot-plus */}
          <SettingItem
            type="password"
            title="License Key"
            description={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">
                  Copilot Plus brings powerful AI agent capabilities
                </span>
                <Popover
                  open={openPopoverIds.has("license-help")}
                  onOpenChange={(open) => {
                    if (open) {
                      handlePopoverOpen("license-help");
                    } else {
                      handlePopoverClose("license-help");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <HelpCircle
                      className="h-5 w-5 sm:h-4 sm:w-4 cursor-pointer text-muted hover:text-accent translate-y-[1px]"
                      onMouseEnter={() => handlePopoverOpen("license-help")}
                      onMouseLeave={() => handlePopoverClose("license-help")}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    container={modalContainer}
                    className="w-[90vw] max-w-[400px] p-4 bg-primary border border-solid border-border shadow-sm"
                    side="bottom"
                    align="center"
                    sideOffset={5}
                    onMouseEnter={() => handlePopoverOpen("license-help")}
                    onMouseLeave={() => handlePopoverClose("license-help")}
                  >
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-normal">
                          Copilot Plus brings powerful AI agent capabilities to Obsidian.
                        </p>
                        <p className="text-xs text-muted">
                          Alpha access is limited to sponsors and early supporters at the moment.
                          Officially launching in Jan 2025!
                        </p>
                      </div>
                      <div className="text-sm text-muted">
                        Learn more at{" "}
                        <a
                          href="https://obsidiancopilot.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-accent-hover"
                        >
                          obsidiancopilot.com
                        </a>
                      </div>
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

          <div className="flex justify-end -mt-2">
            <Button
              variant="outline"
              onClick={() => window.open("https://obsidiancopilot.com", "_blank")}
            >
              Get Copilot Plus
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Keys Section */}
      <section>
        <div className="text-2xl font-bold mb-4">API Keys</div>
        <div className="space-y-4">
          {/* API Key Section */}
          <SettingItem
            type="custom"
            title="API Keys"
            description={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Configure API keys for different AI providers</span>
                <Popover
                  open={openPopoverIds.has("api-keys-help")}
                  onOpenChange={(open) => {
                    if (open) {
                      handlePopoverOpen("api-keys-help");
                    } else {
                      handlePopoverClose("api-keys-help");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <HelpCircle
                      className="h-5 w-5 sm:h-4 sm:w-4 cursor-pointer text-muted hover:text-accent translate-y-[1px]"
                      onMouseEnter={() => handlePopoverOpen("api-keys-help")}
                      onMouseLeave={() => handlePopoverClose("api-keys-help")}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    container={modalContainer}
                    className="w-[90vw] max-w-[400px] p-4 bg-primary border border-solid border-border shadow-sm"
                    side="bottom"
                    align="center"
                    sideOffset={5}
                    onMouseEnter={() => handlePopoverOpen("api-keys-help")}
                    onMouseLeave={() => handlePopoverClose("api-keys-help")}
                  >
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-accent">
                          API key is required for chat and QA features
                        </p>
                        <p className="text-xs text-muted">
                          You&#39;ll need to provide an API key from your chosen provider to use the
                          chat and QA functionality.
                        </p>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
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
          <div className="flex justify-end -mt-2">
            <Button onClick={() => setSelectedTab("model")} variant="outline">
              More Model Settings
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* General Section */}
      <section>
        <div className="text-2xl font-bold mb-3">General</div>
        <div className="space-y-4">
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

          {/* Basic Configuration Group */}
          <SettingItem
            type="select"
            title="Default Mode"
            description={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Select the default chat mode</span>
                <Popover
                  open={openPopoverIds.has("default-mode-help")}
                  onOpenChange={(open) => {
                    if (open) {
                      handlePopoverOpen("default-mode-help");
                    } else {
                      handlePopoverClose("default-mode-help");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <HelpCircle
                      className="h-5 w-5 sm:h-4 sm:w-4 cursor-pointer text-muted hover:text-accent translate-y-[1px]"
                      onMouseEnter={() => handlePopoverOpen("default-mode-help")}
                      onMouseLeave={() => handlePopoverClose("default-mode-help")}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    container={modalContainer}
                    className="w-[90vw] max-w-[400px] p-4 bg-primary border border-solid border-border shadow-sm"
                    side="bottom"
                    align="center"
                    sideOffset={5}
                    onMouseEnter={() => handlePopoverOpen("default-mode-help")}
                    onMouseLeave={() => handlePopoverClose("default-mode-help")}
                  >
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <ul className="space-y-2 text-xs text-muted">
                          <li>
                            <strong>Chat:</strong> Regular chat mode for general conversations and
                            tasks. <i>Free to use with your own API key.</i>
                          </li>
                          <li>
                            <strong>Vault QA (Basic):</strong> Ask questions about your vault
                            content with semantic search. <i>Free to use with your own API key.</i>
                          </li>
                          <li>
                            <strong>Copilot Plus:</strong> Covers all features of the 2 free modes,
                            plus advanced paid features including chat context menu, advanced
                            search, AI agents, and more. Check out{" "}
                            <a
                              href="https://obsidiancopilot.com"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:text-accent-hover"
                            >
                              obsidiancopilot.com
                            </a>{" "}
                            for more details.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
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
