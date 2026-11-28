import type { AgentMention } from "@/agents/agentMentions";
import type { MemorySave } from "@/agents/memorySaves";
import type React from "react";
import type { ModelCapability } from "@/constants";
import type { MessageContext } from "@/types/message";
import type {
  BackendState,
  CopilotMode,
  ModelEntry,
  ModelSelection,
} from "@copilot/protocol/backendState";
import type {
  AgentPlanEntry,
  CompactionSnapshot,
  PromptContent,
  StopReason,
  TranscriptMessage,
} from "@copilot/protocol/messages";
import type {
  PermissionDecision,
  PermissionOptionKind,
  PermissionPrompt,
} from "@copilot/protocol/permissions";
import type { PlanUsage } from "@copilot/protocol/planUsage";
import type { AgentQuestion, AgentQuestionAnswers } from "@copilot/protocol/questions";
import type { ProjectScopeId } from "@copilot/protocol/scope";
import type { SessionId } from "@copilot/protocol/session";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";
import type { TaskEndStatus, TaskStart } from "@copilot/protocol/tasks";
import type {
  AgentToolKind,
  AgentToolProgress,
  AgentToolStatus,
  CopilotToolUse,
  ToolCallContent,
  ToolCallSnapshot,
} from "@copilot/protocol/toolCalls";

export type {
  ApprovedRule,
  ApprovedRuleScope,
  ApprovedRuleStore,
  BackendAuth,
  BackendAuthStatus,
  BackendDescriptor,
  BackendSignInHandlers,
  InstallState,
  ManagedInstallAction,
  ManagedInstallActionState,
  ModelSelectionSession,
} from "./descriptor";
export type {
  BackendState,
  CopilotMode,
  ModeApplySpec,
  ModelApplySpec,
  ModelEntry,
  ModelSelection,
  ModelState,
  ModeOption,
} from "@copilot/protocol/backendState";
export type {
  AgentCancelCause,
  AgentMessagePart,
  AgentPlanEntry,
  CompactionSnapshot,
  CompactionStatus,
  CompactionTrigger,
  PromptContent,
  StopReason,
  TurnFileChange,
} from "@copilot/protocol/messages";
export type {
  AskedAgentRequester,
  PermissionDecision,
  PermissionOption,
  PermissionOptionKind,
  PermissionPrompt,
  PermissionRequester,
} from "@copilot/protocol/permissions";
export type { CurrentPlan, PlanDecisionAction, PlanProposalDecision } from "@copilot/protocol/plan";
export type { PlanUsage, UsageWindow } from "@copilot/protocol/planUsage";
export type { AgentQuestion, AgentQuestionAnswers } from "@copilot/protocol/questions";
export type { SessionId } from "@copilot/protocol/session";
export type { SessionUsage } from "@copilot/protocol/sessionUsage";
export type { TaskEndStatus, TaskKind, TaskStart } from "@copilot/protocol/tasks";
export type {
  AgentToolCallOutput,
  AgentToolKind,
  AgentToolProgress,
  AgentToolStatus,
  ToolCallContent,
  ToolCallSnapshot,
} from "@copilot/protocol/toolCalls";

export type BackendId = string;

export interface AgentBrand {
  readonly id: BackendId;
  readonly displayName: string;
  readonly Icon: React.ComponentType<{ className?: string }>;
}

export interface ModeMapping {
  kind: "setMode" | "configOption";
  configId?: string;
  canonical: Partial<Record<CopilotMode, string>>;
  unlistedModeShowsAs?: CopilotMode;
}

export type { EffortOption } from "@/lib/model-effort";

export { EFFORT_LEVELS_ASCENDING } from "@/lib/model-effort";

export interface BackendModelCatalog {
  availableModels: readonly ModelEntry[] | null;
}

export type EnabledModelCredentialState = "ok" | "missing_key";

