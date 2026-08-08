import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import type { Meta, StoryObj } from "@/lib/story";
import type React from "react";

type ProjectFolderIconProps = React.ComponentProps<typeof ProjectFolderIcon>;

const meta = {
  title: "UI/Project Folder Icon",
  component: ProjectFolderIcon,
  parameters: { gallery: { host: "leaf", layout: "centered" } },
} satisfies Meta<ProjectFolderIconProps>;
export default meta;

export const Default: StoryObj<ProjectFolderIconProps> = {};
