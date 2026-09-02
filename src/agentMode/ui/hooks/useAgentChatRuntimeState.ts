import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import { useEffect, useRef, useState } from "react";

/**
 * Reactive snapshot of the backend's per-turn runtime state, kept in sync via
 * a single subscription. Messages, starting flag, plan/permission state all
 * change together as the backend streams a turn, so they share one subscribe
 * + one `sync()` — splitting them into separate subscription hooks would
 * multiply listeners and risk inconsistent intermediate renders.
 */
export interface AgentChatRuntimeState {
  messages: AgentChatMessage[];
  isStarting: boolean;
  hasPendingPlanPermission: boolean;
  currentPlan: CurrentPlan | null;
  currentTodoList: AgentTodoListEntry[] | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
}

interface BackendRuntimeSnapshot {
  backend: AgentChatBackend;
  state: AgentChatRuntimeState;
}

function readBackendRuntimeSnapshot(backend: AgentChatBackend): BackendRuntimeSnapshot {
  return {
    backend,
    state: {
      messages: backend.getMessages(),
      isStarting: backend.isStarting(),
      hasPendingPlanPermission: backend.hasPendingPlanPermission(),
      currentPlan: backend.getCurrentPlan(),
      currentTodoList: backend.getCurrentTodoList(),
      pendingToolPermissions: backend.getPendingToolPermissions(),
      pendingAskUserQuestions: backend.getPendingAskUserQuestions(),
    },
  };
}

export function useAgentChatRuntimeState(backend: AgentChatBackend): AgentChatRuntimeState {
  const [snapshot, setSnapshot] = useState<BackendRuntimeSnapshot>(() =>
    readBackendRuntimeSnapshot(backend)
  );

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // The initial sync on each `backend` change is needed because the lazy
  // useState initializers only ran for the first backend; the next backend's
  // values must be pulled imperatively. The backend exposes plain getters that
  // return fresh arrays/objects (e.g. getMessages()), so `useSyncExternalStore`
  // would see a new snapshot every render and tear — keep explicit subscribe +
  // setState.
  useEffect(() => {
    const sync = () => {
      setSnapshot(readBackendRuntimeSnapshot(backend));
    };
    sync();
    return backend.subscribe(() => {
      if (!isMountedRef.current) return;
      sync();
    });
  }, [backend]);

  // A replacement backend renders before the passive subscription effect can
  // synchronize. Never expose the prior runtime's readiness or permissions
  // alongside the new backend during that render.
  return snapshot.backend === backend ? snapshot.state : readBackendRuntimeSnapshot(backend).state;
}
