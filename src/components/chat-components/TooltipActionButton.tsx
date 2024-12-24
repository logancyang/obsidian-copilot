import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { PropsWithChildren } from "react";

interface Props {
  onClick: () => void;
  Icon: React.ReactNode;
}

export function TooltipActionButton({ onClick, Icon, children }: PropsWithChildren<Props>) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="chat-icon-button clickable-icon" onClick={onClick}>
          {Icon}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal container={activeDocument.body}>
        <Tooltip.Content sideOffset={5} className="tooltip-text">
          {children}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
