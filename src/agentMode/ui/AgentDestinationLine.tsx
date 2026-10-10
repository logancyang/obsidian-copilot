import { backendRegistry } from "@/agentMode/backends/registry";
import type { AgentModelPickerOverride } from "@/agentMode/ui/useAgentModelPicker";
import { getModelKeyFromModel, type CopilotSettings } from "@/settings/model";
import React from "react";

export function resolveDataDestination(
  picker: AgentModelPickerOverride | null,
  settings: CopilotSettings
): string | null {
  const entry = picker?.models.find((model) => getModelKeyFromModel(model) === picker.value);
  if (!entry?._backendId) return null;
  const descriptor = backendRegistry[entry._backendId];
  return descriptor?.dataDestination(settings, entry.name) ?? null;
}

interface AgentDestinationLineProps {
  destination: string;
}

// One muted line, no click, so users see where context goes before the first message.
// https://github.com/logancyang/obsidian-copilot/issues/2889
export const AgentDestinationLine: React.FC<AgentDestinationLineProps> = ({ destination }) => (
  <p className="tw-m-0 tw-px-2 tw-pb-1 tw-text-ui-smaller tw-text-muted">
    Your message, notes the agent reads, and tool results go to {destination}.
  </p>
);
