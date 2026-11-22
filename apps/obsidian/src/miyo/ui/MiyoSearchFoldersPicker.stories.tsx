import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import {
  MiyoSearchFoldersPicker,
  type MiyoSearchFoldersPickerProps,
} from "./MiyoSearchFoldersPicker";

function InteractivePicker(args: Partial<MiyoSearchFoldersPickerProps>) {
  const [selected, setSelected] = React.useState(args.selected ?? []);
  return <MiyoSearchFoldersPicker {...args} selected={selected} onChange={setSelected} />;
}

const meta = {
  title: "Settings/Miyo Search Folders",
  component: MiyoSearchFoldersPicker,
  args: {
    folders: [
      { name: "Research", isChat: false },
      { name: "Archive", isChat: false },
      { name: "ChatGPT", isChat: true },
      { name: "Claude", isChat: true },
    ],
    selected: ["Research", "ChatGPT"],
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<MiyoSearchFoldersPickerProps>;
export default meta;
export const SomeTicked: StoryObj<MiyoSearchFoldersPickerProps> = { render: InteractivePicker };
export const TickedFolderNotInMiyo: StoryObj<MiyoSearchFoldersPickerProps> = {
  args: { selected: ["Research", "Old laptop vault"] },
  render: InteractivePicker,
};
export const Loading: StoryObj<MiyoSearchFoldersPickerProps> = {
  args: { folders: undefined },
  render: InteractivePicker,
};
export const NoOtherFolders: StoryObj<MiyoSearchFoldersPickerProps> = {
  args: { folders: [], selected: [] },
  render: InteractivePicker,
};
export const LoadFailed: StoryObj<MiyoSearchFoldersPickerProps> = {
  args: { folders: undefined, error: "Couldn't load your Miyo folders." },
  render: InteractivePicker,
};
