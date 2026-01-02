/**
 * SendStopButton - Conditional send/stop button for chat inputs
 *
 * Shows a stop button while generating, and a send button otherwise.
 * Includes keyboard shortcut hint (Enter key icon).
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { CornerDownLeft, Square } from "lucide-react";

interface SendStopButtonProps {
  /** Whether AI is currently generating a response */
  isGenerating: boolean;
  /** Callback when send button is clicked */
  onSend: () => void;
  /** Callback when stop button is clicked */
  onStop?: () => void;
  /** Label for the send button (e.g., "chat", "send", "save") */
  sendLabel?: string;
  /** Whether the send button is disabled */
  disabled?: boolean;
}

export function SendStopButton({
  isGenerating,
  onSend,
  onStop,
  sendLabel = "send",
  disabled,
}: SendStopButtonProps) {
  if (isGenerating && onStop) {
    return (
      <Button variant="ghost2" size="fit" className="tw-text-muted" onClick={onStop}>
        <Square className="tw-size-4" />
        <span>Stop</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost2"
      size="fit"
      className="tw-text-muted"
      onClick={onSend}
      disabled={disabled || isGenerating}
    >
      <CornerDownLeft className="!tw-size-3" />
      <span>{sendLabel}</span>
    </Button>
  );
}
