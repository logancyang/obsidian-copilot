import { MiyoLogo } from "@/miyo/ui/MiyoLogo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import React from "react";

// Obsidian shows its own tooltip for any element with an aria-label, which would stack on the
// shared tooltip, so the accessible name comes from a hidden label instead.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/719
export const MiyoLinkBadge: React.FC = () => {
  const labelId = React.useId();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-labelledby={labelId}
          className="tw-mr-1 tw-inline-flex tw-align-middle"
        >
          <MiyoLogo className="tw-size-3 tw-text-normal" />
          <span id={labelId} className="tw-hidden">
            Found by Miyo
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Found by Miyo</TooltipContent>
    </Tooltip>
  );
};
