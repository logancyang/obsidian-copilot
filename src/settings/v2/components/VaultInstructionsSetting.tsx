import { SettingItem } from "@/components/ui/setting-item";
import { Button } from "@/components/ui/button";
import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import { ArrowUpRight } from "lucide-react";
import React from "react";

export interface VaultInstructionsSettingProps {
  value: string;
  onChange: (next: string) => void;
  onOpen: () => void;
}

/**
 * Presents vault-wide agent instructions while leaving vault file operations to its host.
 */
export const VaultInstructionsSetting: React.FC<VaultInstructionsSettingProps> = ({
  value,
  onChange,
  onOpen,
}) => (
  <div className="tw-flex tw-w-full tw-flex-col tw-gap-4 tw-py-4">
    <SettingItem
      type="custom"
      title="Custom vault instructions"
      description="Your custom instructions for the agent to follow for every vault interaction. Saved to AGENTS.md in your vault root, which you can also edit as a note."
      className="tw-py-0"
    >
      <Button variant="secondary" onClick={onOpen} className="tw-w-full @lg/setting-row:tw-w-auto">
        <ArrowUpRight className="tw-size-4" />
        Open AGENTS.md
      </Button>
    </SettingItem>
    <InstructionsTextarea label="Custom vault instructions" value={value} onChange={onChange} />
  </div>
);
