import { ChainType } from "@/chainType";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Sparkles, SquareArrowOutUpRight } from "lucide-react";
import React from "react";

interface ChatModeSelectorProps {
  selectedChain: ChainType;
  isPaidUser: boolean;
  onModeChange: (chainType: ChainType) => void;
  onPlusUpsell: () => void;
  defaultOpen?: boolean;
}

/**
 * Render the two surviving Quick Chat modes and the existing Copilot Plus paywall entry.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/286
 */
export function ChatModeSelector({
  selectedChain,
  isPaidUser,
  onModeChange,
  onPlusUpsell,
  defaultOpen,
}: ChatModeSelectorProps) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost2" size="fit" className="tw-ml-1 tw-text-sm tw-text-muted">
          {selectedChain === ChainType.LLM_CHAIN ? (
            "chat (free)"
          ) : (
            <div className="tw-flex tw-items-center tw-gap-1">
              <Sparkles className="tw-size-4" />
              copilot plus
            </div>
          )}
          <ChevronDown className="tw-mt-0.5 tw-size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onModeChange(ChainType.LLM_CHAIN)}>
          chat (free)
        </DropdownMenuItem>
        {isPaidUser ? (
          <DropdownMenuItem onSelect={() => onModeChange(ChainType.COPILOT_PLUS_CHAIN)}>
            <div className="tw-flex tw-items-center tw-gap-1">
              <Sparkles className="tw-size-4" />
              copilot plus
            </div>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onPlusUpsell}>
            copilot plus
            <SquareArrowOutUpRight className="tw-size-3" />
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
