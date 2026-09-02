import type { Meta, StoryObj } from "@/lib/story";
import {
  VaultInstructionsSetting,
  type VaultInstructionsSettingProps,
} from "./VaultInstructionsSetting";

const meta = {
  title: "Settings/Vault Instructions Setting",
  component: VaultInstructionsSetting,
  args: {
    value:
      "Put new notes in Inbox/ and link them to a related note.\n\nAsk before editing anything under Archive/.",
    onChange: () => {},
    onOpen: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<VaultInstructionsSettingProps>;
export default meta;

export const Default: StoryObj<VaultInstructionsSettingProps> = {};

/** User-authored CJK instructions remain unchanged within the active interface locale. */
export const CjkUserInstructions: StoryObj<VaultInstructionsSettingProps> = {
  args: {
    value: "新笔记保存在 Inbox/。编辑 Archive/ 下的文件前先询问我。",
  },
};
