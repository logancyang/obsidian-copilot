import type { Meta, StoryObj } from "@/lib/story";
import {
  LegacyVaultIndexSetting,
  type LegacyVaultIndexSettingProps,
} from "./LegacyVaultIndexSetting";

const meta = {
  title: "Settings/Legacy Vault Index Setting",
  component: LegacyVaultIndexSetting,
  args: {
    enabled: true,
    miyoManaged: false,
    onToggle: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<LegacyVaultIndexSettingProps>;
export default meta;

/** The state a v3 upgrader lands in: the index is on, and now switchable off. */
export const Enabled: StoryObj<LegacyVaultIndexSettingProps> = {};

export const Disabled: StoryObj<LegacyVaultIndexSettingProps> = {
  args: { enabled: false },
};

/** Miyo has taken over semantic search, so the index is idle and the switch is not settable here. */
export const MiyoManaged: StoryObj<LegacyVaultIndexSettingProps> = {
  args: { miyoManaged: true },
};
