import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { placeChatCards } from "@/agentMode/ui/chatCards";
import { CHAT_CARD_SLOTS } from "@/agentMode/ui/chatCardSlots";
import type { ChatStates } from "@/agentMode/session/chatExtension";
import type CopilotPlugin from "@/main";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { copilotToolLabel } from "@/agentMode/ui/toolSummaries";
import { useCopilotToolCalls } from "@/agentMode/ui/copilotToolCall";
import { useAgentTasks } from "@/agentMode/ui/AgentTasksContext";
import { permissionRequesterName } from "@/agentMode/ui/taskDisplay";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { ChatTranscriptViewport } from "@/components/chat-components/ui/ChatTranscriptViewport";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AgentMessagePart,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { logError } from "@/logger";
import { App } from "obsidian";
import React, { memo, useMemo } from "react";

const EMPTY_PARTS = Object.freeze([]) as unknown as AgentMessagePart[];

interface AgentChatMessagesProps {
  messages: AgentChatMessage[];
  plugin: CopilotPlugin;
  sourcePath?: string;
  currentPlan: CurrentPlan | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  chatBackend: AgentChatBackend;
  isLoading: boolean;
  chatStates: ChatStates;
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
function findToolCall(messages: AgentChatMessage[], toolCallId: string): ToolCallPart | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const part = messages[i].parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
    if (part?.kind === "tool_call") return part;
  }
  return undefined;
}

function lastAssistant(visible: AgentChatMessage[]): AgentChatMessage | undefined {
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].sender !== USER_SENDER) return visible[i];
  }
  return undefined;
}

interface AgentMessageRowProps {
  message: AgentChatMessage;
  app: App;
  sourcePath: string;
  isLatestAssistant: boolean;
  isStreaming: boolean;
  trailingCard?: React.ReactNode;
}

// Completed messages retain their object identity across streaming updates, so
// stable row props keep their Markdown and trail renderers out of the live path.
// https://github.com/logancyang/obsidian-copilot/issues/3343
const AgentMessageRow = memo(function AgentMessageRow({
  message,
  app,
  sourcePath,
  isLatestAssistant,
  isStreaming,
  trailingCard,
}: AgentMessageRowProps) {
  const adaptedMessage = toChatMessageView(message);
  const isAssistant = message.sender !== USER_SENDER;
  const hasParts = (message.parts?.length ?? 0) > 0;
  // A reply the agent cancelled before any text or tool activity still owes the user its stop notice. https://github.com/logancyang/obsidian-copilot/issues/4062
  const renderTrail = isAssistant && (hasParts || message.agentCancelCause !== undefined);
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
    // Off-screen turns skip paint so scrolling a long chat costs what is on screen, not the whole transcript.
    // https://github.com/logancyang/obsidian-copilot/issues/3343
    <div className="tw-w-full [contain-intrinsic-size:auto_500px] [content-visibility:auto]">
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
            parts={message.parts ?? EMPTY_PARTS}
            isStreaming={isStreaming}
            turnStartedAtMs={runningTurnStartedAtMs}
            turnDurationMs={completedTurnDurationMs}
            timestamp={message.timestamp?.display}
            app={app}
            turnStopReason={message.turnStopReason}
            agentCancelCause={message.agentCancelCause}
            errorText={message.isErrorMessage ? message.message : undefined}
            fileChanges={message.fileChanges}
            onOpenFileChange={(change) =>
              void openTurnDiff(app, change, message.id).catch((error: unknown) =>
                logError("[AgentChatMessages] failed to open the turn diff", error)
              )
            }
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
      {trailingCard}
    </div>
  );
});

const AgentChatMessages = memo(
  ({
    messages,
    plugin,
    sourcePath = "",
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
    chatBackend,
    isLoading,
    chatStates,
  }: AgentChatMessagesProps) => {
    const { app } = plugin;
    const visible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
    const adapted = useMemo(() => visible.map(toChatMessageView), [visible]);
    const {
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
    const pendingToolCall = useMemo(
      () =>
        pendingPermission
          ? findToolCall(messages, pendingPermission.toolCall.toolCallId)
          : undefined,
      [messages, pendingPermission]
    );
    const copilotToolCalls = useCopilotToolCalls();
    const pendingCopilotTool = pendingToolCall
      ? copilotToolLabel(pendingToolCall, copilotToolCalls)
      : null;
    // A connector tool's request names it by the service's id, which users don't know.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
    // OpenCode's request names only its `execute` wrapper, which hides the Copilot tool about to run.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/872
    const pendingRequest = useMemo(
      () =>
        pendingPermission && pendingCopilotTool
          ? {
              ...pendingPermission,
              toolCall: { ...pendingPermission.toolCall, title: pendingCopilotTool },
            }
          : pendingPermission,
      [pendingPermission, pendingCopilotTool]
    );
    const tasks = useAgentTasks();
    const pendingRequester =
      pendingPermission && tasks
        ? permissionRequesterName(pendingPermission, tasks.tasks)
        : undefined;
    // Questions take priority so the separate resolver queues have a stable
    // presentation policy without carrying cross-type sequencing state.
    // https://github.com/logancyang/obsidian-copilot/issues/2948
    const pendingActionId = pendingQuestion
      ? `question:${pendingQuestion.requestId}`
      : pendingPermission
        ? `permission:${pendingPermission.toolCall.toolCallId}`
        : null;

    const chatCards = useMemo(
      () =>
        placeChatCards(
          visible,
          messages,
          chatStates,
          { plugin, chat: chatBackend },
          CHAT_CARD_SLOTS
        ),
      [visible, messages, chatStates, plugin, chatBackend]
    );

    const latestAssistant = useMemo(() => lastAssistant(visible), [visible]);
    // The chat keeps running while Claude waits on its subagents with no reply open, so only an unfinished reply gets the live timer. https://github.com/Brevilabs/obsidian-copilot-private/issues/757
    const streamingMessageId =
      isLoading && !latestAssistant?.turnStopReason ? latestAssistant?.id : undefined;

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
            return (
              <AgentMessageRow
                key={getMessageKey(adapted[index], index)}
                message={message}
                app={app}
                sourcePath={sourcePath}
                isLatestAssistant={
                  message.sender !== USER_SENDER && message.id === latestAssistant?.id
                }
                isStreaming={message.id === streamingMessageId}
                trailingCard={chatCards.get(index)}
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
            // max-h + overflow-y: a verbose question can exceed a short chat pane, and its
            // resolution controls must stay reachable.
            // https://github.com/logancyang/obsidian-copilot/issues/2948
            // select-text: Obsidian turns off text selection app-wide and only the transcript
            // turns it back on, so cards in this rail could not be selected or copied.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/863
            className="tw-max-h-full tw-w-full tw-select-text tw-overflow-y-auto tw-bg-primary"
          >
            <div key={pendingActionId} data-action-id={pendingActionId}>
              {pendingQuestion ? (
                <AskUserQuestionCard
                  request={pendingQuestion}
                  onResolve={chatBackend.resolveAskUserQuestion.bind(chatBackend)}
                />
              ) : pendingRequest ? (
                <ToolPermissionCard
                  request={pendingRequest}
                  toolName={pendingCopilotTool ? undefined : pendingToolCall?.title}
                  requester={pendingRequester}
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
