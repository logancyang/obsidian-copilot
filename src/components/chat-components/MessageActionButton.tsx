import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LucideIcon } from "lucide-react";
import React from "react";

interface MessageActionButtonProps {
  /** Tooltip text and native button title. */
  label: string;
  /** Lucide icon rendered at the standard `tw-size-4`. */
  icon: LucideIcon;
  onClick?: () => void;
}

/**
 * One ghost icon button in a message-action row (Copy / Insert / Edit / …),
 * shared between legacy chat's `ChatButtons` and Agent Mode's action row.
 */
export const MessageActionButton: React.FC<MessageActionButtonProps> = ({
  label,
  icon: Icon,
  onClick,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button onClick={onClick} variant="ghost2" size="fit" title={label}>
        <Icon className="tw-size-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);
