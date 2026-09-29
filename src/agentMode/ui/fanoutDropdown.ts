import { backendRegistry } from "@/agentMode/backends/registry";
import {
  isDirectAnswerTurn,
  type AgentAnswer,
  type AgentAnswerStatus,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";

export const FANOUT_SUMMARY_OPTION = "__summary__";

export type FanoutOptionValue = BackendId;

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
  Icon?: AgentBrand["Icon"];
  state?: FanoutAgentState;
}

function brandFor(backendId: BackendId): { displayName: string; Icon?: AgentBrand["Icon"] } {
  const descriptor = backendRegistry[backendId];
  if (!descriptor) return { displayName: backendId };
  return { displayName: descriptor.displayName, Icon: descriptor.Icon };
}

export function fanoutDisplayName(backendId: BackendId): string {
  return brandFor(backendId).displayName;
}

export function buildFanoutOptions(turn: FanoutTurn): FanoutOption[] {
  const backendIds = Object.keys(turn.answers);
  const options: FanoutOption[] = isDirectAnswerTurn(turn)
    ? []
    : [{ value: FANOUT_SUMMARY_OPTION, label: "Summary" }];
  for (const backendId of backendIds) {
    const answer = turn.answers[backendId];
    const { displayName, Icon } = brandFor(backendId);
    options.push({
      value: backendId,
      label: displayName,
      Icon,
      state: agentStateForAnswer(answer),
    });
  }
  return options;
}

export function defaultFanoutOption(turn: FanoutTurn): FanoutOptionValue {
  const backendIds = Object.keys(turn.answers);
  return isDirectAnswerTurn(turn) ? backendIds[0] : FANOUT_SUMMARY_OPTION;
}

export function selectedAnswer(turn: FanoutTurn, value: FanoutOptionValue): AgentAnswer | null {
  if (value === FANOUT_SUMMARY_OPTION) return null;
  return turn.answers[value] ?? null;
}
