export interface AgentQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  answerKey?: string;
  allowOther?: boolean;
}

export type AgentQuestionAnswers = { [answerKey: string]: string };
