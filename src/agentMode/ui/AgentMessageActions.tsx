import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { insertAtCursor } from "@/utils";
import { GitBranchPlus, TextCursorInput } from "lucide-react";
import { App } from "obsidian";
import React from "react";

interface AgentMessageActionsProps {
  text: string;
  app: App;
  durationMs?: number;
  timestampMs?: number;
  onContinue?: () => void;
}

export const AgentMessageActions: React.FC<AgentMessageActionsProps> = ({
  text,
  app,
  durationMs,
  timestampMs,
  onContinue,
}) => (
  <AssistantResponseFooter
    leading={
      durationMs !== undefined ? (
        <AgentTurnDurationIndicator status="complete" durationMs={durationMs} inline />
      ) : undefined
    }
    timestampMs={timestampMs}
    actions={
      <div className="tw-flex tw-items-center tw-gap-1">
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
