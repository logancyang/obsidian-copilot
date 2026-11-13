import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "@/utils";
import { GitBranchPlus, TextCursorInput } from "lucide-react";
import { App, Platform } from "obsidian";
import React from "react";

interface AgentMessageActionsProps {
  text: string;
  app: App;
  durationMs?: number;
  timestamp?: string;
  onContinue?: () => void;
}

export const AgentMessageActions: React.FC<AgentMessageActionsProps> = ({
  text,
  app,
  durationMs,
  timestamp,
  onContinue,
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
        {onContinue && (
          <MessageActionButton
            label="Continue from here in a new chat"
            icon={GitBranchPlus}
            onClick={onContinue}
          />
        )}
      </div>
    }
  />
);
