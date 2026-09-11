import type { Meta, StoryObj } from "@/lib/story";
import {
  LegacyChatPromptsNoticeView,
  type LegacyChatPromptsNoticeViewProps,
} from "./LegacyChatPromptsNotice";

const meta = {
  title: "Settings/Legacy Chat Prompts Notice",
  component: LegacyChatPromptsNoticeView,
  args: {
    promptCount: 3,
    folderPath: "copilot/system-prompts",
    onOpenSavedPrompts: () => undefined,
    onOpenInstructions: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<LegacyChatPromptsNoticeViewProps>;
export default meta;

export const SeveralSavedPrompts: StoryObj<LegacyChatPromptsNoticeViewProps> = {};

export const OneSavedPrompt: StoryObj<LegacyChatPromptsNoticeViewProps> = {
  args: { promptCount: 1 },
};

/** A user who never saved a prompt sees no mention of the feature. */
export const NoSavedPrompts: StoryObj<LegacyChatPromptsNoticeViewProps> = {
  args: { promptCount: 0 },
};

export const LongFolderPath: StoryObj<LegacyChatPromptsNoticeViewProps> = {
  args: {
    folderPath:
      "Knowledge workspace/Assistant resources/Saved prompts for recurring research and writing workflows/system-prompts",
  },
};
