import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const meta = {
  title: "UI/Setting Item",
  component: SettingItem,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof SettingItem>>;
export default meta;

export const LongLabels: StoryObj<React.ComponentProps<typeof SettingItem>> = {
  render: () => (
    <SettingSection>
      <SettingItem
        type="select"
        title="Standardmodell für neue Unterhaltungen"
        description="Wählen Sie das Modell aus, mit dem neue Unterhaltungen beginnen. Ihre vorhandenen Unterhaltungen bleiben unverändert."
        value="claude-sonnet"
        options={[{ label: "Claude Sonnet", value: "claude-sonnet" }]}
      />
      <SettingItem
        type="text"
        title="Folder for saved conversation notes"
        description="Choose where Copilot saves conversations so you can find them with the rest of your notes."
        value="Conversations"
      />
      <SettingItem
        type="textarea"
        title="Instructions for summarizing meeting notes"
        description="Include enough detail for someone who could not attend the meeting."
        value="Include decisions, owners, and next steps."
      />
    </SettingSection>
  ),
};
