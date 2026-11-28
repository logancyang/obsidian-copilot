import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";
import { SettingDisclosure } from "./setting-disclosure";

type SettingDisclosureProps = React.ComponentProps<typeof SettingDisclosure>;

const meta = {
  title: "UI/Setting Disclosure",
  component: SettingDisclosure,
  args: { open: false },
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
