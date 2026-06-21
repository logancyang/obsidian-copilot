import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";
import { fanoutDisplayName } from "@/agentMode/ui/fanoutDropdown";
import { ChatButtons } from "@/components/chat-components/ChatButtons";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { renderFanoutComposite } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { insertAtCursor } from "@/utils";
import { App } from "obsidian";
import React, { memo, useCallback, useMemo } from "react";

interface FanoutMessageCardProps {
  /** The assistant message owning a multi-agent fan-out turn. */
  message: AgentChatMessage;
  turn: FanoutTurn;
  app: App;
}

/**
 * The assistant card for a multi-agent fan-out turn. Renders the segmented tab
 * row ({@link FanoutTurnView}) as the body, then the SAME action bar as the
 * normal Agent-Mode AI card (timestamp + Insert / Replace + Copy; no
 * Regenerate/Edit/Delete are wired in Agent Mode, so none show). The action
 * bar's Copy/Insert operate on the WHOLE composite ({@link renderFanoutComposite},
 * markers stripped); a per-slot copy on the selected answer lives inside
 * `FanoutTurnView` (the 2-tier copy/insert).
 */
export const FanoutMessageCard: React.FC<FanoutMessageCardProps> = memo(
  ({ message, turn, app }) => {
    // Clean composite (markers stripped) for the whole-card Copy/Insert. The
    // persisted body carries invisible section markers; this is the readable
    // prose the user actually wants on the clipboard / in their note.
    const composite = useMemo(() => renderFanoutComposite(turn, fanoutDisplayName), [turn]);

    const handleInsert = useCallback(() => {
      void insertAtCursor(app, composite);
    }, [app, composite]);

    // Reuse ChatButtons by handing it a view whose `message` is the clean
    // composite — its Copy reads `message.message`, so this keeps the two-tier
    // copy consistent with the normal AI card (same component, same affordances).
    const buttonsMessage = useMemo<ChatMessage>(
      () => ({
        id: message.id,
        sender: message.sender,
        message: composite,
        timestamp: message.timestamp,
        isVisible: message.isVisible,
      }),
      [message.id, message.sender, message.timestamp, message.isVisible, composite]
    );

    return (
      <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
        <div className="tw-group tw-mx-2 tw-rounded-md tw-p-2">
          <div className="tw-flex tw-max-w-full tw-flex-col tw-gap-2 tw-overflow-hidden">
            <FanoutTurnView turn={turn} app={app} />
            <div className="tw-flex tw-items-center tw-justify-between">
              <div className="tw-text-xs tw-text-faint">{message.timestamp?.display}</div>
              <ChatButtons
                message={buttonsMessage}
                onInsertIntoEditor={handleInsert}
                hasSources={false}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);
FanoutMessageCard.displayName = "FanoutMessageCard";
