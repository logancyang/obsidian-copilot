import { backendRegistry } from "@/agentMode/backends/registry";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { navigateToPlusPage, useCanUseMultiAgent } from "@/plusUtils";
import { useSettingsValue } from "@/settings/model";
import { Download, History, MessageCirclePlus, Sparkles } from "lucide-react";
import React from "react";

const resolveHistoryIcon = (item: ChatHistoryItem) =>
  item.backendId ? backendRegistry[item.backendId]?.Icon : undefined;

interface AgentChatControlsProps {
  /** Omit when there's no active session yet (the not-ready state) so the
   * button is hidden — clicking it would be a no-op since there's nothing to
   * clear. */
  onNewChat?: () => void;
  /** Manual save handler. Surfaced as a Download button when
   * `settings.autosaveChat` is off, mirroring the regular chat. */
  onSaveAsNote?: () => void | Promise<void>;
  /** Items rendered inside the chat-history popover. */
  chatHistoryItems?: ChatHistoryItem[];
  /** Refresh the popover items (called when the user opens the button). */
  onLoadHistory?: () => void | Promise<void>;
  /** Open a saved chat by id (file path). */
  onLoadChat?: (id: string) => Promise<void>;
  onUpdateChatTitle?: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat?: (id: string) => Promise<void>;
  onOpenSourceFile?: (id: string) => Promise<void>;
  /**
   * Context-window usage meter, rendered as the first item in the right-side
   * control cluster (left of New Chat). Self-renders `null` until the backend
   * reports usage. Omitted in the not-ready state, so nothing renders there.
   */
  usageMeter?: React.ReactNode;
  /**
   * Opt into the multi-agent upsell in the left slot. Opt-in, not automatic:
   * the pre-conversation mounts (cold-start agent selection, the not-ready
   * fallback) render this bar too, and pitching multi-agent there would sell a
   * second agent to someone who has no working first one. Only the conversation
   * mount sets it, and it still defers to the entitlement check.
   */
  showMultiAgentUpsell?: boolean;
}

/**
 * Minimal control bar for the Agent Chat view. The agent view stands alone
 * (no chain switcher needed), so this only renders New Chat, an optional
 * Save Chat button (when autosave is off), and the chat history popover.
 * Intentionally omits the model picker, project picker, and settings popover
 * — Agent Mode owns its own model/conversation state via ACP. The left side
 * doubles as the multi-agent upsell slot for unentitled users whose caller
 * opts in (empty otherwise), rather than adding a separate row above the
 * composer.
 */
export const AgentChatControls: React.FC<AgentChatControlsProps> = ({
  onNewChat,
  onSaveAsNote,
  chatHistoryItems,
  onLoadHistory,
  onLoadChat,
  onUpdateChatTitle,
  onDeleteChat,
  onOpenSourceFile,
  usageMeter,
  showMultiAgentUpsell = false,
}) => {
  const settings = useSettingsValue();
  const canUseMultiAgent = useCanUseMultiAgent();
  const historyAvailable = Boolean(
    chatHistoryItems && onLoadChat && onUpdateChatTitle && onDeleteChat
  );

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-ml-1 tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1">
        {showMultiAgentUpsell && !canUseMultiAgent && (
          <Button
            variant="ghost2"
            size="fit"
            className={cn(
              "tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted",
              "hover:tw-text-normal"
            )}
            onClick={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.MULTI_AGENT)}
          >
            <Sparkles className="tw-size-3 tw-shrink-0" />
            {/* The label must truncate on its own element: `tw-truncate` on the
                flex-container button would make the text an anonymous flex item,
                which `text-overflow` never reaches, so narrow panes would hard-clip
                the copy instead of ellipsizing it. */}
            <span className="tw-truncate">{t("agentChat.controls.multiAgentUpsell")}</span>
          </Button>
        )}
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        {usageMeter}
        {onNewChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                title={t("agentChat.controls.newChat")}
                onClick={onNewChat}
              >
                <MessageCirclePlus className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("agentChat.controls.newChat")}</TooltipContent>
          </Tooltip>
        )}
        {!settings.autosaveChat && onSaveAsNote && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                title={t("agentChat.controls.saveAsNote")}
                onClick={() => void onSaveAsNote()}
              >
                <Download className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("agentChat.controls.saveAsNote")}</TooltipContent>
          </Tooltip>
        )}
        {historyAvailable && (
          <Tooltip>
            <ChatHistoryPopover
              chatHistory={chatHistoryItems!}
              onUpdateTitle={onUpdateChatTitle!}
              onDeleteChat={onDeleteChat!}
              onLoadChat={onLoadChat}
              onOpenSourceFile={onOpenSourceFile}
              getIcon={resolveHistoryIcon}
            >
              <TooltipTrigger asChild>
                <Button
                  variant="ghost2"
                  size="icon"
                  title={t("agentChat.controls.history")}
                  onClick={() => {
                    void onLoadHistory?.();
                  }}
                >
                  <History className="tw-size-4" />
                </Button>
              </TooltipTrigger>
            </ChatHistoryPopover>
            <TooltipContent>{t("agentChat.controls.history")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
