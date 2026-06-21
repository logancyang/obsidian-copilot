import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";
import {
  defaultFanoutOption,
  fanoutDisplayName,
  FANOUT_SUMMARY_OPTION,
  type FanoutOptionValue,
} from "@/agentMode/ui/fanoutDropdown";
import { ChatButtons } from "@/components/chat-components/ChatButtons";
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
}

/**
 * The assistant card for a multi-agent fan-out turn. Renders the segmented tab
 * row ({@link FanoutTurnView}) as the body, then the SAME action bar as the
 * normal Agent-Mode AI card (timestamp + Insert / Replace + Copy; no
 * Regenerate/Edit/Delete are wired in Agent Mode, so none show).
 *
 * There is ONE copy/insert affordance, and it is context-aware: on the Summary
 * tab it acts on the WHOLE composite (summary + every agent's answer — the
 * default tab, so copy-all is one click away); on an agent tab it acts on just
 * that agent's answer. The card owns the selected tab so the action bar can
 * target it.
 */
export const FanoutMessageCard: React.FC<FanoutMessageCardProps> = memo(
  ({ message, turn, app }) => {
    const [selected, setSelected] = useState<FanoutOptionValue>(() => defaultFanoutOption(turn));

    // If the selected agent's slot disappears (defensive — slots are stable
    // within a turn), fall back to the summary rather than targeting nothing.
    const activeValue =
      selected !== FANOUT_SUMMARY_OPTION && !turn.answers[selected]
        ? FANOUT_SUMMARY_OPTION
        : selected;

    // The text the action bar's Copy/Insert operate on: the whole composite on
    // the Summary tab (markers stripped — readable prose, the copy-all path),
    // otherwise just the selected agent's answer.
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

    // Reuse ChatButtons by handing it a view whose `message` is the selected
    // tab's text — its Copy reads `message.message`, keeping the affordance
    // identical to the normal AI card (same component).
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
