import type { AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import type {
  AgentMessagePart,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendId,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
  PlanUsage,
  SessionId,
  SessionUsage,
  StopReason,
} from "@/agentMode/session/types";
import type { FormattedDateTime, MessageContext } from "@/types/message";

export type Scope = "host" | `session:${string}`;

export const HOST_SCOPE: Scope = "host";

export function sessionScope(id: SessionId): Scope {
  return `session:${id}`;
}

export function sessionIdOfScope(scope: Scope): SessionId | null {
  return scope.startsWith("session:") ? scope.slice("session:".length) : null;
}

export interface NoteRef {
  path: string;
  basename: string;
}

export interface WireMessageContext extends Omit<MessageContext, "notes"> {
  notes: NoteRef[];
}

export interface MessageOf<C> {
  id: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  message: string;
  parts?: AgentMessagePart[];
  context?: C;
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  fanout?: FanoutTurn;
}

export type WireMessage = MessageOf<WireMessageContext>;

export type WireQuestionPrompt = Omit<AskUserQuestionPrompt, "signal">;

export interface TabSummary {
  id: SessionId;
  chatInputId: string;
  backendId: BackendId;
  projectId: ProjectScopeId;
  status: AgentSessionStatus;
  label: string | null;
  labelSource: "user" | "agent" | null;
  needsAttention: boolean;
  canSwitchModel: boolean | null;
  canSwitchEffort: boolean | null;
  canSwitchMode: boolean | null;
}

export type TabPatch = Partial<
  Pick<
    TabSummary,
    | "status"
    | "label"
    | "labelSource"
    | "needsAttention"
    | "canSwitchModel"
    | "canSwitchEffort"
    | "canSwitchMode"
  >
>;

export interface HostState {
  tabs: readonly TabSummary[];
}

export interface PendingState {
  permissions: readonly PermissionPrompt[];
  questions: readonly WireQuestionPrompt[];
  planPermission: boolean;
}

export interface SessionState {
  transcript: readonly WireMessage[];
  backendState: BackendState | null;
  pending: PendingState;
  plan: CurrentPlan | null;
  todos: readonly AgentTodoListEntry[] | null;
  usage: SessionUsage | null;
  planUsage: PlanUsage | null;
}

export const EMPTY_TABS: readonly TabSummary[] = Object.freeze([]);
export const EMPTY_TRANSCRIPT: readonly WireMessage[] = Object.freeze([]);
export const EMPTY_PENDING: PendingState = Object.freeze({
  permissions: Object.freeze([]),
  questions: Object.freeze([]),
  planPermission: false,
});

export const INITIAL_HOST_STATE: HostState = Object.freeze({ tabs: EMPTY_TABS });

export const INITIAL_SESSION_STATE: SessionState = Object.freeze({
  transcript: EMPTY_TRANSCRIPT,
  backendState: null,
  pending: EMPTY_PENDING,
  plan: null,
  todos: null,
  usage: null,
  planUsage: null,
});
