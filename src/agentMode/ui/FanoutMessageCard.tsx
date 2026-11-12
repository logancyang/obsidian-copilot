import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";
import {
  defaultFanoutOption,
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
  message: AgentChatMessage;
  turn: FanoutTurn;
  app: App;
  footerStart?: React.ReactNode;
}

export const FanoutMessageCard: React.FC<FanoutMessageCardProps> = memo(
  ({ message, turn, app, footerStart }) => {
    const [selected, setSelected] = useState<FanoutOptionValue>(() => defaultFanoutOption(turn));

    const activeValue =
      selected !== FANOUT_SUMMARY_OPTION && !turn.answers[selected]
        ? FANOUT_SUMMARY_OPTION
        : selected;

    const currentText = useMemo(
      () =>
        activeValue === FANOUT_SUMMARY_OPTION
          ? renderFanoutComposite(turn)
          : (turn.answers[activeValue]?.text ?? ""),
      [turn, activeValue]
    );

    const handleInsert = useCallback(() => {
      void insertAtCursor(app, currentText);
    }, [app, currentText]);

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
