import {
  isDirectAnswerTurn,
  type AgentAnswer,
  type AgentAnswerStatus,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import type { AgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";

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

export interface FanoutBrand {
  displayName: string;
  Icon?: AgentBrand["Icon"];
}

export type FanoutBrandLookup = (backendId: BackendId) => FanoutBrand;

/**
 * Names and icons for the agents in a fan-out answer, drawn from what the surrounding environment
 * supplies, so the message pane needs no registry of every agent. An agent the environment does
 * not know shows under its id.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/613
 */
export function fanoutBrandLookup(
  capabilities: Pick<AgentPaneCapabilities, "backendIcon" | "backendName">
): FanoutBrandLookup {
  return (backendId) => ({
    displayName: capabilities.backendName?.(backendId) ?? backendId,
    Icon: capabilities.backendIcon?.(backendId),
  });
}

export function buildFanoutOptions(turn: FanoutTurn, brandFor: FanoutBrandLookup): FanoutOption[] {
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
