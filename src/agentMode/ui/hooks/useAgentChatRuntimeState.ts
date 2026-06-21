import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type {
  AgentChatMessage,
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
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  /**
   * Live per-agent fan-out state for the active multi-agent QA turn, or `null`
   * on the single-agent path. Drives the summary-first dropdown; `null` falls
   * through to the normal assistant rendering (incl. reloaded summary-only
   * transcripts, which never carry live fan-out state).
   */
  liveFanoutTurn: FanoutTurn | null;
}

export function useAgentChatRuntimeState(backend: AgentChatBackend): AgentChatRuntimeState {
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => backend.getMessages());
  const [isStarting, setIsStarting] = useState(() => backend.isStarting());
  const [hasPendingPlanPermission, setHasPendingPlanPermission] = useState(() =>
    backend.hasPendingPlanPermission()
  );
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan | null>(() =>
    backend.getCurrentPlan()
  );
  const [pendingToolPermissions, setPendingToolPermissions] = useState<PermissionPrompt[]>(() =>
    backend.getPendingToolPermissions()
  );
  const [pendingAskUserQuestions, setPendingAskUserQuestions] = useState<AskUserQuestionPrompt[]>(
    () => backend.getPendingAskUserQuestions()
  );
  const [liveFanoutTurn, setLiveFanoutTurn] = useState<FanoutTurn | null>(() =>
    backend.getLiveFanoutTurn()
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
      setMessages(backend.getMessages());
      setIsStarting(backend.isStarting());
      setHasPendingPlanPermission(backend.hasPendingPlanPermission());
      setCurrentPlan(backend.getCurrentPlan());
      setPendingToolPermissions(backend.getPendingToolPermissions());
      setPendingAskUserQuestions(backend.getPendingAskUserQuestions());
      setLiveFanoutTurn(backend.getLiveFanoutTurn());
    };
    sync();
    return backend.subscribe(() => {
      if (!isMountedRef.current) return;
      sync();
    });
  }, [backend]);

  return {
    messages,
    isStarting,
    hasPendingPlanPermission,
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
    liveFanoutTurn,
  };
}
