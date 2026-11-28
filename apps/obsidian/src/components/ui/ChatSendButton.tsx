import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";
import React from "react";

interface ChatSendButtonProps {
  canSend: boolean;
  onSend: () => void;
}

export function ChatSendButton({ canSend, onSend }: ChatSendButtonProps) {
  return (
    <Button
      size="icon"
      className="tw-rounded-full tw-bg-interactive-accent tw-text-on-accent hover:tw-bg-interactive-accent-hover"
      aria-label="Send"
      onClick={onSend}
      disabled={!canSend}
    >
      <ArrowUp className="tw-size-4" />
    </Button>
  );
}
