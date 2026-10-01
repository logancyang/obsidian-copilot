import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ArrowUp } from "lucide-react";
import React from "react";

interface ChatSendButtonProps {
  inputMessage: string;
  imageCount: number;
  onSend: () => void;
  disabledReason?: string;
}

export function ChatSendButton({
  inputMessage,
  imageCount,
  onSend,
  disabledReason,
}: ChatSendButtonProps) {
  const button = (
    <Button
      size="icon"
      className="tw-rounded-full tw-bg-interactive-accent tw-text-on-accent hover:tw-bg-interactive-accent-hover"
      aria-label="Send"
      onClick={onSend}
      disabled={disabledReason !== undefined || (!inputMessage.trim() && imageCount === 0)}
    >
      <ArrowUp className="tw-size-4" />
    </Button>
  );
  if (disabledReason === undefined) return button;
  return (
    <HelpTooltip content={disabledReason} side="top">
      {button}
    </HelpTooltip>
  );
}
