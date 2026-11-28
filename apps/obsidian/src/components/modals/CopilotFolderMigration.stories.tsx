import type { Meta, StoryObj } from "@/lib/story";
import { CopilotFolderMigration, type CopilotFolderMigrationProps } from "./CopilotFolderMigration";

const meta = {
  title: "Modals/Copilot Folder Migration",
  component: CopilotFolderMigration,
  args: { migration: { status: "moved", from: ".copilot", to: "copilot", leftBehind: [] } },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CopilotFolderMigrationProps>;
export default meta;

export const Moved: StoryObj<CopilotFolderMigrationProps> = {};

export const FilesLeftBehind: StoryObj<CopilotFolderMigrationProps> = {
  args: {
    migration: {
      status: "moved",
      from: ".copilot",
      to: "copilot",
      leftBehind: [
        ".copilot/memory/User Role.md",
        ".copilot/copilot-conversations/A very long conversation title that wraps onto a second line.md",
      ],
    },
  },
};

export const Failed: StoryObj<CopilotFolderMigrationProps> = {
  args: {
    migration: {
      status: "failed",
      from: ".copilot",
      to: "copilot",
      reason: "EACCES: permission denied, rename '.copilot/memory'",
    },
  },
};
