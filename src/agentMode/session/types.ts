import type { EffortOption } from "@/lib/model-effort";
import type React from "react";
import type { ModelCapability } from "@/constants";
import type { FormattedDateTime, MessageContext } from "@/types/message";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { PlanUsage } from "@/agentMode/session/planUsage";

export type { PlanUsage, UsageWindow } from "@/agentMode/session/planUsage";
import type { ProjectScopeId } from "./scope";

export type {
  BackendAuth,
  BackendAuthStatus,
  BackendDescriptor,
  BackendSignInHandlers,
  InstallState,
  ManagedInstallAction,
  ManagedInstallActionState,
  ModelSelectionSession,
} from "./descriptor";
export type { CurrentPlan, PlanDecisionAction, PlanProposalDecision } from "./plan";

export type BackendId = string;

export interface AgentBrand {
  readonly id: BackendId;
  readonly displayName: string;
  readonly Icon: React.ComponentType<{ className?: string }>;
  readonly needsSelfHostWarning?: boolean;
}

export type SessionId = string;

export type CopilotMode = "default" | "plan" | "auto";

export interface ModeMapping {
  kind: "setMode" | "configOption";
  configId?: string;
  canonical: Partial<Record<CopilotMode, string>>;
  readOnlyModeId?: string | null;
}

export interface ModeOption {
  value: CopilotMode;
  label: string;
}

export type { EffortOption } from "@/lib/model-effort";

export { EFFORT_LEVELS_ASCENDING } from "@/lib/model-effort";

export interface ModelEntry {
  baseModelId: string;
  name: string;
  description?: string;
  provider: string | null;
  effortOptions: EffortOption[];
}

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

export interface ModelSelection {
  baseModelId: string;
  effort: string | null;
}

export interface ModelState {
  current: ModelSelection;
  availableModels: ModelEntry[];
  apply: ModelApplySpec;
}

export interface ModelWireCodec {
  encode(selection: ModelSelection): string;

  decode(wireId: string): { selection: ModelSelection; provider: string | null };

  effortConfigFor?(baseModelId: string): BackendConfigOption | null;
}

type ModeApplyStep =
  | { kind: "setMode"; nativeId: string }
  | { kind: "setConfigOption"; configId: string; value: string };

export type ModeApplySpec =
  | ModeApplyStep
  | { kind: "sequence"; steps: [ModeApplyStep, ...ModeApplyStep[]] };

export type ModelApplySpec =
  | { kind: "setModel" }
  | { kind: "setConfigOption"; configId: string; effortConfigId?: string };

export interface BackendState {
  model: ModelState | null;

  mode: {
    current: CopilotMode | null;
    options: ModeOption[];
    apply: Partial<Record<CopilotMode, ModeApplySpec>>;
  } | null;
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

export type PromptContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource_link"; uri: string; name?: string };

export type StopReason = "end_turn" | "cancelled" | "refusal" | "max_tokens" | "max_turn_requests";

export type AgentToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type AgentToolStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export type AgentToolCallOutput =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string | null; newText: string };

export interface AgentPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface AgentTodoListEntry {
  content: string;
  status: AgentPlanEntry["status"];
}

export interface AgentToolProgress {
  description?: string;
  toolName?: string;
  toolUses?: number;
  durationMs?: number;
  totalTokens?: number;
}

export interface ToolCallSnapshot {
  toolCallId: string;
  title: string;
  kind?: AgentToolKind;
  status?: AgentToolStatus;
  rawInput?: unknown;
  content?: ToolCallContent[];
  locations?: Array<{ path: string; line?: number | null }>;
  vendorToolName?: string;
  mcpServer?: string;
  parentToolCallId?: string;
  progress?: AgentToolProgress;
  isPlanProposal?: boolean;
}

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
  parentToolCallId?: string;
  progress?: AgentToolProgress;
  isPlanProposal?: boolean;
}

export type ToolCallContent =
  | { type: "content"; content: { type: "text"; text: string } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string };

export interface PlanSummary {
  entries: AgentPlanEntry[];
}

export type CompactionStatus = "in_progress" | "completed" | "failed" | "cancelled" | "skipped";

export type CompactionTrigger = "manual" | "auto";

export interface CompactionSnapshot {
  id: string;
  status: CompactionStatus;
  trigger: CompactionTrigger;
  error?: string;
  preTokens?: number;
  postTokens?: number;
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

export type TaskKind = "subagent" | "command";

export type TaskEndStatus = "completed" | "failed" | "stopped";

// A task is known from the tool call that launches it, before the agent assigns it an id: a launch reports no taskId, and a later task_started for the same toolCallId attaches it. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
export interface TaskStart {
  taskId?: string;
  toolCallId: string;
  kind: TaskKind;
  description: string;
  prompt?: string;
  subagentType?: string;
  command?: string;
}

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

export interface SessionUsage {
  usedTokens: number;
  contextWindow?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  updatedAt: number;
}

export interface SessionEvent {
  sessionId: SessionId;
  update: SessionUpdate;
  occurredAt?: number;
  taskToolCallId?: string;
}

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

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

export interface PermissionOption {
  optionId: string;
  name: string;
  description?: string;
  kind: PermissionOptionKind;
}

export type PermissionRequester = "main" | { taskId: string };

export interface PermissionPrompt {
  sessionId: SessionId;
  requester?: PermissionRequester;
  toolCall: ToolCallSnapshot;
  options: PermissionOption[];
}

export interface PermissionDecision {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  denyMessage?: string;
}

export interface AgentQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  answerKey?: string;
  allowOther?: boolean;
}

export type AgentQuestionAnswers = { [answerKey: string]: string };

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
}

export interface OpenSessionInput {
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
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
}

export type ResumeSessionOutput = OpenSessionOutput;

export interface LoadSessionInput {
  sessionId: SessionId;
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
}

export type LoadSessionOutput = OpenSessionOutput;

export interface PromptInput {
  sessionId: SessionId;
  promptId: string;
  prompt: PromptContent[];
  interrupt?: boolean;
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
  setReadOnlySessionPredicate?(fn: (sessionId: SessionId) => boolean): void;
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
  sessionExistsLocally?(params: { sessionId: SessionId; cwd: string }): Promise<boolean>;
  shutdown(): Promise<void>;
}

export type AgentMessagePart =
  | {
      kind: "tool_call";
      id: string;
      title: string;
      toolKind?: AgentToolKind;
      status: AgentToolStatus;
      userResponse?: string;
      input?: unknown;
      output?: AgentToolCallOutput[];
      locations?: { path: string; line?: number }[];
      vendorToolName?: string;
      mcpServer?: string;
      parentToolCallId?: string;
      progress?: AgentToolProgress;
    }
  | {
      kind: "thought";
      text: string;
      startedAtMs?: number;
      durationMs?: number;
    }
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "plan";
      entries: AgentPlanEntry[];
    }
  | ({ kind: "compaction"; startedAtMs: number } & CompactionSnapshot);

export interface AgentChatMessage {
  id: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  message: string;
  parts?: AgentMessagePart[];
  context?: MessageContext;
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  fanout?: FanoutTurn;
  fileChanges?: TurnFileChange[];
}

export interface TurnFileChange {
  path: string;
  status: "modified" | "created" | "deleted";
  before: string | null;
  after: string | null;
  additions: number;
  deletions: number;
}

export type NewAgentChatMessage = Omit<AgentChatMessage, "id"> & { id?: string };
