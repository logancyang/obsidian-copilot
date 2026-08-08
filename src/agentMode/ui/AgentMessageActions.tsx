import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "@/utils";
import { TextCursorInput } from "lucide-react";
import { App, Platform } from "obsidian";
import React from "react";

interface AgentMessageActionsProps {
  /** The cleaned, user-visible final answer — already run through
   *  `cleanMessageForCopy` by the trail. Copied / inserted verbatim. */
  text: string;
  app: App;
  /** Frozen wall-clock duration shown beside the completed response controls. */
  durationMs?: number;
  /** Message creation time used when no completed duration is available. */
  timestamp?: string;
}

/**
 * Copy / Insert action row beneath a completed assistant turn in Agent Mode.
 * Shares `MessageActionButton` / `CopyButton` with legacy chat's `ChatButtons`,
 * but acts on the trail's final answer text rather than a `ChatMessage` —
 * regenerate / edit / delete can slot into this same row later.
 */
export const AgentMessageActions: React.FC<AgentMessageActionsProps> = ({
  text,
  app,
  durationMs,
  timestamp,
}) => (
  <AssistantResponseFooter
    leading={
      durationMs !== undefined ? (
        <AgentTurnDurationIndicator status="complete" durationMs={durationMs} inline />
      ) : undefined
    }
    timestamp={timestamp}
    actions={
      <div
        className={cn("tw-flex tw-items-center tw-gap-1", {
          "group-hover:opacity-100 opacity-0": !Platform.isMobile,
        })}
      >
        <MessageActionButton
          label="Insert / Replace at cursor"
          icon={TextCursorInput}
          onClick={() => void insertAtCursor(app, text)}
        />
        <CopyButton text={text} />
      </div>
    }
  />
);
