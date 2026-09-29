import type { RecordedPrompt } from "./InterruptedTurnJournal";
import type { MessageContext } from "@/types/message";
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
  SessionUsage,
} from "./types";

export interface AgentChatBackend {
  subscribe(listener: () => void): () => void;
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
  ): { id: string; turn: Promise<void> };
  cancel(): Promise<void>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];

  isStarting(): boolean;
  isTurnInFlight(): boolean;

  getReadOnlyReason(): string | null;
  getInterruptedTurn(): RecordedPrompt | null;
  canResumeInterruptedTurn(): boolean;
  resumeInterruptedTurn(): void;
  retryInterruptedTurn(): void;

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
}
