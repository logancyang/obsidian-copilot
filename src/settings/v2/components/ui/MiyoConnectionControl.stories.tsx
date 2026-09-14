import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import {
  MiyoAvailabilityNotice,
  MiyoConnectionControl,
  type MiyoConnectionControlProps,
} from "./MiyoConnectionControl";

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

export const UnavailableInCenteredParent: StoryObj<MiyoConnectionControlProps> = {
  render: () => (
    <div className="tw-text-center">
      <MiyoAvailabilityNotice enabled available={false} checking={false} />
    </div>
  ),
};
