import * as React from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ModelSettingsButtonProps {
  needsModel: boolean;
  disabled?: boolean;
  onClick: (ownerWindow: Window) => void;
}

export function ModelSettingsButton({ needsModel, disabled, onClick }: ModelSettingsButtonProps) {
  const label = needsModel ? "A model must be selected" : "Configure the default model";
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            className="tw-relative tw-size-6"
            onClick={(event) => onClick(event.currentTarget.win)}
            disabled={disabled}
            aria-label={label}
          >
            <Settings className="tw-size-4" />
            {needsModel && (
              <span className="tw-absolute tw-right-0.5 tw-top-0.5 tw-size-2 tw-rounded-full tw-bg-warning" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
