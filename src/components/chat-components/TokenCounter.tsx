import { Coins } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import React from "react";

interface TokenCounterProps {
  tokenCount: number | null;
}

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
        <div className="tw-flex tw-items-center tw-gap-1 tw-text-sm tw-text-faint">
          <Coins className="tw-size-3" />
          <span>{formatTokenCount(tokenCount)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>Context used: {tokenCount.toLocaleString()}</TooltipContent>
    </Tooltip>
  );
};
