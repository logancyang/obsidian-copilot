import { SettingItem } from "@/components/ui/setting-item";
import { AGENT_AUTO_COMPACT_TOKENS } from "@/constants";
import React from "react";

const SLIDER_STEP_TOKENS = 10_000;

export interface AgentAutoCompactSettingsProps {
  tokens: number | undefined;
  onChange: (tokens: number | undefined) => void;
}

export const AgentAutoCompactSettings: React.FC<AgentAutoCompactSettingsProps> = ({
  tokens,
  onChange,
}) => (
  <>
    <SettingItem
      type="switch"
      title="Custom auto-compact threshold"
      description="Choose when agents summarize a long conversation. Off keeps each agent's own default."
      checked={tokens !== undefined}
      onCheckedChange={(checked) =>
        onChange(checked ? AGENT_AUTO_COMPACT_TOKENS.initial : undefined)
      }
    />
    {tokens !== undefined && (
      <SettingItem
        type="slider"
        title="Compact at"
        description="Approximate conversation size in tokens. opencode measures from the smallest enabled model's window, so larger models compact later, and when any enabled opencode model has no known window opencode keeps its default."
        value={tokens}
        onChange={onChange}
        min={AGENT_AUTO_COMPACT_TOKENS.min}
        max={AGENT_AUTO_COMPACT_TOKENS.max}
        step={SLIDER_STEP_TOKENS}
      />
    )}
  </>
);
