import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import { useEffect, useRef, useState } from "react";

export interface AgentChatRuntimeState {
  messages: AgentChatMessage[];
  isStarting: boolean;
  isTurnInFlight: boolean;
  hasPendingPlanPermission: boolean;
  currentPlan: CurrentPlan | null;
  currentTodoList: AgentTodoListEntry[] | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  feedbackOffer: FeedbackOffer | null;
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
      isTurnInFlight: backend.isTurnInFlight(),
      hasPendingPlanPermission: backend.hasPendingPlanPermission(),
      currentPlan: backend.getCurrentPlan(),
      currentTodoList: backend.getCurrentTodoList(),
      pendingToolPermissions: backend.getPendingToolPermissions(),
      pendingAskUserQuestions: backend.getPendingAskUserQuestions(),
      feedbackOffer: backend.getFeedbackOffer(),
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

  return snapshot.backend === backend ? snapshot.state : readBackendRuntimeSnapshot(backend).state;
}
