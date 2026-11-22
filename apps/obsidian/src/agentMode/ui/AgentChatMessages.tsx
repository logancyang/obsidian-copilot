import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { placeChatCards } from "@/agentMode/ui/chatCards";
import { CHAT_CARD_SLOTS } from "@/agentMode/ui/chatCardSlots";
import type { ChatStates } from "@/agentMode/session/chatExtension";
import type CopilotPlugin from "@/main";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { toolUseLabel } from "@/agentMode/session/copilotToolCalls";
import { useAgentTasks } from "@/agentMode/ui/AgentTasksContext";
import { permissionRequesterName } from "@/agentMode/ui/taskDisplay";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { MemorySaveLines, memorySaveTrail } from "@/agents/agentMode/memorySaveCards";
import { AgentReplyMessage } from "@/agents/agentMode/ui/AgentReplyMessage";
import { relayRuns } from "@/agents/agentMode/agentRelays";
import type { AgentReply } from "@/agents/agentReply";
import type { AgentMention } from "@/agents/agentMentions";
import { AskedAgentRequester } from "@/agents/agentMode/ui/AskedAgentRequester";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { ChatDayLabel } from "@/components/chat-components/ui/ChatDayLabel";
import { ChatTranscriptViewport } from "@/components/chat-components/ui/ChatTranscriptViewport";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import { useDayLabels } from "@/hooks/useDayLabels";
import { useTailPaging } from "@/hooks/useTailPaging";
import { cn } from "@/lib/utils";
import { groupResponses, joinResponseText, type ChatMessageRole } from "@/lib/chatResponses";
import { agentResponseText } from "@/agentMode/ui/agentTrail";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AgentMessagePart,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
  TurnFileChange,
} from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { logError } from "@/logger";
import { App } from "obsidian";
import React, { memo, useCallback, useMemo, useRef } from "react";

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
  onContinueFrom?: (messageId: string) => Promise<unknown>;
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

function replyText(message: AgentChatMessage): string {
  return message.parts?.length ? agentResponseText(message.parts) : message.message;
}

function addedDurations(replies: readonly AgentChatMessage[]): number | undefined {
  const durations = replies.flatMap((m) =>
    m.turnDurationMs === undefined ? [] : [m.turnDurationMs]
  );
  return durations.length > 0 ? durations.reduce((sum, ms) => sum + ms, 0) : undefined;
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
  responseText?: string;
  responseDurationMs?: number;
  isStreaming: boolean;
  trailingCard?: React.ReactNode;
  onContinueFrom?: (messageId: string) => void;
  agentReply?: AgentReply;
  relayRun?: AgentMention;
}

