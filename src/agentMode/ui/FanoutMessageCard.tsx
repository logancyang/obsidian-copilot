import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";
import {
  defaultFanoutOption,
  fanoutDisplayName,
  FANOUT_SUMMARY_OPTION,
  type FanoutOptionValue,
} from "@/agentMode/ui/fanoutDropdown";
import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { renderFanoutComposite } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { insertAtCursor } from "@/utils";
import { App } from "obsidian";
import React, { memo, useCallback, useMemo, useState } from "react";

interface FanoutMessageCardProps {
  /** The assistant message owning a multi-agent fan-out turn. */
  message: AgentChatMessage;
  turn: FanoutTurn;
  app: App;
  /** Agent Mode metadata placed at the response footer's leading edge, before the timestamp. */
  footerStart?: React.ReactNode;
}

/**
 * The assistant card for a fan-out turn: the segmented tab row
 * ({@link FanoutTurnView}) plus the same action bar as the normal AI card. Its
 * one Copy/Insert affordance is context-aware — the WHOLE composite on the
 * Summary tab, just that agent's answer on an agent tab. The card owns the
 * selected tab so the action bar can target it.
 */
export const FanoutMessageCard: React.FC<FanoutMessageCardProps> = memo(
  ({ message, turn, app, footerStart }) => {
    const [selected, setSelected] = useState<FanoutOptionValue>(() => defaultFanoutOption(turn));

    // Fall back to the summary if the selected slot disappears (defensive).
    const activeValue =
      selected !== FANOUT_SUMMARY_OPTION && !turn.answers[selected]
        ? FANOUT_SUMMARY_OPTION
        : selected;

    // What Copy/Insert operate on: the whole composite on the Summary tab, else
    // just the selected agent's answer.
    const currentText = useMemo(
      () =>
        activeValue === FANOUT_SUMMARY_OPTION
          ? renderFanoutComposite(turn, fanoutDisplayName)
          : (turn.answers[activeValue]?.text ?? ""),
      [turn, activeValue]
    );

    const handleInsert = useCallback(() => {
      void insertAtCursor(app, currentText);
    }, [app, currentText]);

    // Reuse ChatButtons by handing it a view whose `message` is the selected tab's
    // text (its Copy reads `message.message`).
    const buttonsMessage = useMemo<ChatMessage>(
      () => ({
        id: message.id,
        sender: message.sender,
        message: currentText,
        timestamp: message.timestamp,
        isVisible: message.isVisible,
      }),
      [message.id, message.sender, message.timestamp, message.isVisible, currentText]
    );

    return (
      <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
        <div className="tw-group tw-mx-2 tw-rounded-md tw-p-2">
          <div className="tw-flex tw-max-w-full tw-flex-col tw-gap-2 tw-overflow-hidden">
            <FanoutTurnView turn={turn} app={app} value={activeValue} onSelect={setSelected} />
            <AssistantResponseFooter
              leading={footerStart}
              timestamp={message.timestamp?.display}
              actions={
                <ChatButtons
                  message={buttonsMessage}
                  onInsertIntoEditor={handleInsert}
                  hasSources={false}
                />
              }
            />
          </div>
        </div>
      </div>
    );
  }
);
FanoutMessageCard.displayName = "FanoutMessageCard";
