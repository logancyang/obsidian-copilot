import type { Meta, StoryObj } from "@/lib/story";
import {
  TagSuggestionFocusSetting,
  type TagSuggestionFocusSettingProps,
} from "@/settings/v2/components/ui/TagSuggestionFocusSetting";

const meta = {
  title: "Settings/Tag suggestion focus",
  component: TagSuggestionFocusSetting,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<TagSuggestionFocusSettingProps>;
export default meta;

export const Enabled: StoryObj<TagSuggestionFocusSettingProps> = {
  args: { checked: true, onCheckedChange: () => undefined },
};

export const Disabled: StoryObj<TagSuggestionFocusSettingProps> = {
  args: { checked: false, onCheckedChange: () => undefined },
};
