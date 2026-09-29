import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { InterruptedTurnCard } from "@/agentMode/ui/InterruptedTurnCard";
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
import { logError } from "@/logger";
import { err2String } from "@/utils";
import { App, Notice } from "obsidian";
import React, { memo, useMemo } from "react";

interface AgentChatMessagesProps {
  messages: AgentChatMessage[];
  app: App;
  sourcePath?: string;
  currentPlan: CurrentPlan | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  chatBackend: AgentChatBackend;
  isLoading: boolean;
  hasInterruptedTurn?: boolean;
  canResumeInterruptedTurn?: boolean;
}

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

// A permission card names the tool its request omits from the chat's own tool call.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/599
function findToolCallTitle(messages: AgentChatMessage[], toolCallId: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const part = messages[i].parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
    if (part?.kind === "tool_call") return part.title;
  }
  return undefined;
}

function resendInterruptedTurn(send: () => void): void {
  try {
    send();
  } catch (e) {
    logError("[AgentMode] could not continue the interrupted turn", e);
    new Notice(err2String(e));
  }
}

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
    hasInterruptedTurn = false,
    canResumeInterruptedTurn = false,
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
    const pendingToolName = useMemo(
      () =>
        pendingPermission
          ? findToolCallTitle(messages, pendingPermission.toolCall.toolCallId)
          : undefined,
      [messages, pendingPermission]
    );
    // Questions take priority so the separate resolver queues have a stable
    // presentation policy without carrying cross-type sequencing state.
    // https://github.com/logancyang/obsidian-copilot/issues/2948
    const pendingActionId = pendingQuestion
      ? `question:${pendingQuestion.requestId}`
      : pendingPermission
        ? `permission:${pendingPermission.toolCall.toolCallId}`
        : null;

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
          {hasInterruptedTurn && !isLoading ? (
            <InterruptedTurnCard
              onResume={
                canResumeInterruptedTurn
                  ? () => resendInterruptedTurn(() => chatBackend.resumeInterruptedTurn())
                  : undefined
              }
              onRetry={() => resendInterruptedTurn(() => chatBackend.retryInterruptedTurn())}
            />
          ) : null}
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
                  toolName={pendingToolName}
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
