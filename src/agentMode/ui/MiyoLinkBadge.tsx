import { MiyoLogo } from "@/components/ui/MiyoLogo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import React from "react";

export const MiyoLinkBadge: React.FC = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span
        role="img"
        aria-label="Found by Miyo"
        className="tw-mr-1 tw-inline-flex tw-align-middle"
      >
        <MiyoLogo className="tw-size-3 tw-text-miyo" />
      </span>
    </TooltipTrigger>
    <TooltipContent>Found by Miyo</TooltipContent>
  </Tooltip>
);