export interface EnabledModelEntry {
  baseModelId: string;
  name: string;
  label?: string;
  description?: string;
  credentialState: EnabledModelCredentialState;
  capabilities?: ModelCapability[];
  isFree?: boolean;
  needsSelfHostWarning?: boolean;
}

export interface BlockedModels {
  baseModelIds: ReadonlySet<string>;
  reason: string;
  hint: string;
}

export interface ModelWireCodec {
  encode(selection: ModelSelection): string;

  decode(wireId: string): { selection: ModelSelection; provider: string | null };

  effortConfigFor?(baseModelId: string): BackendConfigOption | null;
}

export interface BackendModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

export interface RawModelState {
  currentModelId: string;
  availableModels: BackendModelInfo[];
}

export interface BackendModeInfo {
  id: string;
  name: string;
  description?: string;
}

export interface RawModeState {
  currentModeId: string;
  availableModes: BackendModeInfo[];
}

export type BackendConfigOption =
  | {
      id: string;
      type: "select";
      name?: string;
      description?: string;
      category?: string | null;
      currentValue: string;
      options: Array<
        | { value: string; name: string; description?: string }
        | {
            name: string;
            description?: string;
            options: Array<{ value: string; name: string; description?: string }>;
          }
      >;
    }
  | {
      id: string;
      type: "boolean";
      name?: string;
      description?: string;
      category?: string | null;
      currentValue: boolean;
    };

export interface ToolCallDelta {
  toolCallId: string;
  title?: string;
  kind?: AgentToolKind;
  status?: AgentToolStatus;
  rawInput?: unknown;
  originalFiles?: Readonly<Record<string, string | null>>;
  content?: ToolCallContent[] | null;
  locations?: Array<{ path: string; line?: number | null }> | null;
  vendorToolName?: string;
  mcpServer?: string;
  copilotTools?: CopilotToolUse;
  parentToolCallId?: string;
  progress?: AgentToolProgress;
  isPlanProposal?: boolean;
}

export interface PlanSummary {
  entries: AgentPlanEntry[];
}

export type SessionUpdate =
  | { sessionUpdate: "user_message_chunk"; content: PromptContent; messageId?: string }
  | { sessionUpdate: "agent_message_chunk"; content: PromptContent; messageId?: string }
  | { sessionUpdate: "agent_thought_chunk"; content: PromptContent; messageId?: string }
  | ({ sessionUpdate: "tool_call" } & ToolCallSnapshot)
  | ({ sessionUpdate: "tool_call_update" } & ToolCallDelta)
  | { sessionUpdate: "plan"; entries: AgentPlanEntry[] }
  | ({ sessionUpdate: "compaction" } & CompactionSnapshot)
  | { sessionUpdate: "session_info_update"; title?: string | null }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "config_option_update"; configOptions: BackendConfigOption[] }
  | { sessionUpdate: "state_changed"; state: BackendState }
  | { sessionUpdate: "usage_update"; usage: SessionUsage }
  | { sessionUpdate: "plan_usage_update"; planUsage: PlanUsage | null }
  | { sessionUpdate: "message_delivered"; promptId: string }
  | { sessionUpdate: "messages_withdrawn"; promptIds: string[] }
  | { sessionUpdate: "turn_started"; turnId: string; startedAt?: number }
  | ({ sessionUpdate: "turn_ended" } & TurnEnd)
  | { sessionUpdate: "busy_changed"; busy: boolean }
  | { sessionUpdate: "session_disconnected"; error: Error }
  | ({ sessionUpdate: "task_started" } & TaskStart)
  | {
      sessionUpdate: "task_progress";
      taskId: string;
      progress?: AgentToolProgress;
      model?: string;
      outputFile?: string;
    }
  | ({ sessionUpdate: "task_ended" } & TaskEnd);

export interface TaskEnd {
  taskId: string;
  status: TaskEndStatus;
  summary?: string;
  outputFile?: string;
}

export interface TurnEnd {
  turnId: string;
  stopReason: StopReason;
  error?: Error;
  turnDiff?: TurnDiff;
}

