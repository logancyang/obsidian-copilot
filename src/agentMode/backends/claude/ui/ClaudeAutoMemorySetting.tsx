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
  onOpenFolder: (folder: string) => void;
  onClear: () => void;
}

export const ClaudeAutoMemorySetting: React.FC<ClaudeAutoMemorySettingProps> = ({
  value,
  onChange,
  memory,
  onOpenFolder,
  onClear,
}) => {
  const choice: Choice = value === undefined ? "default" : value ? "on" : "off";
  const defaultLabel = memory
    ? `Claude Code default (${memory.onByDefault ? "On" : "Off"})`
    : "Claude Code default";
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
          <div className="tw-flex tw-flex-col tw-items-end tw-gap-2">
            {memory.folders.length === 0 && (
              <span className="tw-text-xs tw-text-muted">Nothing saved yet</span>
            )}
            {memory.folders.map((folder) => (
              <div key={folder} className="tw-flex tw-items-center tw-gap-2">
                <span className="tw-break-all tw-text-xs tw-text-muted">{folder}</span>
                <Button variant="secondary" size="sm" onClick={() => onOpenFolder(folder)}>
                  Open
                </Button>
              </div>
            ))}
            {memory.folderSetInClaude ? (
              <span className="tw-text-xs tw-text-muted">Folder set in Claude Code</span>
            ) : (
              memory.folders.length > 0 && (
                <Button variant="secondary" size="sm" onClick={onClear}>
                  Clear memory
                </Button>
              )
            )}
          </div>
        </SettingItem>
      )}
    </>
  );
};
