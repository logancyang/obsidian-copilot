import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { useTab } from "@/contexts/TabContext";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { getEffectiveSystemPromptsFolder } from "@/settings/copilotFolder";
import { useSystemPrompts } from "@/system-prompts/state";
import React from "react";

/** Stable focus target shared by the Basic section and its navigation action. */
export const VAULT_INSTRUCTIONS_SECTION_ID = "copilot-vault-instructions";

export interface LegacyChatPromptsNoticeViewProps {
  /** How many saved Chat system prompt files the user has; zero renders nothing. */
  promptCount: number;
  /** Vault-relative folder still holding those files, shown verbatim. */
  folderPath: string;
  onOpenSavedPrompts: () => void;
  onOpenInstructions: React.MouseEventHandler<HTMLButtonElement>;
}

/**
 * Presentational half of {@link LegacyChatPromptsNotice}: the migration copy for a given
 * prompt count and folder. Split from the store-connected wrapper so the component gallery
 * can render both states from fixture props.
 */
export const LegacyChatPromptsNoticeView: React.FC<LegacyChatPromptsNoticeViewProps> = ({
  promptCount,
  folderPath,
  onOpenSavedPrompts,
  onOpenInstructions,
}) => {
  if (promptCount === 0) return null;

  return (
    <div className="tw-mb-3 tw-space-y-2 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-left tw-text-ui-smaller tw-text-muted">
      <div className="tw-font-medium tw-text-normal">Your saved prompts are still available</div>
      <div>
        Copy the instructions you want into Custom vault instructions (AGENTS.md). Existing prompt
        files stay unchanged.
      </div>
      <div className="tw-break-words [overflow-wrap:anywhere]">
        Saved prompts folder: <span className="tw-select-text">{folderPath}</span>
      </div>
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-text-left"
          onClick={onOpenSavedPrompts}
        >
          Open saved prompts
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-text-left"
          onClick={onOpenInstructions}
        >
          Open vault instructions
        </Button>
      </div>
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
  const app = useApp();
  const { setSelectedTab } = useTab();
  const folderPath = getEffectiveSystemPromptsFolder();
  return (
    <LegacyChatPromptsNoticeView
      promptCount={prompts.length}
      folderPath={folderPath}
      onOpenSavedPrompts={() => {
        // Reveal the source in the workspace instead of leaving it hidden behind Settings.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/419
        (app as unknown as { setting: { close: () => void } }).setting.close();
        revealFolderInExplorer(app, folderPath);
      }}
      onOpenInstructions={(event) => {
        const ownerDocument = event.currentTarget.ownerDocument;
        setSelectedTab("basic");
        // Advanced unmounts on navigation; focus the section after Basic renders, without
        // opening or creating a file or applying any saved prompt.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/419
        ownerDocument.defaultView?.requestAnimationFrame(() => {
          const section = ownerDocument.getElementById(VAULT_INSTRUCTIONS_SECTION_ID);
          section?.focus();
          section?.scrollIntoView({ block: "start" });
        });
      }}
    />
  );
};
