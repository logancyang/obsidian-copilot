import type { ClaudeAutoMemory } from "@/agentMode/backends/claude/descriptor";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

const CHOICE_VALUES = { default: undefined, on: true, off: false } as const;
type Choice = keyof typeof CHOICE_VALUES;

export interface ClaudeAutoMemorySettingProps {
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
  memory: ClaudeAutoMemory | null;
  onOpen: () => void;
}

export const ClaudeAutoMemorySetting: React.FC<ClaudeAutoMemorySettingProps> = ({
  value,
  onChange,
  memory,
  onOpen,
}) => {
  const choice: Choice = value === undefined ? "default" : value ? "on" : "off";
  const defaultLabel = memory ? `Default (${memory.onByDefault ? "On" : "Off"})` : "Default";
  const on = value ?? memory?.onByDefault;
  return (
    <>
      <SettingItem
        type="select"
        title="Auto memory"
        description="Let Claude remember what it learns about you and this vault in later chats."
        value={choice}
        options={[
          { label: defaultLabel, value: "default" },
          { label: "On", value: "on" },
          { label: "Off", value: "off" },
        ]}
        onChange={(next) => onChange(CHOICE_VALUES[next as Choice])}
      />
      {on && memory && (
        <SettingItem
          type="custom"
          title="Memory files"
          description="Manage what Claude remembers for this vault's chats."
        >
          {memory.folders.length === 0 ? (
            <span className="tw-text-xs tw-text-muted">Nothing saved yet</span>
          ) : (
            <Button variant="secondary" size="sm" onClick={onOpen}>
              Open
            </Button>
          )}
        </SettingItem>
      )}
    </>
  );
};
