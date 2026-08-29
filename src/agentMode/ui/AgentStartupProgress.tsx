import { cn } from "@/lib/utils";
import React from "react";

export type AgentStartupStage = "plus-catalog" | "backend" | "backend-without-plus";

export interface AgentStartupProgressProps {
  stage: AgentStartupStage;
  agentName: string;
}

/** Shows which external dependency currently owns an Agent Mode startup wait. */
export const AgentStartupProgress: React.FC<AgentStartupProgressProps> = ({ stage, agentName }) => {
  const message =
    stage === "plus-catalog"
      ? "Loading Plus catalog…"
      : stage === "backend-without-plus"
        ? `Starting ${agentName} without Plus…`
        : `Starting ${agentName}…`;

  return (
    <div className={cn("tw-px-6 tw-text-center tw-text-sm tw-text-muted")} role="status">
      {message}
    </div>
  );
};
