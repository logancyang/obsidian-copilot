import type { ToolCardKind } from "@/agentMode/ui/activityGroups";
import { agentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import React from "react";

// Each thing the chat's agent does with an @-mentioned agent reads as one line naming that agent, not as a generic tool call; asking opens to the full message it sent.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export const agentToolLineKind: ToolCardKind = {
  place: (part) => (agentToolCall(part) ? { joinKey: null } : null),
  render: ([part], { app, open, onToggle, renderCall }) => {
    const call = agentToolCall(part);
    return call ? (
      <AgentToolLine
        call={call}
        app={app}
        open={open}
        onToggle={onToggle}
        ordinaryRow={renderCall(part)}
      />
    ) : null;
  },
};
