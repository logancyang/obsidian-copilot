import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { ChatTranscriptViewport } from "@/components/chat-components/ui/ChatTranscriptViewport";
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
  sourcePath?: string;
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

interface AgentMessageRowProps {
  message: AgentChatMessage;
  messageKey: string;
  app: App;
  sourcePath: string;
  isLatestAssistant: boolean;
  isStreaming: boolean;
  minHeight?: number;
}

// Completed messages retain their object identity across streaming updates, so
// stable row props keep their Markdown and trail renderers out of the live path.
// https://github.com/logancyang/obsidian-copilot/issues/3343
const AgentMessageRow = memo(function AgentMessageRow({
  message,
  messageKey,
  app,
  sourcePath,
  isLatestAssistant,
  isStreaming,
  minHeight,
}: AgentMessageRowProps) {
  const adaptedMessage = toChatMessageView(message);
  const isAssistant = message.sender !== USER_SENDER;
  const hasParts = (message.parts?.length ?? 0) > 0;
  const renderTrail = isAssistant && hasParts;
  const completedTurnDurationMs = isLatestAssistant ? message.turnDurationMs : undefined;
  const runningTurnStartedAtMs =
    isLatestAssistant && isStreaming ? message.timestamp?.epoch : undefined;
  const completedTurnDuration =
    completedTurnDurationMs !== undefined ? (
      <AgentTurnDurationIndicator status="complete" durationMs={completedTurnDurationMs} inline />
    ) : null;
  const runningTurnDuration =
    runningTurnStartedAtMs !== undefined ? (
      <AgentTurnDurationIndicator status="running" startedAtMs={runningTurnStartedAtMs} />
    ) : null;
  const isStreamingPlaceholder = isAssistant && isStreaming && !hasParts && !message.message;
  const fanoutTurn = isAssistant ? message.fanout : undefined;

  return (
    <div
      data-message-key={messageKey}
      className="tw-w-full"
      style={{ minHeight: minHeight !== undefined ? `${minHeight}px` : "auto" }}
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
            isStreaming={isStreaming}
            turnStartedAtMs={runningTurnStartedAtMs}
            turnDurationMs={completedTurnDurationMs}
            timestamp={message.timestamp?.display}
            app={app}
            turnStopReason={message.turnStopReason}
          />
        </div>
      ) : (
        // Agent Mode has no per-message regenerate / edit / delete flow yet
        // (ACP owns conversation history server-side), so only copy / insert apply.
        <>
          <ChatSingleMessage
            sourcePath={sourcePath}
            message={adaptedMessage}
            app={app}
            isStreaming={false}
            footerStart={completedTurnDuration}
          />
          {runningTurnDuration ? <div className="tw-px-3">{runningTurnDuration}</div> : null}
        </>
      )}
    </div>
  );
});

const AgentChatMessages = memo(
  ({
    messages,
    app,
    sourcePath = "",
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
    chatBackend,
    isLoading,
  }: AgentChatMessagesProps) => {
    const visible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
    const adapted = useMemo(() => visible.map(toChatMessageView), [visible]);
    const {
      containerMinHeight,
      scrollContainerCallbackRef,
      contentCallbackRef,
      onScroll,
      isScrollPaused,
      scrollToEnd,
      getMessageKey,
    } = useChatScrolling({ chatHistory: adapted });

    const showPlanCard = currentPlan != null && currentPlan.decision === "pending";
    const inlinePlanCard = showPlanCard ? (
      <PlanProposalCard plan={currentPlan} app={app} chatBackend={chatBackend} />
    ) : null;
    const pendingQuestion = pendingAskUserQuestions[0];
    const pendingPermission = pendingQuestion ? undefined : pendingToolPermissions[0];
    // Questions take priority so the separate resolver queues have a stable
    // presentation policy without carrying cross-type sequencing state.
    // https://github.com/logancyang/obsidian-copilot/issues/2948
    const pendingActionId = pendingQuestion
      ? `question:${pendingQuestion.requestId}`
      : pendingPermission
        ? `permission:${pendingPermission.toolCall.toolCallId}`
        : null;

    // The latest assistant message owns both timer states: it ticks while that
    // turn is in flight, then retains the frozen duration until the next turn
    // appends a newer placeholder and naturally retires this row.
    const latestAssistant = useMemo(() => lastAssistant(visible), [visible]);
    const streamingMessageId = isLoading ? latestAssistant?.id : undefined;

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        <ChatTranscriptViewport
          scrollContainerRef={scrollContainerCallbackRef}
          contentRef={contentCallbackRef}
          onScroll={onScroll}
          isScrollPaused={isScrollPaused}
          scrollToEnd={scrollToEnd}
        >
          {visible.map((message, index) => {
            // A plan remains part of the transcript, so it supplies tail
            // content. Blocking actions live in their own rail and do not
            // change the transcript's scroll headroom.
            const shouldApplyMinHeight =
              index === visible.length - 1 && message.sender !== USER_SENDER && !showPlanCard;
            const messageKey = getMessageKey(adapted[index], index);

            return (
              <AgentMessageRow
                key={messageKey}
                messageKey={messageKey}
                message={message}
                app={app}
                sourcePath={sourcePath}
                isLatestAssistant={
                  message.sender !== USER_SENDER && message.id === latestAssistant?.id
                }
                isStreaming={message.id === streamingMessageId}
                minHeight={shouldApplyMinHeight ? containerMinHeight : undefined}
              />
            );
          })}
          {inlinePlanCard}
        </ChatTranscriptViewport>
        {pendingActionId ? (
          <div
            role="region"
            aria-label="Pending agent actions"
            data-testid="agent-action-rail"
            // A verbose question can exceed a short chat pane. Bound and scroll
            // the rail so its resolution controls remain reachable.
            // https://github.com/logancyang/obsidian-copilot/issues/2948
            className="tw-max-h-full tw-w-full tw-overflow-y-auto tw-bg-primary"
          >
            <div key={pendingActionId} data-action-id={pendingActionId}>
              {pendingQuestion ? (
                <AskUserQuestionCard
                  request={pendingQuestion}
                  onResolve={chatBackend.resolveAskUserQuestion.bind(chatBackend)}
                />
              ) : pendingPermission ? (
                <ToolPermissionCard
                  request={pendingPermission}
                  onResolve={chatBackend.resolveToolPermission.bind(chatBackend)}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
);

AgentChatMessages.displayName = "AgentChatMessages";

export default AgentChatMessages;
