import type { Meta, StoryObj } from "@/lib/story";
import {
  CopilotFolderChangeNotice,
  type CopilotFolderChangeNoticeProps,
} from "./CopilotFolderChangeNotice";

const meta = {
  title: "Settings/Copilot Folder Change Notice",
  component: CopilotFolderChangeNotice,
  args: {
    oldRoot: "copilot",
    newRoot: "90 System/copilot",
    containsMarkdown: false,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CopilotFolderChangeNoticeProps>;
export default meta;

export const EmptyFolder: StoryObj<CopilotFolderChangeNoticeProps> = {};

export const FolderWithMarkdown: StoryObj<CopilotFolderChangeNoticeProps> = {
  args: { containsMarkdown: true },
};
