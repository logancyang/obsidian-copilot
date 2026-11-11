import type { ClaudeAutoMemory } from "@/agentMode/backends/claude/descriptor";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

export interface ClaudeAutoMemorySettingProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  memory: ClaudeAutoMemory | null;
  onOpenFolder: (folder: string) => void;
  onClear: () => void;
}

export const ClaudeAutoMemorySetting: React.FC<ClaudeAutoMemorySettingProps> = ({
  enabled,
  onEnabledChange,
  memory,
  onOpenFolder,
  onClear,
}) => {
  const turnedOffInClaude = enabled && memory?.turnedOffInClaude;
  return (
    <>
      <SettingItem
        type="switch"
        title="Auto memory"
        description={
          turnedOffInClaude
            ? "Your Claude Code settings turn auto memory off, so Claude doesn't save or read memory in these chats."
            : "Claude Code saves what it learns about you and this vault in memory files outside your vault and reads them in later chats. Turning this off applies to new chats. Deleting a chat doesn't remove what Claude saved from it."
        }
        checked={enabled}
        onCheckedChange={onEnabledChange}
      />
      {enabled && memory && !turnedOffInClaude && (
        <SettingItem
          type="custom"
          title="Memory files"
          description={
            memory.folders.length === 0
              ? "Claude hasn't saved any memory for this vault yet."
              : memory.folderSetInClaude
                ? "Your Claude Code settings choose this folder, so Copilot only opens it."
                : "Review or clear what Claude remembers for this vault's chats."
          }
        >
          <div className="tw-flex tw-flex-col tw-items-end tw-gap-2">
            {memory.folders.map((folder) => (
              <div key={folder} className="tw-flex tw-items-center tw-gap-2">
                <span className="tw-break-all tw-text-xs tw-text-muted">{folder}</span>
                <Button variant="secondary" size="sm" onClick={() => onOpenFolder(folder)}>
                  Open
                </Button>
              </div>
            ))}
            {memory.folders.length > 0 && !memory.folderSetInClaude && (
              <Button variant="secondary" size="sm" onClick={onClear}>
                Clear memory
              </Button>
            )}
          </div>
        </SettingItem>
      )}
    </>
  );
};
