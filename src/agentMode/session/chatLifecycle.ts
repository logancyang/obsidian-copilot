import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { FanoutTurnRequest } from "@/agentMode/session/fanout/FanoutOrchestrator";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";

export interface ChatLifecycleListener {
  onTurnStarted?(chat: AgentSession): void;
  onTurnEnded?(chat: AgentSession): void;
  onChatLeft?(chat: AgentSession): void;
  onFanoutTurn?(turn: FanoutTurn, request: FanoutTurnRequest): void;
  beforeShutdown?(): Promise<void>;
}
