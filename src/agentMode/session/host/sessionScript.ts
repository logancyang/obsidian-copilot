import type {
  AgentQuestion,
  AgentQuestionAnswers,
  PermissionPrompt,
  SessionUpdate,
  StopReason,
} from "@/agentMode/session/types";

export type ScriptStep =
  | { step: "send"; text: string }
  | { step: "event"; update: SessionUpdate }
  | { step: "permission"; request: PermissionPrompt; optionId: string }
  | {
      step: "question";
      requestId: string;
      questions: AgentQuestion[];
      answers: AgentQuestionAnswers;
    }
  | { step: "cancel" }
  | { step: "end"; stopReason: StopReason };

export interface SessionScript {
  name: string;
  backendId: string;
  steps: ScriptStep[];
}
