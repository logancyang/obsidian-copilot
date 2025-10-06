import { Coins } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import React from "react";

interface TokenCounterProps {
  tokenCount: number | null;
}

/**
 * Displays the total token count from the latest AI response.
 * Shows "<1k" for counts under 1000, otherwise shows rounded thousands (e.g., "5k").
 * On hover, shows the exact token count.
 * Returns null if no token count is available.
 */
export const TokenCounter: React.FC<TokenCounterProps> = ({ tokenCount }) => {
  if (tokenCount === null || tokenCount === undefined) {
    return null;
  }

  const formatTokenCount = (count: number): string => {
    if (count < 1000) {
      return "<1k";
    }
    return `${Math.floor(count / 1000)}k`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="tw-flex tw-items-center tw-gap-1 tw-text-sm tw-text-muted">
          <Coins className="tw-size-3" />
          <span>{formatTokenCount(tokenCount)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>Total tokens: {tokenCount.toLocaleString()}</TooltipContent>
    </Tooltip>
  );
};
