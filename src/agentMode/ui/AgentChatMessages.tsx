import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo, useMemo } from "react";

interface AgentChatMessagesProps {
  messages: AgentChatMessage[];
  app: App;
  currentPlan: CurrentPlan | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
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

/** The last non-user (assistant) message, or `undefined` if none. */
function lastAssistant(visible: AgentChatMessage[]): AgentChatMessage | undefined {
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].sender !== USER_SENDER) return visible[i];
  }
  return undefined;
}

const AgentChatMessages = memo(
  ({
    messages,
    app,
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
    chatBackend,
    isLoading,
  }: AgentChatMessagesProps) => {
    const visible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
    const adapted = useMemo(() => visible.map(toChatMessageView), [visible]);
    const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useChatScrolling({
      chatHistory: adapted,
    });

    const showPlanCard = currentPlan != null && currentPlan.decision === "pending";
    const inlinePlanCard = showPlanCard ? (
      <PlanProposalCard plan={currentPlan} app={app} chatBackend={chatBackend} />
    ) : null;
    const inlineToolPermissionCards = pendingToolPermissions.map((req) => (
      <ToolPermissionCard
        key={req.toolCall.toolCallId}
        request={req}
        onResolve={chatBackend.resolveToolPermission.bind(chatBackend)}
      />
    ));
    const inlineAskUserQuestionCards = pendingAskUserQuestions.map((req) => (
      <AskUserQuestionCard
        key={req.requestId}
        request={req}
        onResolve={chatBackend.resolveAskUserQuestion.bind(chatBackend)}
      />
    ));
    const hasTailCards =
      showPlanCard || pendingToolPermissions.length > 0 || pendingAskUserQuestions.length > 0;

    // The latest assistant message owns both timer states: it ticks while that
    // turn is in flight, then retains the frozen duration until the next turn
    // appends a newer placeholder and naturally retires this row.
    const latestAssistant = useMemo(() => lastAssistant(visible), [visible]);
    const streamingMessageId = isLoading ? latestAssistant?.id : undefined;

    if (visible.length === 0) {
      return (
        <div className="tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto tw-px-3 tw-pt-2">
          {inlinePlanCard}
          {inlineToolPermissionCards}
          {inlineAskUserQuestionCards}
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
            // assistant AND there's nothing pinned at the tail (plan card or
            // tool-permission card) — those already provide visible content
            // at the bottom of the stream.
            const shouldApplyMinHeight =
              isLastMessage && message.sender !== USER_SENDER && !hasTailCards;
            const adaptedMessage = adapted[index];
            // When an assistant message has structured parts, the trail owns
            // its entire body — `text` parts already cover streamed prose, so
            // an additional `ChatSingleMessage` would duplicate it.
            const isAssistant = message.sender !== USER_SENDER;
            const hasParts = (message.parts?.length ?? 0) > 0;
            const renderTrail = isAssistant && hasParts;
            const ownsTurnDuration = isAssistant && message.id === latestAssistant?.id;
            const completedTurnDurationMs = ownsTurnDuration ? message.turnDurationMs : undefined;
            const runningTurnStartedAtMs =
              ownsTurnDuration && message.id === streamingMessageId
                ? message.timestamp?.epoch
                : undefined;
            const completedTurnDuration =
              completedTurnDurationMs !== undefined ? (
                <AgentTurnDurationIndicator
                  status="complete"
                  durationMs={completedTurnDurationMs}
                  inline
                />
              ) : null;
            const runningTurnDuration =
              runningTurnStartedAtMs !== undefined ? (
                <AgentTurnDurationIndicator status="running" startedAtMs={runningTurnStartedAtMs} />
              ) : null;
            // The streaming placeholder (empty body, no parts) renders the
            // whole-turn timer in-place, so the user sees progress the moment
            // they hit send rather than an empty assistant bubble.
            const isStreamingPlaceholder =
              isAssistant && message.id === streamingMessageId && !hasParts && !message.message;
            // A multi-agent turn owns this message's body — the segmented tab
            // row replaces the plain assistant text and the streaming spinner
            // (its per-agent slots show their own live states). `message.fanout`
            // is present for BOTH the live in-flight turn and a reloaded
            // transcript whose composite body was parsed back into a turn.
            const fanoutTurn = isAssistant ? message.fanout : undefined;

            return (
              <div
                key={getMessageKey(adaptedMessage, index)}
                data-message-key={getMessageKey(adaptedMessage, index)}
                className="tw-w-full"
                style={{
                  minHeight: shouldApplyMinHeight ? `${containerMinHeight}px` : "auto",
                }}
              >
                {fanoutTurn ? (
                  <div className="tw-px-3 tw-pt-2">
                    <FanoutMessageCard
                      message={message}
                      turn={fanoutTurn}
                      app={app}
                      footerStart={completedTurnDuration}
                    />
                    {runningTurnDuration}
                  </div>
                ) : isStreamingPlaceholder ? (
                  <div className="tw-px-3 tw-pt-2">{runningTurnDuration}</div>
                ) : renderTrail ? (
                  <div className="tw-px-3 tw-pt-2">
                    <AgentTrail
                      parts={message.parts!}
                      isStreaming={message.id === streamingMessageId}
                      turnStartedAtMs={runningTurnStartedAtMs}
                      turnDurationMs={completedTurnDurationMs}
                      timestamp={message.timestamp?.display}
                      app={app}
                      turnStopReason={message.turnStopReason}
                    />
                  </div>
                ) : (
                  // Agent Mode has no per-message regenerate / edit / delete flow
                  // yet (ACP owns conversation history server-side), so no
                  // lifecycle handlers are wired — ChatButtons renders only the
                  // copy / insert actions it can honor.
                  <>
                    <ChatSingleMessage
                      message={adaptedMessage}
                      app={app}
                      isStreaming={false}
                      footerStart={completedTurnDuration}
                    />
                    {runningTurnDuration ? (
                      <div className="tw-px-3">{runningTurnDuration}</div>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
          {inlinePlanCard}
          {inlineToolPermissionCards}
          {inlineAskUserQuestionCards}
        </div>
      </div>
    );
  }
);

AgentChatMessages.displayName = "AgentChatMessages";

export default AgentChatMessages;
