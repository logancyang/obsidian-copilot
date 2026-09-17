import {
  isDirectAnswerTurn,
  type AgentAnswer,
  type AgentAnswerStatus,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";

export const FANOUT_SUMMARY_OPTION = "__summary__";

export type FanoutOptionValue = string;

export type FanoutAgentState = "streaming" | "answer" | "error" | "cancelled" | "empty";

export function agentStateForStatus(status: AgentAnswerStatus): FanoutAgentState {
  switch (status) {
    case "running":
      return "streaming";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    case "done":
      return "answer";
  }
}

export function agentStateForAnswer(answer: AgentAnswer): FanoutAgentState {
  if (answer.status === "done" && answer.text.trim().length === 0) return "empty";
  return agentStateForStatus(answer.status);
}

export type FanoutSummaryState = "writing" | "waiting" | "cancelled" | "unavailable";

export function summaryDisplayState(turn: FanoutTurn): FanoutSummaryState {
  if (turn.summary.status === "streaming") return "writing";
  if (turn.summary.status === "pending") {
    const anyRunning = Object.values(turn.answers).some((a) => a.status === "running");
    return anyRunning ? "waiting" : "cancelled";
  }
  return "unavailable";
}

export interface FanoutOption {
  value: FanoutOptionValue;
  label: string;
  icon?: string;
  state?: FanoutAgentState;
}

export function buildFanoutOptions(turn: FanoutTurn): FanoutOption[] {
  const options: FanoutOption[] = isDirectAnswerTurn(turn)
    ? []
    : [{ value: FANOUT_SUMMARY_OPTION, label: "Summary" }];
  for (const slug of Object.keys(turn.answers)) {
    const answer = turn.answers[slug];
    options.push({
      value: slug,
      label: answer.name,
      icon: answer.icon,
      state: agentStateForAnswer(answer),
    });
  }
  return options;
}

export function defaultFanoutOption(turn: FanoutTurn): FanoutOptionValue {
  return isDirectAnswerTurn(turn) ? Object.keys(turn.answers)[0] : FANOUT_SUMMARY_OPTION;
}

export function selectedAnswer(turn: FanoutTurn, value: FanoutOptionValue): AgentAnswer | null {
  if (value === FANOUT_SUMMARY_OPTION) return null;
  return turn.answers[value] ?? null;
}
