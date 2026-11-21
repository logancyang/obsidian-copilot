import type { AgentMention } from "@/agents/agentMentions";

export interface RunningAgentsLine {
  text: string;
  waiting: boolean;
}

function agentsDoing(names: readonly string[], verb: string): string {
  if (names.length >= 4) return `${names.length} teammates are ${verb}`;
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${listed} ${names.length === 1 ? "is" : "are"} ${verb}`;
}

// The design's wording for the line above the composer: agents waiting on the user come first and turn it orange, and the chat's own tasks are only counted.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/948
export function runningAgentsLine(
  runs: readonly AgentMention[],
  taskCount: number
): RunningAgentsLine {
  const waiting = runs.filter((run) => run.status !== "working");
  const working = runs.filter((run) => run.status === "working");
  const parts = [
    waiting.length === 1 && waiting[0].status === "permission"
      ? `${waiting[0].name} needs your OK`
      : waiting.length > 0
        ? agentsDoing(
            waiting.map((run) => run.name),
            "waiting for you"
          )
        : null,
    working.length > 0
      ? agentsDoing(
          working.map((run) => run.name),
          "working"
        )
      : null,
    taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : null,
  ];
  return {
    text: parts.filter((part) => part !== null).join(" · "),
    waiting: waiting.length > 0,
  };
}
