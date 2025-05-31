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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AUTOCOMPLETE_CONFIG } from "@/constants";
import { cn } from "@/lib/utils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { HelpCircle, RefreshCw } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";

export const CopilotPlusSettings: React.FC = () => {
  const settings = useSettingsValue();
  const currentShortcut = settings.autocompleteAcceptKey || AUTOCOMPLETE_CONFIG.KEYBIND;
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Available key options
  const keyOptions: { value: AcceptKeyOption; label: string }[] = [
    { value: "Tab", label: "Tab" },
    { value: "Space", label: "Space" },
    { value: "ArrowRight", label: "Right Arrow" },
  ];

  // Handle key option change
  const handleKeyChange = (value: AcceptKeyOption) => {
    updateSetting("autocompleteAcceptKey", value);
    new Notice(`Autocomplete accept key set to: ${value}`);
  };

  // Reset to default
  const resetToDefault = () => {
    updateSetting("autocompleteAcceptKey", AUTOCOMPLETE_CONFIG.KEYBIND as AcceptKeyOption);
    new Notice(`Autocomplete accept key reset to: ${AUTOCOMPLETE_CONFIG.KEYBIND}`);
  };

  // Handle refresh word index
  const handleRefreshWordIndex = async () => {
    if (isRefreshing) return;

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
      console.error("Failed to refresh word index:", error);
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
          <SettingItem
            type="switch"
            title="Include Current Note in Context Menu"
            description="Automatically include the current note in the chat context menu by default when sending messages to the AI."
            checked={settings.includeActiveNoteAsContext}
            onCheckedChange={(checked) => {
              updateSetting("includeActiveNoteAsContext", checked);
            }}
          />

          <SettingItem
            type="switch"
            title="Images in Markdown"
            description="Pass embedded images in markdown to the AI along with the text. Only works with multimodal models."
            checked={settings.passMarkdownImages}
            onCheckedChange={(checked) => {
              updateSetting("passMarkdownImages", checked);
            }}
          />

          <div className="tw-pt-4 tw-text-xl tw-font-semibold">Autocomplete</div>

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
            onCheckedChange={(checked) => updateSetting("enableAutocomplete", checked)}
          />

          <SettingItem
            type="switch"
            title="Word Completion"
            description="Suggest completions for partially typed words based on your vault's content. Requires at least 3 characters to trigger."
            checked={settings.enableWordCompletion}
            onCheckedChange={(checked) => {
              updateSetting("enableWordCompletion", checked);
            }}
          />

          <SettingItem
            type="custom"
            title="Word Index Management"
            description="Rebuild the word index to include new words from your vault. The index is automatically built when the plugin loads."
          >
            <Button
              onClick={handleRefreshWordIndex}
              disabled={isRefreshing}
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
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="tw-size-4" />
                    </TooltipTrigger>
                    <TooltipContent className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2">
                      <div className="tw-text-sm tw-text-muted">
                        Select the key you want to use for accepting suggestions. Default is
                        &quot;Tab&quot;.
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            }
          >
            <div className="tw-flex tw-items-center tw-gap-2">
              <Select value={currentShortcut} onValueChange={handleKeyChange}>
                <SelectTrigger className="tw-w-[180px]">
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
                <Button variant="ghost" onClick={resetToDefault} className="tw-h-8 tw-text-xs">
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
              updateSetting("allowAdditionalContext", checked);
            }}
          />
        </div>
      </section>
    </div>
  );
};
