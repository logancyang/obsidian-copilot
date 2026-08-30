import type { Meta, StoryObj } from "@/lib/story";
import {
  LegacyChatPromptsNoticeView,
  type LegacyChatPromptsNoticeViewProps,
} from "./LegacyChatPromptsNotice";

const meta = {
  title: "Settings/Legacy Chat Prompts Notice",
  component: LegacyChatPromptsNoticeView,
  args: { promptCount: 3, folderPath: "copilot/system-prompts" },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<LegacyChatPromptsNoticeViewProps>;
export default meta;

export const SeveralSavedPrompts: StoryObj<LegacyChatPromptsNoticeViewProps> = {};

export const OneSavedPrompt: StoryObj<LegacyChatPromptsNoticeViewProps> = {
  args: { promptCount: 1 },
};

/** Verifies interface prose can wrap naturally around a preserved CJK folder path. */
export const CjkFolderPath: StoryObj<LegacyChatPromptsNoticeViewProps> = {
  args: { promptCount: 2, folderPath: "资料/Copilot/系统提示词" },
};

/** A user who never saved a prompt sees no mention of the feature. */
export const NoSavedPrompts: StoryObj<LegacyChatPromptsNoticeViewProps> = {
  args: { promptCount: 0 },
};
