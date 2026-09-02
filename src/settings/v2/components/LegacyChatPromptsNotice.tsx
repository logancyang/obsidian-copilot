import { getEffectiveSystemPromptsFolder } from "@/settings/copilotFolder";
import { t } from "@/i18n";
import { useSystemPrompts } from "@/system-prompts/state";
import React from "react";

export interface LegacyChatPromptsNoticeViewProps {
  /** How many saved Chat system prompt files the user has; zero renders nothing. */
  promptCount: number;
  /** Vault-relative folder still holding those files, shown verbatim. */
  folderPath: string;
}

/**
 * Presentational half of {@link LegacyChatPromptsNotice}: the migration copy for a given
 * prompt count and folder. Split from the store-connected wrapper so the component gallery
 * can render both states from fixture props.
 */
export const LegacyChatPromptsNoticeView: React.FC<LegacyChatPromptsNoticeViewProps> = ({
  promptCount,
  folderPath,
}) => {
  if (promptCount === 0) return null;

  return (
    <div className="tw-mb-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-ui-smaller tw-text-muted">
      {t("settings.legacyPrompts.notice", { count: promptCount, folderPath })}
    </div>
  );
};

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
  return (
    <LegacyChatPromptsNoticeView
      promptCount={prompts.length}
      folderPath={getEffectiveSystemPromptsFolder()}
    />
  );
};
