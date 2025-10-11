import { AcceptKeyOption } from "@/autocomplete/codemirrorIntegration";
import { WordCompletionManager } from "@/autocomplete/wordCompletion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingItem } from "@/components/ui/setting-item";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AUTOCOMPLETE_CONFIG } from "@/constants";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { RefreshCw } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";
import { ToolSettingsSection } from "./ToolSettingsSection";

export const CopilotPlusSettings: React.FC = () => {
  const settings = useSettingsValue();
  const currentShortcut = settings.autocompleteAcceptKey || AUTOCOMPLETE_CONFIG.KEYBIND;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isAutocompleteTemporarilyDisabled = true;

  // Available key options
  const keyOptions: { value: AcceptKeyOption; label: string }[] = [
    { value: "Tab", label: "Tab" },
    { value: "Space", label: "Space" },
    { value: "ArrowRight", label: "Right Arrow" },
  ];

  // Handle key option change
  const handleKeyChange = (value: AcceptKeyOption) => {
    if (isAutocompleteTemporarilyDisabled) {
      return;
    }
    updateSetting("autocompleteAcceptKey", value);
    new Notice(`Autocomplete accept key set to: ${value}`);
  };

  // Reset to default
  const resetToDefault = () => {
    if (isAutocompleteTemporarilyDisabled) {
      return;
    }
    updateSetting("autocompleteAcceptKey", AUTOCOMPLETE_CONFIG.KEYBIND as AcceptKeyOption);
    new Notice(`Autocomplete accept key reset to: ${AUTOCOMPLETE_CONFIG.KEYBIND}`);
  };

  // Handle refresh word index
  const handleRefreshWordIndex = async () => {
    if (isRefreshing || isAutocompleteTemporarilyDisabled) return;

    setIsRefreshing(true);
    new Notice("Rebuilding word index...");

    try {
      const wordManager = WordCompletionManager.getInstance(app.vault);
      const result = await wordManager.rescan((progress) => {
        if (progress.processedFiles === progress.totalFiles) {
          new Notice(
            `Word index complete! Found ${progress.foundWords} words from ${progress.processedFiles} files.`
          );
        }
      });

      new Notice(`Word index rebuilt successfully! ${result.wordCount} unique words indexed.`);
    } catch (error) {
      logError("Failed to refresh word index:", error);
      new Notice("Failed to refresh word index. Check console for details.");
    } finally {
      setIsRefreshing(false);
    }
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

          <div className="tw-pt-4 tw-text-xl tw-font-semibold">Memory</div>

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

          <div className="tw-pt-4 tw-text-xl tw-font-semibold">
            Autocomplete
            <span className="tw-ml-2 tw-text-sm tw-font-normal tw-text-muted">
              (service temporarily unavailable, will be back soon)
            </span>
          </div>

          {isAutocompleteTemporarilyDisabled ? null : (
            <>
              <SettingItem
                type="switch"
                title="Sentence Autocomplete"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">
                      Enable AI-powered sentence autocomplete suggestions while typing
                    </span>
                  </div>
                }
                checked={settings.enableAutocomplete}
                onCheckedChange={(checked) => {
                  if (isAutocompleteTemporarilyDisabled) {
                    return;
                  }
                  updateSetting("enableAutocomplete", checked);
                }}
                disabled={isAutocompleteTemporarilyDisabled}
              />

              <SettingItem
                type="switch"
                title="Word Completion"
                description="Suggest completions for partially typed words based on your vault's content. Requires at least 3 characters to trigger."
                checked={settings.enableWordCompletion}
                onCheckedChange={(checked) => {
                  if (isAutocompleteTemporarilyDisabled) {
                    return;
                  }
                  updateSetting("enableWordCompletion", checked);
                }}
                disabled={isAutocompleteTemporarilyDisabled}
              />

              <SettingItem
                type="custom"
                title="Word Index Management"
                description="Rebuild the word index to include new words from your vault. The index is automatically built when the plugin loads."
                disabled={isAutocompleteTemporarilyDisabled}
              >
                <Button
                  onClick={handleRefreshWordIndex}
                  disabled={isRefreshing || isAutocompleteTemporarilyDisabled}
                  className="tw-flex tw-items-center tw-gap-2"
                >
                  <RefreshCw className={cn("tw-size-4", isRefreshing && "tw-animate-spin")} />
                  {isRefreshing ? "Rebuilding..." : "Refresh Word Index"}
                </Button>
              </SettingItem>

              <SettingItem
                type="custom"
                title="Autocomplete Accept Suggestion Key"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">
                      The key used to accept autocomplete suggestions
                    </span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2">
                          <div className="tw-text-sm tw-text-muted">
                            Select the key you want to use for accepting suggestions. Default is
                            &quot;Tab&quot;.
                          </div>
                        </div>
                      }
                    />
                  </div>
                }
                disabled={isAutocompleteTemporarilyDisabled}
              >
                <div className="tw-flex tw-items-center tw-gap-2">
                  <Select
                    value={currentShortcut}
                    onValueChange={handleKeyChange}
                    disabled={isAutocompleteTemporarilyDisabled}
                  >
                    <SelectTrigger
                      className="tw-w-[180px]"
                      disabled={isAutocompleteTemporarilyDisabled}
                    >
                      <SelectValue placeholder="Select key" />
                    </SelectTrigger>
                    <SelectContent>
                      {keyOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {currentShortcut && currentShortcut !== AUTOCOMPLETE_CONFIG.KEYBIND && (
                    <Button
                      variant="ghost"
                      onClick={resetToDefault}
                      className="tw-h-8 tw-text-xs"
                      disabled={isAutocompleteTemporarilyDisabled}
                    >
                      Reset to Default
                    </Button>
                  )}
                </div>
              </SettingItem>

              <SettingItem
                type="switch"
                title="Allow Additional Context"
                description="Allow the AI to access relevant notes to provide more relevant suggestions. When off, the AI can only see the current note context."
                checked={settings.allowAdditionalContext}
                onCheckedChange={(checked) => {
                  if (isAutocompleteTemporarilyDisabled) {
                    return;
                  }
                  updateSetting("allowAdditionalContext", checked);
                }}
                disabled={isAutocompleteTemporarilyDisabled}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
};
