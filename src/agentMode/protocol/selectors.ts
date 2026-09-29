import {
  EMPTY_PENDING,
  EMPTY_TRANSCRIPT,
  type HostState,
  type SessionState,
  type TabSummary,
  type WireMessage,
  type WireQuestionPrompt,
} from "@/agentMode/protocol/state";
import type {
  AgentTodoListEntry,
  CurrentPlan,
  PermissionPrompt,
  SessionId,
} from "@/agentMode/session/types";

export interface ChatRuntime {
  messages: readonly WireMessage[];
  isStarting: boolean;
  isTurnInFlight: boolean;
  hasPendingPlanPermission: boolean;
  currentPlan: CurrentPlan | null;
  currentTodoList: readonly AgentTodoListEntry[] | null;
  pendingToolPermissions: readonly PermissionPrompt[];
  pendingAskUserQuestions: readonly WireQuestionPrompt[];
}

export const EMPTY_CHAT_RUNTIME: ChatRuntime = Object.freeze({
  messages: EMPTY_TRANSCRIPT,
  isStarting: false,
  isTurnInFlight: false,
  hasPendingPlanPermission: false,
  currentPlan: null,
  currentTodoList: null,
  pendingToolPermissions: EMPTY_PENDING.permissions,
  pendingAskUserQuestions: EMPTY_PENDING.questions,
});

const visibleByTranscript = new WeakMap<readonly WireMessage[], readonly WireMessage[]>();
const runtimeBySession = new WeakMap<
  SessionState,
  { tab: TabSummary | null; runtime: ChatRuntime }
>();

export function selectTab(host: HostState, id: SessionId): TabSummary | null {
  return host.tabs.find((tab) => tab.id === id) ?? null;
}

export function selectVisibleMessages(session: SessionState): readonly WireMessage[] {
  const cached = visibleByTranscript.get(session.transcript);
  if (cached) return cached;
  const filtered = session.transcript.filter((message) => message.isVisible);
  const visible = filtered.length === 0 ? EMPTY_TRANSCRIPT : filtered;
  visibleByTranscript.set(session.transcript, visible);
  return visible;
}

export function selectChatRuntime(
  host: HostState,
  session: SessionState,
  id: SessionId
): ChatRuntime {
  const tab = selectTab(host, id);
  const cached = runtimeBySession.get(session);
  if (cached && cached.tab === tab) return cached.runtime;
  const status = tab?.status;
  const runtime: ChatRuntime = {
    messages: selectVisibleMessages(session),
    isStarting: status === "starting",
    isTurnInFlight: status === "running" || status === "awaiting_permission",
    hasPendingPlanPermission: session.pending.planPermission,
    currentPlan: session.plan,
    currentTodoList: session.todos,
    pendingToolPermissions: session.pending.permissions,
    pendingAskUserQuestions: session.pending.questions,
  };
  runtimeBySession.set(session, { tab, runtime });
  return runtime;
}
