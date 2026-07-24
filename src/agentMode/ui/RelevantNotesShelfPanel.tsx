import { dismissPopOutHint, isPopOutHintDismissed } from "@/agentMode/ui/homeShelfPrefs";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLink, X } from "lucide-react";
import React, { useState } from "react";

interface RelevantNotesShelfPanelProps {
  /** Open the dedicated Relevant Notes pane (the shelf is transient). */
  onPopOut: () => void;
  /** Insert text (a `[[wikilink]]`) into the target chat input. */
  onAddToChat: (text: string) => void;
}

/**
 * Relevant Notes rendered inside the Agent Home shelf. The shelf is transient
 * (it collapses as you chat), so a one-time, dismissible hint nudges the user
 * toward the dedicated pane that persists alongside the conversation. Assumes
 * the surrounding agent view already provides AppContext + EventTargetContext.
 */
export function RelevantNotesShelfPanel({ onPopOut, onAddToChat }: RelevantNotesShelfPanelProps) {
  const [hintDismissed, setHintDismissed] = useState(() => isPopOutHintDismissed());

  const handleDismiss = () => {
    dismissPopOutHint();
    setHintDismissed(true);
  };

  return (
    <div className={cn("tw-flex tw-min-h-0 tw-w-full tw-flex-1 tw-flex-col tw-overflow-hidden")}>
      {!hintDismissed && (
        <div
          className={cn(
            "tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-rounded-md tw-border tw-border-solid",
            "tw-border-border tw-bg-secondary tw-px-2 tw-py-1.5 tw-text-ui-smaller tw-text-muted"
          )}
        >
          <span className="tw-min-w-0 tw-flex-1">
            Open Relevant Notes in its own pane to keep it while you chat.
          </span>
          <Button
            variant="ghost2"
            size="fit"
            className={cn("tw-shrink-0 tw-text-muted", "hover:tw-text-normal")}
            onClick={onPopOut}
          >
            <ExternalLink className="tw-size-3" />
            Open pane
          </Button>
          <Button
            variant="ghost2"
            size="fit"
            className={cn("tw-shrink-0 tw-text-muted", "hover:tw-text-normal")}
            onClick={handleDismiss}
            aria-label="Dismiss hint"
          >
            <X className="tw-size-3" />
          </Button>
        </div>
      )}
      <div className={cn("tw-flex tw-min-h-0 tw-flex-1 tw-flex-col")}>
        <RelevantNotes
          className={cn("[&>[data-relevant-notes-empty-state]]:tw-py-6")}
          onAddToChat={onAddToChat}
        />
      </div>
    </div>
  );
}
