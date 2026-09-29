import { getEffectiveSystemPromptsFolder } from "@/settings/copilotFolder";
import { useSystemPrompts } from "@/system-prompts/state";
import React from "react";

export interface LegacyChatPromptsNoticeViewProps {
  promptCount: number;
  folderPath: string;
}

export const LegacyChatPromptsNoticeView: React.FC<LegacyChatPromptsNoticeViewProps> = ({
  promptCount,
  folderPath,
}) => {
  if (promptCount === 0) return null;

  return (
    <div className="tw-mb-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-ui-smaller tw-text-muted">
      Agent Mode now reads your instructions from <code>AGENTS.md</code>. Your{" "}
      {promptCount === 1 ? "saved system prompt is" : `${promptCount} saved system prompts are`}{" "}
      still in <code>{folderPath}</code> — open one there and paste anything you want the agent to
      keep following.
    </div>
  );
};

export const LegacyChatPromptsNotice: React.FC = () => {
  const prompts = useSystemPrompts();
  return (
    <LegacyChatPromptsNoticeView
      promptCount={prompts.length}
      folderPath={getEffectiveSystemPromptsFolder()}
    />
  );
};
