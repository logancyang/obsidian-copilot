import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { BottomLoadingIndicator } from "@/components/chat-components/BottomLoadingIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentChatMessage, CurrentPlan } from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo, useMemo } from "react";

interface AgentChatMessagesProps {
  messages: AgentChatMessage[];
  app: App;
  onDelete: (messageId: string) => void;
  currentPlan: CurrentPlan | null;
  chatBackend: AgentChatBackend;
  /** True while a turn is in flight. The last assistant message in the
   *  visible list is treated as the streaming placeholder. */
  isLoading: boolean;
}

/**
 * Maps an AgentChatMessage to the subset of ChatMessage fields that
 * `ChatSingleMessage` consumes. Lets us reuse the leaf message renderer
 * without coupling Agent Mode types to the legacy `ChatMessage` shape.
 */
function toChatMessageView(m: AgentChatMessage): ChatMessage {
  return {
    id: m.id,
    sender: m.sender,
    message: m.message,
    timestamp: m.timestamp,
    isVisible: m.isVisible,
    isErrorMessage: m.isErrorMessage,
    content: m.content,
    context: m.context,
  };
}

const AgentChatMessages = memo(
  ({ messages, app, onDelete, currentPlan, chatBackend, isLoading }: AgentChatMessagesProps) => {
    const visible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
    const adapted = useMemo(() => visible.map(toChatMessageView), [visible]);
    const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useChatScrolling({
      chatHistory: adapted,
    });

    const showPlanCard = currentPlan != null && currentPlan.decision === "pending";
    const inlinePlanCard = showPlanCard ? (
      <PlanProposalCard plan={currentPlan} app={app} chatBackend={chatBackend} />
    ) : null;

    // The last visible assistant message is the streaming placeholder while
    // a turn is in flight. Used to drive the reasoning-block timer / spinner
    // for the matching message only.
    const streamingMessageId = useMemo(() => {
      if (!isLoading) return undefined;
      for (let i = visible.length - 1; i >= 0; i--) {
        if (visible[i].sender !== USER_SENDER) return visible[i].id;
      }
      return undefined;
    }, [isLoading, visible]);

    // Show the bottom loader only when the turn is in flight and nothing
    // structured has streamed yet — otherwise the reasoning block, action
    // cards, or streamed text already signal progress.
    const showBottomLoader = useMemo(() => {
      if (!isLoading) return false;
      const streaming = streamingMessageId
        ? visible.find((m) => m.id === streamingMessageId)
        : undefined;
      return (streaming?.parts?.length ?? 0) === 0;
    }, [isLoading, streamingMessageId, visible]);

    if (visible.length === 0) {
      return (
        <div className="tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto">
          {showBottomLoader && <BottomLoadingIndicator />}
          {inlinePlanCard}
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        <div
          ref={scrollContainerCallbackRef}
          data-testid="chat-messages"
          className="tw-relative tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-scroll-smooth tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]"
        >
          {visible.map((message, index) => {
            const isLastMessage = index === visible.length - 1;
            // Reserve scroll headroom only when the last message is the
            // assistant AND there's no inline plan card below it — the card
            // already provides visible content at the tail of the stream.
            const shouldApplyMinHeight =
              isLastMessage && message.sender !== USER_SENDER && !showPlanCard;
            const adaptedMessage = adapted[index];
            // When an assistant message has structured parts, the trail owns
            // its entire body — `text` parts already cover streamed prose, so
            // an additional `ChatSingleMessage` would duplicate it.
            const isAssistant = message.sender !== USER_SENDER;
            const renderTrail = isAssistant && (message.parts?.length ?? 0) > 0;

            return (
              <div
                key={getMessageKey(adaptedMessage, index)}
                data-message-key={getMessageKey(adaptedMessage, index)}
                className="tw-w-full"
                style={{
                  minHeight: shouldApplyMinHeight ? `${containerMinHeight}px` : "auto",
                }}
              >
                {renderTrail ? (
                  <div className="tw-px-3 tw-pt-2">
                    <AgentTrail
                      parts={message.parts!}
                      isStreaming={message.id === streamingMessageId}
                      app={app}
                    />
                  </div>
                ) : (
                  <ChatSingleMessage
                    message={adaptedMessage}
                    app={app}
                    isStreaming={false}
                    onDelete={() => onDelete(message.id)}
                  />
                )}
              </div>
            );
          })}
          {showBottomLoader && <BottomLoadingIndicator />}
          {inlinePlanCard}
        </div>
      </div>
    );
  }
);

AgentChatMessages.displayName = "AgentChatMessages";

export default AgentChatMessages;
