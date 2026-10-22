import type { MessageContext } from "@/types/message";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import type {
  AgentChatMessage,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendId,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
  PlanDecisionAction,
  PromptContent,
  PlanUsage,
  QueuedPrompt,
  SessionUsage,
} from "./types";

export interface AgentChatBackend {
  subscribe(listener: () => void): () => void;
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>,
    options?: { interrupt?: boolean }
  ): { id: string; turn: Promise<void> };
  acceptsMidTurnMessages(): boolean;
  getQueuedPrompts(): readonly QueuedPrompt[];
  canWithdrawMessages(): boolean;
  withdrawMessage(id: string): Promise<void>;
  takeWithdrawnPrompts(): readonly QueuedPrompt[];
  cancel(): Promise<void>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];
  getTasks(): readonly AgentTask[];
  getTaskMessages(toolCallId: string): readonly AgentChatMessage[];
  canStopTasks(): boolean;
  stopTask(taskId: string): Promise<void>;

  isStarting(): boolean;
  isTurnInFlight(): boolean;

  getBackendState(): BackendState | null;
  canSwitchModel(): boolean | null;
  canSwitchEffort(): boolean | null;
  canSwitchMode(): boolean | null;

  resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ): Promise<void>;

  getCurrentPlan(): CurrentPlan | null;

  getCurrentTodoList(): AgentTodoListEntry[] | null;

  getSessionUsage(): SessionUsage | null;

  getPlanUsage(): PlanUsage | null;

  hasPendingPlanPermission(): boolean;

  getPendingToolPermissions(): PermissionPrompt[];

  resolveToolPermission(toolCallId: string, optionId: string): void;

  getPendingAskUserQuestions(): AskUserQuestionPrompt[];

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void;

  getFeedbackOffer(): FeedbackOffer | null;

  dismissFeedbackOffer(): void;

  markFeedbackReported(report: { reportId: string; issueUrl: string }): void;
}
