import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { DEFAULT_OPEN_AREA, SEND_SHORTCUT } from "@/constants";
import { cn } from "@/lib/utils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { PlusSettings } from "@/settings/v2/components/PlusSettings";
import { formatDateTime } from "@/utils";
import { Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";

// Read-only preview of the unified Copilot folder (PR-3 makes it editable and
// wires the real setting). Sub-folders derive from this root. The row is hidden
// until PR-3 lands — see the commented block in the render below.
// const COPILOT_FOLDER_PLACEHOLDER = "copilot";

export const BasicSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [isChecking, setIsChecking] = useState(false);
  const [conversationNoteName, setConversationNoteName] = useState(
    settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}"
  );

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
      new Notice(
        `Error applying format: ${error instanceof Error ? error.message : String(error)}`,
        4000
      );
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="tw-space-y-4">
      <PlusSettings />

      {/* General Section */}
      <SettingSection label="General">
        <SettingItem
          type="select"
          title="Open Plugin In"
          description="Choose where to open the plugin."
          value={settings.defaultOpenArea}
          onChange={(value) => updateSetting("defaultOpenArea", value as DEFAULT_OPEN_AREA)}
          options={[
            { label: "Sidebar View", value: DEFAULT_OPEN_AREA.VIEW },
            { label: "Editor", value: DEFAULT_OPEN_AREA.EDITOR },
          ]}
        />

        {/* Copilot folder location — hidden until the next phase (PR-3) makes it
            editable and wires the real `copilotFolder` setting + migration.
            Shipping a disabled read-only preview now would just confuse users, so
            keep it out of the UI until it does something. Restore this block when
            PR-3 lands. */}
        {/*
        <SettingItem
          type="custom"
          title="Copilot folder location"
          description="Where Copilot keeps conversations, prompts, memory and more. All sub-folders derive from this."
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <Input
              type="text"
              value={COPILOT_FOLDER_PLACEHOLDER}
              disabled
              readOnly
              className="tw-w-full sm:tw-w-[160px]"
            />
            <Button
              variant="secondary"
              size="icon"
              disabled
              aria-label="Open Copilot folder"
              title="Open Copilot folder"
            >
              <Folder className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>
        */}

        <SettingItem
          type="select"
          title="Send Shortcut"
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">Keyboard shortcut to send messages.</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-xs tw-text-muted">
                      If your selected shortcut doesn&#39;t work, check{" "}
                      <strong>Obsidian → Hotkeys</strong> to see if another command is using the
                      same key combination.
                    </div>
                  </div>
                }
              />
            </div>
          }
          value={settings.defaultSendShortcut}
          onChange={(value) => updateSetting("defaultSendShortcut", value as SEND_SHORTCUT)}
          options={[
            { label: "Enter", value: SEND_SHORTCUT.ENTER },
            { label: "Shift + Enter", value: SEND_SHORTCUT.SHIFT_ENTER },
          ]}
        />
      </SettingSection>

      {/* Saving Conversations Section */}
      <SettingSection label="Saving conversations">
        <SettingItem
          type="switch"
          title="Autosave Chat as Markdown"
          description="Writes each chat to a Markdown note in your vault after every user message and AI response. With this off, agent chats still appear in Recent Chats from session history; only the Markdown note is skipped."
          checked={settings.autosaveChat}
          onCheckedChange={(checked) => updateSetting("autosaveChat", checked)}
        />

        <SettingItem
          type="text"
          title="Default Conversation Folder Name"
          description="The default folder name where chat conversations will be saved. Default is 'copilot/copilot-conversations'"
          value={settings.defaultSaveFolder}
          onChange={(value) => updateSetting("defaultSaveFolder", value)}
          placeholder="copilot/copilot-conversations"
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
            <div className="tw-flex tw-items-start tw-gap-1.5 ">
              <span className="tw-leading-none">
                Customize the format of saved conversation note names.
              </span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-sm tw-font-medium tw-text-accent">
                      Note: All the following variables must be included in the template.
                    </div>
                    <div>
                      <div className="tw-text-sm tw-font-medium tw-text-muted">
                        Available variables:
                      </div>
                      <ul className="tw-pl-4 tw-text-sm tw-text-muted">
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
                      <i className="tw-mt-2 tw-text-sm tw-text-muted">
                        Example: {"{$date}_{$time}__{$topic}"} →
                        20250114_153232__polish_this_article_[[Readme]]
                      </i>
                    </div>
                  </div>
                }
              />
            </div>
          }
        >
          <div className="tw-flex tw-w-[320px] tw-items-center tw-gap-1.5">
            <Input
              type="text"
              className={cn(
                "tw-min-w-[80px] tw-grow tw-transition-all tw-duration-200",
                isChecking ? "tw-w-[80px]" : "tw-w-[120px]"
              )}
              placeholder="{$date}_{$time}__{$topic}"
              value={conversationNoteName}
              onChange={(e) => setConversationNoteName(e.target.value)}
              disabled={isChecking}
            />

            <Button
              onClick={() => applyCustomNoteFormat()}
              disabled={isChecking}
              variant="secondary"
            >
              {isChecking ? (
                <>
                  <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" />
                  Apply
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </div>
        </SettingItem>
      </SettingSection>
    </div>
  );
};
