import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { navigateToPlusPage, useIsPlusUser } from "@/plusUtils";
import { useSettingsValue } from "@/settings/model";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import {
  Bot,
  ChevronDown,
  LibraryBig,
  MessageCirclePlus,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
import React from "react";

interface AgentChatControlsProps {
  /** Omit when there's no active session yet (the not-ready state) so the
   * button is hidden — clicking it would be a no-op since there's nothing to
   * clear. */
  onNewChat?: () => void;
}

/**
 * Minimal control bar for Agent Mode. Renders only the chain switcher (so the
 * user can leave Agent Mode) and a New Chat button. Intentionally omits the
 * model picker, project picker, save-as-note, history, and settings popover —
 * Agent Mode does not honor those (ACP owns model/conversation state, no
 * persistence yet).
 */
export const AgentChatControls: React.FC<AgentChatControlsProps> = ({ onNewChat }) => {
  const settings = useSettingsValue();
  const [, setSelectedChain] = useChainType();
  const isPlusUser = useIsPlusUser();

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="tw-ml-1 tw-text-sm tw-text-muted">
              <div className="tw-flex tw-items-center tw-gap-1">
                <Bot className="tw-size-4" />
                agent (alpha)
              </div>
              <ChevronDown className="tw-mt-0.5 tw-size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.LLM_CHAIN)}>
              chat (free)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.VAULT_QA_CHAIN)}>
              vault QA (free)
            </DropdownMenuItem>
            {isPlusUser ? (
              <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.COPILOT_PLUS_CHAIN)}>
                <div className="tw-flex tw-items-center tw-gap-1">
                  <Sparkles className="tw-size-4" />
                  copilot plus
                </div>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT)}
              >
                copilot plus
                <SquareArrowOutUpRight className="tw-size-3" />
              </DropdownMenuItem>
            )}
            {isPlusUser && (
              <DropdownMenuItem
                className="tw-flex tw-items-center tw-gap-1"
                onSelect={() => setSelectedChain(ChainType.PROJECT_CHAIN)}
              >
                <LibraryBig className="tw-size-4" />
                projects (alpha)
              </DropdownMenuItem>
            )}
            {settings.agentMode.enabled && (
              <DropdownMenuItem
                className="tw-flex tw-items-center tw-gap-1"
                onSelect={() => setSelectedChain(ChainType.AGENT_MODE)}
              >
                <Bot className="tw-size-4" />
                agent (alpha)
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        {onNewChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
                <MessageCirclePlus className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Chat</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
