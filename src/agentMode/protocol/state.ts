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
  EffortOption,
  ModelSelection,
  PermissionPrompt,
  PlanUsage,
  SessionId,
  SessionUsage,
  StopReason,
} from "@/agentMode/session/types";
import type { ModelCapability } from "@/constants";
import type { FormattedDateTime, MessageContext, NoteRef } from "@/types/message";

export type { NoteRef };

export type Scope = "host" | `session:${string}`;

export const HOST_SCOPE: Scope = "host";

export function sessionScope(id: SessionId): Scope {
  return `session:${id}`;
}

export function sessionIdOfScope(scope: Scope): SessionId | null {
  return scope.startsWith("session:") ? scope.slice("session:".length) : null;
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

/**
 * Whether a backend can start a chat, as a UI needs to draw it. It carries no paths, versions or
 * error text: those stay on the desktop, next to the install and sign-in flows that use them.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export type BackendReadiness =
  | "checking"
  | "ready"
  | "not_set_up"
  | "update_required"
  | "setup_error";

export type PreloadStatus = "absent" | "pending" | "ready" | "error";

/**
 * One row of the model picker: display fields only. It is the only shape a picker entry takes in
 * host state, so no `CustomModel` field, and therefore no credential, can ride along.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export interface PickerModel {
  name: string;
  provider: string;
  displayName: string;
  capabilities?: ModelCapability[];
  group?: string;
  backendId?: BackendId;
  subtitle?: string;
  isFree?: boolean;
  disabledReason?: string;
  needsSelfHostWarning?: boolean;
  needsLicense?: boolean;
}

export interface EnabledModel {
  baseModelId: string;
  name: string;
  description?: string;
  capabilities?: ModelCapability[];
  isFree?: boolean;
  needsSelfHostWarning?: boolean;
  missingKey: boolean;
}

export interface ReportedModel {
  baseModelId: string;
  name: string;
  description?: string;
}

/**
 * Everything a client needs to assemble one backend's section of the model picker. Which models
 * appear also depends on the client's own active session, so the host sends the inputs to that
 * rule rather than the finished list.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export interface BackendSummary {
  id: BackendId;
  displayName: string;
  readiness: BackendReadiness;
  preload: PreloadStatus;
  selfHostable: boolean;
  selfHostWarning: boolean;
  enabled: readonly EnabledModel[] | null;
  reported: readonly ReportedModel[] | null;
  efforts: Readonly<Record<string, readonly EffortOption[]>>;
  defaultSelection: ModelSelection | null;
  lockedPreview: readonly PickerModel[];
}

/**
 * Host-wide facts. `startFailed` is a boolean because the error text can echo spawn arguments.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export interface HostFlags {
  defaultBackendId: BackendId | null;
  startingBackendId: BackendId | null;
  startFailed: boolean;
}

export interface HostState {
  tabs: readonly TabSummary[];
  backends: readonly BackendSummary[];
  host: HostFlags;
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
export const EMPTY_BACKENDS: readonly BackendSummary[] = Object.freeze([]);
export const INITIAL_HOST_FLAGS: HostFlags = Object.freeze({
  defaultBackendId: null,
  startingBackendId: null,
  startFailed: false,
});
export const EMPTY_TRANSCRIPT: readonly WireMessage[] = Object.freeze([]);
export const EMPTY_PENDING: PendingState = Object.freeze({
  permissions: Object.freeze([]),
  questions: Object.freeze([]),
  planPermission: false,
});

export const INITIAL_HOST_STATE: HostState = Object.freeze({
  tabs: EMPTY_TABS,
  backends: EMPTY_BACKENDS,
  host: INITIAL_HOST_FLAGS,
});

export const INITIAL_SESSION_STATE: SessionState = Object.freeze({
  transcript: EMPTY_TRANSCRIPT,
  backendState: null,
  pending: EMPTY_PENDING,
  plan: null,
  todos: null,
  usage: null,
  planUsage: null,
});
