import type {
  AgentQuestionAnswers,
  BackendId,
  PlanDecisionAction,
  SessionId,
} from "@/agentMode/session/types";
import type { WireMessageContext } from "@/agentMode/protocol/state";

export interface SendContext extends Omit<WireMessageContext, "notes"> {
  notePaths: string[];
}

export interface ImageBlock {
  mimeType: string;
  data: string;
}

export type Command =
  | {
      name: "send";
      sessionId: SessionId;
      text: string;
      context?: SendContext;
      images?: ImageBlock[];
      mentionedAgents?: BackendId[];
    }
  | { name: "cancel"; sessionId: SessionId }
  | { name: "resolvePermission"; sessionId: SessionId; toolCallId: string; optionId: string }
  | {
      name: "answerQuestion";
      sessionId: SessionId;
      requestId: string;
      answers: AgentQuestionAnswers;
    }
  | {
      name: "resolvePlan";
      sessionId: SessionId;
      proposalId: string;
      decision: PlanDecisionAction;
      feedbackText?: string;
    };

export interface CommandValues {
  send: { userMessageId: string; droppedNotePaths: string[] };
  cancel: void;
  resolvePermission: void;
  answerQuestion: void;
  resolvePlan: void;
}

export type CommandName = Command["name"];

export type CommandValue<N extends CommandName> = CommandValues[N];

export type CommandErrorCode =
  | "unknown_session"
  | "session_starting"
  | "session_busy"
  | "session_closed"
  | "stale"
  | "invalid"
  | "too_large"
  | "failed";

export type CommandResult<V = void> =
  | { ok: true; value: V }
  | { ok: false; code: CommandErrorCode; message: string };
