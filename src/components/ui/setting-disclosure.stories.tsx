import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";
import { SettingDisclosure } from "./setting-disclosure";

type SettingDisclosureProps = React.ComponentProps<typeof SettingDisclosure>;

const meta = {
  title: "UI/Setting Disclosure",
  component: SettingDisclosure,
  args: { open: false },
  // `settings-tab` because the row's `!` resets exist to beat Obsidian's
  // settings-pane button styling — under any other host it would look correct
  // for the wrong reason.
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SettingDisclosureProps>;
export default meta;

export const Collapsed: StoryObj<SettingDisclosureProps> = {};

export const Expanded: StoryObj<SettingDisclosureProps> = {
  args: { open: true },
};

export const CustomLabel: StoryObj<SettingDisclosureProps> = {
  args: { label: "Developer options" },
};
