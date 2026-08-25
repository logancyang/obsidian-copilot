import { SettingItem } from "@/components/ui/setting-item";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { SettingSection } from "./setting-section";

type SettingSectionProps = React.ComponentProps<typeof SettingSection>;

const meta = {
  title: "UI/Setting Section",
  component: SettingSection,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SettingSectionProps>;
export default meta;

export const TitleAndDescription: StoryObj<SettingSectionProps> = {
  args: {
    label: "Index scope",
    description:
      "Which notes Copilot searches and shows in Relevant Notes; your Copilot folder is always excluded. Miyo's own index keeps the scope it was registered with until you re-add this folder in the Miyo app.",
    children: (
      <SettingItem
        type="custom"
        title="Exclusions"
        description="Skip these folders, tags, notes, or file extensions."
      >
        <div />
      </SettingItem>
    ),
  },
};