// Completed messages retain their object identity across streaming updates, so
// stable row props keep their Markdown and trail renderers out of the live path.
// https://github.com/logancyang/obsidian-copilot/issues/3343
const AgentMessageRow = memo(function AgentMessageRow({
  message,
  app,
  sourcePath,
  responseText,
  responseDurationMs,
  isStreaming,
  trailingCard,
  onContinueFrom,
  agentReply,
  relayRun,
}: AgentMessageRowProps) {
  const adaptedMessage = toChatMessageView(message);
  const isAssistant = message.sender !== USER_SENDER;
  const hasParts = (message.parts?.length ?? 0) > 0;
  // A reply the agent cancelled before any text or tool activity still owes the user its stop notice. https://github.com/logancyang/obsidian-copilot/issues/4062
  const renderTrail = isAssistant && (hasParts || message.agentCancelCause !== undefined);
  const endsResponse = responseText !== undefined;
  const runningTurnStartedAtMs = isStreaming ? message.timestamp?.epoch : undefined;
  const completedTurnDuration =
    responseDurationMs !== undefined ? (
      <AgentTurnDurationIndicator status="complete" durationMs={responseDurationMs} inline />
    ) : null;
  const runningTurnDuration =
    runningTurnStartedAtMs !== undefined ? (
      <AgentTurnDurationIndicator status="running" startedAtMs={runningTurnStartedAtMs} />
    ) : null;
  const isStreamingPlaceholder = isAssistant && isStreaming && !hasParts && !message.message;
  const memorySaves = useMemo(() => memorySaveTrail(message), [message]);
  const onContinue = endsResponse && onContinueFrom ? () => onContinueFrom(message.id) : undefined;
  const openFileChange = (change: TurnFileChange) =>
    void openTurnDiff(app, change, message.id).catch((error: unknown) =>
      logError("[AgentChatMessages] failed to open the turn diff", error)
    );

  return (
    // Off-screen turns skip paint so scrolling a long chat costs what is on screen, not the whole transcript.
    // https://github.com/logancyang/obsidian-copilot/issues/3343
    // A user message's floating bar reaches past its row, which paint containment would cut off.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/971
    <div
      className={cn(
        "tw-w-full",
        isAssistant && "[contain-intrinsic-size:auto_500px] [content-visibility:auto]"
      )}
    >
      {/* A reply opened from its note, or saved before the save_memory tool, has no call to put the save in place of. https://github.com/Brevilabs/obsidian-copilot-private/issues/988 */}
      {memorySaves && memorySaves.unplaced.length > 0 && !agentReply ? (
        <div className="tw-px-3 tw-pt-2">
          <MemorySaveLines saves={memorySaves.unplaced} app={app} />
        </div>
      ) : null}
      {isStreamingPlaceholder ? (
        <div className="tw-px-3 tw-pt-2">{runningTurnDuration}</div>
      ) : renderTrail ? (
        <div className="tw-px-3 tw-pt-2">
          <AgentTrail
            parts={message.parts ?? EMPTY_PARTS}
            isStreaming={isStreaming}
            turnStartedAtMs={runningTurnStartedAtMs}
            turnDurationMs={responseDurationMs}
            timestampMs={message.timestamp?.epoch}
            responseText={responseText}
            hideFooter={!endsResponse}
            app={app}
            turnStopReason={message.turnStopReason}
            agentCancelCause={message.agentCancelCause}
            errorText={message.isErrorMessage ? message.message : undefined}
            fileChanges={message.fileChanges}
            memorySaves={memorySaves}
            onContinue={onContinue}
            onOpenFileChange={openFileChange}
          />
        </div>
      ) : agentReply ? (
        <AgentReplyMessage
          marker={agentReply.marker}
          reply={agentReply.reply}
          run={relayRun}
          fileChanges={message.fileChanges}
          onOpenFileChange={openFileChange}
        >
          {memorySaves ? <MemorySaveLines saves={memorySaves.saves} app={app} /> : null}
        </AgentReplyMessage>
      ) : (
        <>
          <ChatSingleMessage
            sourcePath={sourcePath}
            message={adaptedMessage}
            app={app}
            isStreaming={false}
            footerStart={completedTurnDuration}
            responseText={responseText}
            hideFooter={isAssistant && !endsResponse}
            onContinue={onContinue}
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
    onContinueFrom,
  }: AgentChatMessagesProps) => {
    const { app } = plugin;
    const visible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
    const adapted = useMemo(() => visible.map(toChatMessageView), [visible]);
    const isUserMessageAt = useCallback(
      (index: number) => visible[index]?.sender === USER_SENDER,
      [visible]
    );
    // Rendering a long chat all at once on reopen exhausted Obsidian's memory; older turns load as the user scrolls up. https://github.com/logancyang/obsidian-copilot/issues/4248
    const { first, sentinelRef } = useTailPaging(visible.length, isUserMessageAt);
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
    const pendingCopilotTool = toolUseLabel(pendingToolCall?.copilotTools);
    // A connector tool's request names it by the service's id, which users don't know.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
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
    const requester = pendingPermission?.requester;
    // An @-mentioned agent's card shows that agent's face and name where a subagent's shows its task.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/946
    const pendingRequester =
      typeof requester === "object" && "agent" in requester ? (
        <AskedAgentRequester agent={requester.agent} />
      ) : pendingPermission && tasks ? (
        permissionRequesterName(pendingPermission, tasks.tasks)
      ) : undefined;
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
    const dayLabels = useDayLabels(visible);
    const relays = useMemo(() => relayRuns(visible), [visible]);
    // A second click before the new chat opens would open it twice.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/908
    const continuing = useRef(false);
    const continueOnce = useCallback(
      (messageId: string) => {
        if (continuing.current || !onContinueFrom) return;
        continuing.current = true;
        void onContinueFrom(messageId).finally(() => (continuing.current = false));
      },
      [onContinueFrom]
    );
    // A chat is continued from a finished conversation, so the action waits for the reply in progress.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/908
    const continueFrom = isLoading || !onContinueFrom ? undefined : continueOnce;
    // The chat keeps running while Claude waits on its subagents with no reply open, so only an unfinished reply gets the live timer. https://github.com/Brevilabs/obsidian-copilot-private/issues/757
    const streamingMessageId =
      isLoading && !latestAssistant?.turnStopReason ? latestAssistant?.id : undefined;
    const responses = useMemo(
      () =>
        groupResponses(
          visible.map(
            (m): ChatMessageRole =>
              m.sender !== USER_SENDER ? "reply" : relays.has(m.id) ? "other" : "typed"
          )
        ),
      [visible, relays]
    );
    const newestResponse = responses.findLastIndex((response) => response.replies.length > 0);

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        <ChatTranscriptViewport
          scrollContainerRef={scrollContainerCallbackRef}
          contentRef={contentCallbackRef}
          onScroll={onScroll}
          isScrollPaused={isScrollPaused}
          scrollToEnd={scrollToEnd}
        >
          {first > 0 ? (
            // The marker must not be the scroll anchor, or the view jumps when earlier turns load above it. https://github.com/logancyang/obsidian-copilot/issues/4248
            <div
              ref={sentinelRef}
              aria-hidden="true"
              className="tw-h-px tw-w-full [overflow-anchor:none]"
            />
          ) : null}
          {responses.map(({ messages, replies }, responseIndex) => {
            const shown = messages.filter((index) => index >= first);
            if (shown.length === 0) return null;
            const end = replies.at(-1);
            const endReplies = replies.map((index) => visible[index]);
            return (
              <div
                key={getMessageKey(adapted[messages[0]], messages[0])}
                className="tw-group/response"
              >
                {shown.map((index) => {
                  const message = visible[index];
                  const dayLabel = dayLabels.get(index);
                  const isStreaming = message.id === streamingMessageId;
                  return (
                    <React.Fragment key={getMessageKey(adapted[index], index)}>
                      {dayLabel ? <ChatDayLabel label={dayLabel} /> : null}
                      <AgentMessageRow
                        message={message}
                        app={app}
                        sourcePath={sourcePath}
                        responseText={
                          index === end ? joinResponseText(endReplies.map(replyText)) : undefined
                        }
                        responseDurationMs={
                          index === end && responseIndex === newestResponse && !isStreaming
                            ? addedDurations(endReplies)
                            : undefined
                        }
                        isStreaming={isStreaming}
                        trailingCard={chatCards.get(index)}
                        onContinueFrom={continueFrom}
                        agentReply={relays.get(message.id)?.relay}
                        relayRun={relays.get(message.id)?.run}
                      />
                    </React.Fragment>
                  );
                })}
              </div>
            );
          })}
          {inlinePlanCard}
        </ChatTranscriptViewport>
        {pendingActionId ? (
          <div
            role="region"
            aria-label="Pending actions"
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
