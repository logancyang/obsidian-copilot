import type { Meta, StoryObj } from "@/lib/story";
import { MiyoConnectionControl, type MiyoConnectionControlProps } from "./MiyoConnectionControl";

const meta = {
  title: "Settings/Miyo Connection Actions",
  component: MiyoConnectionControl,
  args: {
    checking: false,
    onDisconnect: () => {},
    onRetry: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<MiyoConnectionControlProps>;
export default meta;

export const Ready: StoryObj<MiyoConnectionControlProps> = {};
export const Checking: StoryObj<MiyoConnectionControlProps> = { args: { checking: true } };
