import { getEffectiveSystemPromptsFolder } from "@/settings/copilotFolder";
import { useSystemPrompts } from "@/system-prompts/state";
import React from "react";

/**
 * Tells a user who had Chat system prompts where those files still are.
 *
 * Agent Mode used to send the selected Chat prompt as its instructions, and this release
 * moves that job to AGENTS.md without copying anything across — whichever prompt happened to
 * be selected is not what the user necessarily wants frozen into a vault-wide file. Without
 * this pointer, their old text would look deleted rather than merely unused.
 *
 * Renders nothing when there are no prompt files, so a user who never made one sees no
 * mention of a feature they never used.
 */
export const LegacyChatPromptsNotice: React.FC = () => {
  const prompts = useSystemPrompts();
  if (prompts.length === 0) return null;

  return (
    <div className="tw-mb-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-ui-smaller tw-text-muted">
      Agent Mode now reads your instructions from <code>AGENTS.md</code>. Your{" "}
      {prompts.length === 1
        ? "saved system prompt is"
        : `${prompts.length} saved system prompts are`}{" "}
      still in <code>{getEffectiveSystemPromptsFolder()}</code> — open one there and paste anything
      you want the agent to keep following.
    </div>
  );
};
