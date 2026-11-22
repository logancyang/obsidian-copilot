import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LucideIcon } from "lucide-react";
import React from "react";

interface MessageActionButtonProps {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
}

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
