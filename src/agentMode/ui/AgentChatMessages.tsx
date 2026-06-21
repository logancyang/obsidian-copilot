import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { BottomLoadingIndicator } from "@/components/chat-components/BottomLoadingIndicator";
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

    // The last visible assistant message is the streaming placeholder while
    // a turn is in flight — drives the reasoning-block timer/spinner and the
    // persistent "Thinking" loader below it. The bottom loader is suppressed
    // when the streaming message's tail part is a `thought` (the reasoning
    // block already spins) and when the bubble is still entirely empty (the
    // in-place `isStreamingPlaceholder` spinner covers that).
    const { streamingMessageId, showBottomLoader } = useMemo(() => {
      if (!isLoading) return { streamingMessageId: undefined, showBottomLoader: false };
      const streaming = lastAssistant(visible);
      if (!streaming) return { streamingMessageId: undefined, showBottomLoader: false };
      const parts = streaming.parts ?? [];
      const last = parts[parts.length - 1];
      const hasParts = parts.length > 0;
      const hasBody = !!streaming.message;
      const showLoader = last?.kind !== "thought" && (hasParts || hasBody);
      return { streamingMessageId: streaming.id, showBottomLoader: showLoader };
    }, [isLoading, visible]);

    if (visible.length === 0) {
      return (
        <div className="tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto tw-px-3 tw-pt-2">
          {isLoading && <BottomLoadingIndicator />}
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
            // The streaming placeholder (empty body, no parts) renders as a
            // thinking spinner in-place, so the user sees progress the moment
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
                    <FanoutMessageCard message={message} turn={fanoutTurn} app={app} />
                  </div>
                ) : isStreamingPlaceholder ? (
                  <div className="tw-px-3 tw-pt-2">
                    <BottomLoadingIndicator />
                  </div>
                ) : renderTrail ? (
                  <div className="tw-px-3 tw-pt-2">
                    <AgentTrail
                      parts={message.parts!}
                      isStreaming={message.id === streamingMessageId}
                      showThinkingTail={message.id === streamingMessageId && showBottomLoader}
                      app={app}
                      turnStopReason={message.turnStopReason}
                      turnDurationMs={message.turnDurationMs}
                    />
                  </div>
                ) : (
                  // Agent Mode has no per-message regenerate / edit / delete flow
                  // yet (ACP owns conversation history server-side), so no
                  // lifecycle handlers are wired — ChatButtons renders only the
                  // copy / insert actions it can honor.
                  <ChatSingleMessage message={adaptedMessage} app={app} isStreaming={false} />
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
