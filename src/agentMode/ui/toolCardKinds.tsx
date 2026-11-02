import React from "react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { ToolCardKind } from "@/agentMode/ui/activityGroups";
import type { AgentTasksContextValue } from "@/agentMode/ui/AgentTasksContext";
import { TaskCard } from "@/agentMode/ui/TaskCard";
import { excalidrawCardKind } from "@/excalidraw/agentMode/excalidrawCardKind";
import { miyoCardKind } from "@/miyo/agentMode/miyoCardKind";

function launchedTask(part: ToolCallPart, tasks: AgentTasksContextValue | null) {
  return tasks?.tasks.find((task) => task.toolCallId === part.id);
}

// A task's work is shown in its own view, so its launching call is only a link there, never folded into "Ran N
// commands". https://github.com/Brevilabs/obsidian-copilot-private/issues/749
const taskLaunchCardKind: ToolCardKind = {
  place: (part, { tasks }) => (launchedTask(part, tasks) ? { joinKey: null } : null),
  render: ([launch], { tasks }) => {
    const task = launchedTask(launch, tasks);
    return task && tasks ? <TaskCard task={task} onOpen={tasks.openTask} /> : null;
  },
};

function isInteractive(part: ToolCallPart): boolean {
  // A submitted response must remain visible after its action card closes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
  if (part.userResponse) return true;
  if (part.mcpServer) return false;
  const name = part.vendorToolName;
  return (
    part.toolKind === "switch_mode" ||
    name === "AskUserQuestion" ||
    name === "ExitPlanMode" ||
    name === "EnterPlanMode"
  );
}

const interactiveCardKind: ToolCardKind = {
  place: (part) => (isInteractive(part) ? { joinKey: null } : null),
  render: ([part], { renderCall }) => renderCall(part),
};

export const TOOL_CARD_KINDS: readonly ToolCardKind[] = [
  taskLaunchCardKind,
  excalidrawCardKind,
  miyoCardKind,
  interactiveCardKind,
];
