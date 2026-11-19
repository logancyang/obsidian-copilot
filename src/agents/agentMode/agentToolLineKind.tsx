import type { ToolCardKind } from "@/agentMode/ui/activityGroups";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { agentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import React from "react";

// Each thing the chat's agent does with an @-mentioned agent reads as one line naming that agent, not as a generic tool call; asking opens to the full message it sent.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export const agentToolLineKind: ToolCardKind = {
  place: (part) => {
    const call = agentToolCall(part);
    if (!call) return null;
    // One message can mention several agents, and the asks it starts read as one line naming them all.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/949
    return { joinKey: call.tool === ASK_AGENT_TOOL_NAME ? call.tool : null };
  },
  render: (parts, { app, open, onToggle, renderCall }) => {
    const calls = parts.flatMap((part) => agentToolCall(part) ?? []);
    return calls.length > 0 ? (
      <AgentToolLine
        calls={calls}
        app={app}
        open={open}
        onToggle={onToggle}
        ordinaryRow={parts.map((part) => (
          <React.Fragment key={part.id}>{renderCall(part)}</React.Fragment>
        ))}
      />
    ) : null;
  },
};
