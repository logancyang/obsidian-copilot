import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

const CHOICE_VALUES = { default: undefined, on: true, off: false } as const;
type Choice = keyof typeof CHOICE_VALUES;

export interface ClaudeAutoMemorySettingProps {
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
  memoryFolder?: string;
  onOpen: (folder: string) => void;
}

export const ClaudeAutoMemorySetting: React.FC<ClaudeAutoMemorySettingProps> = ({
  value,
  onChange,
  memoryFolder,
  onOpen,
}) => {
  const choice: Choice = value === undefined ? "default" : value ? "on" : "off";
  return (
    <>
      <SettingItem
        type="select"
        title="Auto memory"
        description="Let Claude remember what it learns about you and this vault in later chats."
        value={choice}
        options={[
          { label: "Default", value: "default" },
          { label: "On", value: "on" },
          { label: "Off", value: "off" },
        ]}
        onChange={(next) => onChange(CHOICE_VALUES[next as Choice])}
      />
      {memoryFolder && (
        <SettingItem
          type="custom"
          title="Memory files"
          description="Manage what Claude remembers for this vault's chats."
        >
          <Button variant="secondary" size="sm" onClick={() => onOpen(memoryFolder)}>
            Open
          </Button>
        </SettingItem>
      )}
    </>
  );
};