export interface SessionEvent {
  sessionId: SessionId;
  update: SessionUpdate;
  occurredAt?: number;
  taskToolCallId?: string;
}

export const PERMISSION_OPTION_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
];

export const PERMISSION_ALLOW_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
];

export const PERMISSION_REJECT_KINDS: readonly PermissionOptionKind[] = [
  "reject_once",
  "reject_always",
];

export interface AskUserQuestionPrompt {
  sessionId: SessionId;
  requestId: string;
  questions: AgentQuestion[];
  signal?: AbortSignal;
}

export interface AgentMcpServer {
  name: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  readOnlyToolNames: ReadonlyArray<string>;
  promptHints?: ReadonlyArray<string>;
}

export interface SessionAgent {
  slug: string;
  prompt: string;
  // One agent can run on different prompts in different chats; a backend that keeps an agent's prompt under a name keeps each variant under its own.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/991
  variant?: string;
}

export interface OpenSessionInput {
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
  agent?: SessionAgent;
}

export interface OpenSessionOutput {
  sessionId: SessionId;
  state: BackendState;
}

export interface ResumeSessionInput {
  sessionId: SessionId;
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
  agent?: SessionAgent;
}

export type ResumeSessionOutput = OpenSessionOutput;

export interface LoadSessionInput {
  sessionId: SessionId;
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
  agent?: SessionAgent;
}

export type LoadSessionOutput = OpenSessionOutput;

export interface PromptInput {
  sessionId: SessionId;
  promptId: string;
  prompt: PromptContent[];
}

export interface QueuedPrompt {
  readonly id: string;
  readonly text: string;
  readonly context?: MessageContext;
  readonly promptContent?: PromptContent[];
}

export interface TurnDiff {
  root: string;
  unifiedDiff: string;
}

export interface ListSessionsInput {
  cwd?: string;
}

export interface ListedSessionInfo {
  sessionId: SessionId;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface ListSessionsOutput {
  sessions: ListedSessionInfo[];
}

export interface CancelInput {
  sessionId: SessionId;
  keepUnread?: boolean;
}

export interface WithdrawInput {
  sessionId: SessionId;
  promptId: string;
}

export interface StopTaskInput {
  sessionId: SessionId;
  taskId: string;
}

export type SessionUpdateHandler = (event: SessionEvent) => void;

export interface BackendProcess {
  start?(): Promise<void>;
  isRunning(): boolean;
  onExit(listener: () => void): () => void;
  setPermissionPrompter(fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void;
  setUnhealthyHandler?(fn: () => void): void;
  setAskUserQuestionPrompter?(
    fn: (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>
  ): void;
  readContextWindow?(wireModelId: string | null | undefined): Promise<number | null>;
  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void;
  newSession(params: OpenSessionInput): Promise<OpenSessionOutput>;
  prompt(params: PromptInput): Promise<void>;
  cancel(params: CancelInput): Promise<void>;
  withdraw?(params: WithdrawInput): Promise<boolean>;
  stopTask?(params: StopTaskInput): Promise<void>;
  closeSession?(params: { sessionId: SessionId }): Promise<void>;
  setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState>;
  isSetSessionModelSupported(): boolean | null;
  setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState>;
  isSetSessionModeSupported(): boolean | null;
  setSessionConfigOption(params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState>;
  isSetSessionConfigOptionSupported(): boolean | null;
  listSessions(params: ListSessionsInput): Promise<ListSessionsOutput>;
  resumeSession(params: ResumeSessionInput): Promise<ResumeSessionOutput>;
  loadSession(params: LoadSessionInput): Promise<LoadSessionOutput>;
  shutdown(): Promise<void>;
}

export interface AgentChatMessage extends TranscriptMessage<MessageContext> {
  memorySaves?: readonly MemorySave[];
  agentMentions?: readonly AgentMention[];
}

export type NewAgentChatMessage = Omit<AgentChatMessage, "id"> & { id?: string };
