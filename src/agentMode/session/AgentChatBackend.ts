import type { ChatStateHost, ChatStates } from "@/agentMode/session/chatExtension";
import type { MessageContext } from "@/types/message";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import type {
  AgentChatMessage,
  AgentMemoryNotice,
  AgentQuestionAnswers,
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

export interface AgentChatBackend extends ChatStateHost {
  subscribe(listener: () => void): () => void;
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
  ): { id: string; turn: Promise<void> };
  acceptsMidTurnMessages(): boolean;
  getQueuedPrompts(): readonly QueuedPrompt[];
  canWithdrawMessages(): boolean;
  withdrawMessage(id: string): Promise<void>;
  takeWithdrawnPrompts(): readonly QueuedPrompt[];
  cancel(): Promise<void>;
  sendWaitingNow(): Promise<void>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];
  getTasks(): readonly AgentTask[];
  getTaskMessages(toolCallId: string): readonly AgentChatMessage[];
  canStopTasks(): boolean;
  stopTask(taskId: string): Promise<void>;

  getMemoryNotice(): AgentMemoryNotice | null;

  isStarting(): boolean;
  isTurnInFlight(): boolean;
  isReplyRunning(): boolean;

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

  getSessionUsage(): SessionUsage | null;

  getPlanUsage(): PlanUsage | null;

  hasPendingPlanPermission(): boolean;

  getPendingToolPermissions(): PermissionPrompt[];

  resolveToolPermission(toolCallId: string, optionId: string): void;

  getPendingAskUserQuestions(): AskUserQuestionPrompt[];

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void;

  getChatStates(): ChatStates;
}
